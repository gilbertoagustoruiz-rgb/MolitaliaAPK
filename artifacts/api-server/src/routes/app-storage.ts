import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "@workspace/db";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const scrypt = promisify(scryptCallback);

type StoredRecord = Record<string, unknown>;
type QueryClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
};
type CollectionName =
  | "markets"
  | "users"
  | "clients"
  | "sales"
  | "attendance"
  | "inventory"
  | "movements"
  | "assignments"
  | "closures"
  | "productPrices";
type StorageSnapshot = Record<CollectionName, StoredRecord[]>;

const collectionConfig: Record<CollectionName, { table: string; key: string; column: string }> = {
  markets: { table: "markets", key: "id", column: "id" },
  users: { table: "users", key: "dni", column: "dni" },
  clients: { table: "clients", key: "id", column: "id" },
  sales: { table: "sales", key: "id", column: "id" },
  attendance: { table: "attendance", key: "id", column: "id" },
  inventory: { table: "inventory", key: "marketId", column: "market_id" },
  movements: { table: "inventory_movements", key: "id", column: "id" },
  assignments: { table: "assignments", key: "promoterId", column: "promoter_id" },
  closures: { table: "session_closures", key: "id", column: "id" },
  productPrices: { table: "product_prices", key: "sku", column: "sku" },
};

const operationalCollections = new Set<CollectionName>([
  "sales",
  "attendance",
  "movements",
  "closures",
]);

function emptySnapshot(): StorageSnapshot {
  return {
    markets: [],
    users: [],
    clients: [],
    sales: [],
    attendance: [],
    inventory: [],
    movements: [],
    assignments: [],
    closures: [],
    productPrices: [],
  };
}

function value(record: StoredRecord, key: string) {
  return String(record[key] ?? "").trim();
}

function numeric(record: StoredRecord, key: string) {
  const result = Number(record[key]);
  return Number.isFinite(result) ? result : 0;
}

function dateValue(record: StoredRecord) {
  const raw = value(record, "date");
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function recordDate(record: StoredRecord) {
  return value(record, "updatedAt") || value(record, "date") || null;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `${salt}:${derived.toString("hex")}`;
}

async function verifyPassword(password: string, stored: string) {
  const [salt, hex] = stored.split(":");
  if (!salt || !hex) return false;
  const expected = Buffer.from(hex, "hex");
  const actual = (await scrypt(password, salt, expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function publicUser(record: StoredRecord) {
  const { password: _password, ...safe } = record;
  return safe;
}

function isRecord(value: unknown): value is StoredRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

async function lockInventoryLedger(client: QueryClient) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('inventory_ledger',0))");
}

async function lockAndValidateCatalogRevision(client: QueryClient, incomingRevision: string | null) {
  await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('catalog_revision',0))");
  const currentRevision = await readCatalogRevision(client);
  return !currentRevision || incomingRevision === currentRevision;
}

async function readCatalogRevision(client: QueryClient = pool as unknown as QueryClient) {
  const result = await client.query("SELECT value FROM app_metadata WHERE key=$1", ["catalog_revision"]);
  return value(result.rows[0] || {}, "value") || null;
}

function canjeSnapshot(snapshot: StorageSnapshot) {
  return [
    ...snapshot.movements
      .filter((movement) => value(movement, "kind") === "CANJE" || (value(movement, "kind") === "AJUSTE_CANJES" && value(movement, "canjeProductId")))
      .map((movement) => ({ ...movement, source: "movement", canjeId: value(movement, "id") })),
    ...snapshot.sales
      .filter((sale) => value(sale, "mode") === "CANJE")
      .map((sale) => ({ ...sale, source: "sale", canjeId: value(sale, "id") })),
  ].sort((first, second) => recordDate(second)?.localeCompare(recordDate(first) || "") || 0);
}

function degustacionSnapshot(snapshot: StorageSnapshot) {
  return snapshot.movements
    .filter((movement) => value(movement, "kind") === "AJUSTE_DEGUSTACION" && value(movement, "degustacionProductId"))
    .map((movement) => ({ ...movement, source: "movement", degustacionId: value(movement, "id") }))
    .sort((first, second) => recordDate(second)?.localeCompare(recordDate(first) || "") || 0);
}

async function readSnapshot(client: QueryClient = pool as unknown as QueryClient) {
  const snapshot = emptySnapshot();
  for (const name of Object.keys(collectionConfig) as CollectionName[]) {
    const { table } = collectionConfig[name];
    const result = await client.query(`SELECT data FROM ${table} ORDER BY created_at`);
    snapshot[name] = result.rows.map((row) =>
      name === "users" ? publicUser(row.data as StoredRecord) : row.data as StoredRecord,
    );
  }
  return snapshot;
}

function saleIdFromCanjeMovement(record: StoredRecord) {
  const id = value(record, "id");
  const match = id.match(/^CAN-(.+)-(AVENA|BATEA|MANDIL|SPAGHETTI)$/);
  return match?.[1] || null;
}

function movementItemQuantity(record: StoredRecord, itemId: string) {
  const quantity = numeric(record, "quantity");
  const components = isRecord(record.canjeComponents) ? record.canjeComponents : null;
  if (components) return (Number(components[itemId]) || 0) * quantity;
  return value(record, "itemId") === itemId ? quantity : 0;
}

async function reconcileInventoryFromMovements(client: QueryClient) {
  const movementResult = await client.query(
    `SELECT market_id,kind,item_id,quantity,data
     FROM inventory_movements
     WHERE kind IN ('AJUSTE_DEGUSTACION','DEGUSTACION','AJUSTE_CANJES','CANJE')
     ORDER BY created_at`,
  );
  const inventoryResult = await client.query(
    "SELECT market_id,tasting_stock,redemption_stock,data FROM inventory",
  );
  const inventoryByMarket = new Map(inventoryResult.rows.map((row) => [String(row.market_id), row]));
  const movementsByMarket = new Map<string, StoredRecord[]>();
  for (const row of movementResult.rows) {
    const marketId = String(row.market_id);
    const source = isRecord(row.data) ? row.data : {};
    const movement = {
      ...source,
      marketId,
      kind: String(row.kind),
      itemId: row.item_id == null ? value(source, "itemId") : String(row.item_id),
      quantity: Number(row.quantity) || 0,
    };
    const current = movementsByMarket.get(marketId) || [];
    current.push(movement);
    movementsByMarket.set(marketId, current);
  }
  const itemIds = ["AVENA", "BATEA", "MANDIL", "SPAGHETTI"];
  for (const [marketId, movements] of movementsByMarket) {
    const current = inventoryByMarket.get(marketId);
    const currentData = isRecord(current?.data) ? current.data : {};
    const currentRedemption = isRecord(current?.redemption_stock) ? current.redemption_stock : {};
    const tastingMovements = movements.filter((movement) =>
      value(movement, "kind") === "AJUSTE_DEGUSTACION" || value(movement, "kind") === "DEGUSTACION");
    const tastingStock = tastingMovements.length
      ? Math.max(0, tastingMovements.reduce((total, movement) =>
        total + (value(movement, "kind") === "AJUSTE_DEGUSTACION"
          ? numeric(movement, "quantity")
          : -Math.max(0, numeric(movement, "quantity"))), 0))
      : Math.max(0, Number(current?.tasting_stock) || 0);
    const redemptionStock = Object.fromEntries(itemIds.map((itemId) => {
      const itemMovements = movements.filter((movement) =>
        (value(movement, "kind") === "AJUSTE_CANJES" || value(movement, "kind") === "CANJE")
        && movementItemQuantity(movement, itemId) !== 0);
      const quantity = itemMovements.length
        ? Math.max(0, itemMovements.reduce((total, movement) =>
          total + (value(movement, "kind") === "AJUSTE_CANJES"
            ? movementItemQuantity(movement, itemId)
            : -Math.max(0, movementItemQuantity(movement, itemId))), 0))
        : Math.max(0, Number(currentRedemption[itemId]) || 0);
      return [itemId, quantity];
    }));
    const updatedAt = new Date().toISOString();
    const inventoryData = { ...currentData, marketId, tastingStock, redemptionStock, updatedAt };
    await client.query(
      `INSERT INTO inventory (market_id,tasting_stock,redemption_stock,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (market_id) DO UPDATE SET tasting_stock=EXCLUDED.tasting_stock,
       redemption_stock=EXCLUDED.redemption_stock,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [marketId, tastingStock, redemptionStock, inventoryData, updatedAt],
    );
  }
}

async function upsertRecord(
  client: QueryClient,
  name: CollectionName,
  source: StoredRecord,
) {
  const config = collectionConfig[name];
  const key = value(source, config.key);
  if (!key) return;
  const normalized: StoredRecord = operationalCollections.has(name)
    ? { ...source, status: "SINCRONIZADA" }
    : { ...source };
  if (name === "users") delete normalized.password;
  const updated = recordDate(source);

  if (name === "markets") {
    await client.query(
      `INSERT INTO markets (id,name,region,department,province,district,status,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,region=EXCLUDED.region,department=EXCLUDED.department,
       province=EXCLUDED.province,district=EXCLUDED.district,status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, value(source, "name"), value(source, "region") || null, value(source, "department") || null,
        value(source, "province") || null, value(source, "district") || null, value(source, "status") || "ACTIVO",
        normalized, updated],
    );
  } else if (name === "users") {
    const password = value(source, "password");
    const passwordHash = password ? await hashPassword(password) : null;
    const existingByDni = await client.query("SELECT id FROM users WHERE dni=$1 LIMIT 1", [key]);
    let userId = value(source, "id") || key;
    if (existingByDni.rows[0]?.id) {
      userId = String(existingByDni.rows[0].id);
    } else {
      const existingById = await client.query("SELECT id FROM users WHERE id=$1 LIMIT 1", [userId]);
      if (existingById.rows[0]?.id) userId = `USR-${key}`;
    }
    const userData = { ...normalized, id: userId };
    await client.query(
      `INSERT INTO users (id,dni,name,role,status,password_hash,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dni) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,status=EXCLUDED.status,
       password_hash=COALESCE(EXCLUDED.password_hash,users.password_hash),data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [userId, key, value(source, "name"), value(source, "role"),
        value(source, "status") || "ACTIVO", passwordHash, userData, updated],
    );
  } else if (name === "clients") {
    await client.query(
      `INSERT INTO clients (id,code,name,market_id,status,data,record_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,market_id=EXCLUDED.market_id,
       status=EXCLUDED.status,data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, value(source, "code") || key, value(source, "name"), value(source, "marketId"),
        value(source, "status") || "ACTIVO", normalized, updated],
    );
  } else if (name === "sales") {
    await client.query(
      `INSERT INTO sales (id,promoter_id,client_id,market_id,mode,units,amount_soles,weight_kg,sale_date,status,receipt_photo,exchange_photo,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET receipt_photo=EXCLUDED.receipt_photo,exchange_photo=EXCLUDED.exchange_photo,
       status=EXCLUDED.status,data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, value(source, "promoterId"), value(source, "clientId"), value(source, "marketId"), value(source, "mode"),
        numeric(source, "units"), numeric(source, "amountSoles"), source.weightKg == null ? null : numeric(source, "weightKg"),
        dateValue(source), "SINCRONIZADA", value(source, "receiptPhoto") || null, value(source, "exchangePhoto") || null,
        normalized, updated],
    );
  } else if (name === "attendance") {
    await client.query(
      `INSERT INTO attendance (id,promoter_id,client_id,market_id,event_type,event_date,status,photo,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET photo=EXCLUDED.photo,status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, value(source, "promoterId"), value(source, "clientId"), value(source, "marketId"), value(source, "type"),
        dateValue(source), "SINCRONIZADA", value(source, "photo") || null, normalized, updated],
    );
  } else if (name === "inventory") {
    await client.query(
      `INSERT INTO inventory (market_id,tasting_stock,redemption_stock,data,record_updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (market_id) DO UPDATE SET tasting_stock=EXCLUDED.tasting_stock,redemption_stock=EXCLUDED.redemption_stock,
       data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, numeric(source, "tastingStock"), source.redemptionStock ?? {}, normalized, updated],
    );
  } else if (name === "movements") {
    await client.query(
      `INSERT INTO inventory_movements (id,market_id,kind,item_id,quantity,actor_id,movement_date,status,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, value(source, "marketId"), value(source, "kind"), value(source, "itemId") || null,
        numeric(source, "quantity"), value(source, "actorId"), dateValue(source), "SINCRONIZADA", normalized, updated],
    );
  } else if (name === "assignments") {
    await client.query(
      `INSERT INTO assignments (promoter_id,promoter_dni,market_ids,client_ids,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (promoter_id) DO UPDATE SET promoter_dni=EXCLUDED.promoter_dni,market_ids=EXCLUDED.market_ids,
       client_ids=EXCLUDED.client_ids,data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()
       WHERE assignments.record_updated_at <= EXCLUDED.record_updated_at`,
      [key, value(source, "promoterDni") || null, Array.isArray(source.marketIds) ? source.marketIds : [],
        Array.isArray(source.clientIds) ? source.clientIds : [], normalized, updated ?? new Date().toISOString()],
    );
  } else if (name === "closures") {
    await client.query(
      `INSERT INTO session_closures (id,promoter_id,market_id,client_id,tasting_used,leads,closure_date,status,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, value(source, "promoterId"), value(source, "marketId"), value(source, "clientId") || null,
        numeric(source, "tastingUsed"), numeric(source, "leads"), dateValue(source), "SINCRONIZADA", normalized, updated],
    );
  } else if (name === "productPrices") {
    await client.query(
      `INSERT INTO product_prices (sku,product,units_per_package,unit_price,total_price,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sku) DO UPDATE SET product=EXCLUDED.product,units_per_package=EXCLUDED.units_per_package,
       unit_price=EXCLUDED.unit_price,total_price=EXCLUDED.total_price,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [key, value(source, "product") || key, numeric(source, "unitsPerPackage"), numeric(source, "unitPrice"),
        numeric(source, "totalPrice"), normalized, updated ?? new Date().toISOString()],
    );
  }
}

async function syncSnapshot(incoming: Partial<StorageSnapshot>, incomingRevision?: string | null) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock_shared(hashtextextended('catalog_revision',0))");
    const catalogRevision = await readCatalogRevision(client as unknown as QueryClient);
    const catalogIsAuthorized = !catalogRevision || incomingRevision === catalogRevision;
    const guardedIncoming: Partial<StorageSnapshot> = catalogRevision && !catalogIsAuthorized
      ? {
        ...incoming,
        markets: [],
        clients: [],
        inventory: [],
        assignments: [],
        movements: [],
        sales: [],
        attendance: [],
        closures: [],
        users: Array.isArray(incoming.users) ? incoming.users.filter((user) => value(user, "role") === "ANALISTA") : incoming.users,
      }
      : incoming;
    const saleIdsToLock = new Set<string>();
    for (const sale of Array.isArray(guardedIncoming.sales) ? guardedIncoming.sales : []) {
      const saleId = value(sale, "id");
      if (saleId) saleIdsToLock.add(saleId);
    }
    for (const movement of Array.isArray(guardedIncoming.movements) ? guardedIncoming.movements : []) {
      const saleId = saleIdFromCanjeMovement(movement);
      if (saleId) saleIdsToLock.add(saleId);
    }
    for (const saleId of [...saleIdsToLock].sort()) {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`sale:${saleId}`]);
    }
    await lockInventoryLedger(client as unknown as QueryClient);
    const deletedSalesResult = await client.query(
      "SELECT record_id FROM app_storage_tombstones WHERE collection='sales'",
    );
    const deletedSaleIds = new Set(deletedSalesResult.rows.map((row) => String(row.record_id)));
    for (const name of Object.keys(collectionConfig) as CollectionName[]) {
      if (name === "inventory") continue;
      const records = Array.isArray(guardedIncoming[name]) ? guardedIncoming[name] : [];
      for (const record of records) {
        if (name === "sales" && record && typeof record === "object" && deletedSaleIds.has(value(record, "id"))) continue;
        if (name === "movements" && record && typeof record === "object") {
          const saleId = saleIdFromCanjeMovement(record);
          if (saleId && deletedSaleIds.has(saleId)) continue;
        }
        if (record && typeof record === "object") await upsertRecord(client as unknown as QueryClient, name, record);
      }
    }
    await reconcileInventoryFromMovements(client as unknown as QueryClient);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return readSnapshot();
}

router.get("/app-storage", async (req, res): Promise<void> => {
  try {
    res.json({ storage: "replit-postgresql", catalogRevision: await readCatalogRevision(), snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to read app storage");
    res.status(500).json({ message: "No se pudo leer PostgreSQL." });
  }
});

router.post("/app-storage/sync", async (req, res): Promise<void> => {
  try {
    const incoming = req.body?.snapshot;
    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
      res.status(400).json({ message: "El snapshot es obligatorio." });
      return;
    }
    const incomingRevision = typeof req.body?.catalogRevision === "string" ? req.body.catalogRevision : null;
    const snapshot = await syncSnapshot(incoming as Partial<StorageSnapshot>, incomingRevision);
    res.json({ storage: "replit-postgresql", syncedAt: new Date().toISOString(), catalogRevision: await readCatalogRevision(), snapshot });
  } catch (error) {
    req.log.error({ err: error }, "Unable to sync app storage");
    res.status(500).json({ message: "No se pudo sincronizar PostgreSQL." });
  }
});

router.get("/app-storage/assignments", async (req, res): Promise<void> => {
  try {
    const { assignments } = await readSnapshot();
    res.json({ storage: "replit-postgresql", assignments });
  } catch (error) {
    req.log.error({ err: error }, "Unable to read assignments");
    res.status(500).json({ message: "No se pudieron leer las asignaciones." });
  }
});

router.post("/app-storage/assignments", async (req, res): Promise<void> => {
  try {
    const assignment = req.body?.assignment;
    if (!assignment || typeof assignment !== "object" || !value(assignment, "promoterId")) {
      res.status(400).json({ message: "La asignación requiere promoterId." });
      return;
    }
    await syncSnapshot({ assignments: [assignment] }, await readCatalogRevision());
    const { assignments } = await readSnapshot();
    res.json({ storage: "replit-postgresql", assignment, assignments });
  } catch (error) {
    req.log.error({ err: error }, "Unable to save assignment");
    res.status(500).json({ message: "No se pudo guardar la asignación." });
  }
});

router.post("/app-storage/admin/markets", async (req, res): Promise<void> => {
  const input = req.body?.market;
  if (!isRecord(input) || !value(input, "name") || !value(input, "department") || !value(input, "province") || !value(input, "district")) {
    res.status(400).json({ message: "El mercado requiere nombre, departamento, provincia y distrito." });
    return;
  }
  const market: StoredRecord = {
    id: value(input, "id") || `MKT-${randomUUID()}`,
    name: value(input, "name").toUpperCase(),
    region: value(input, "region").toUpperCase() || value(input, "department").toUpperCase(),
    department: value(input, "department").toUpperCase(),
    province: value(input, "province").toUpperCase(),
    district: value(input, "district").toUpperCase(),
    status: "ACTIVO",
    updatedAt: new Date().toISOString(),
  };
  try {
    await upsertRecord(pool as unknown as QueryClient, "markets", market);
    res.status(201).json({ market, snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create market");
    res.status(500).json({ message: "No se pudo crear el mercado." });
  }
});

router.delete("/app-storage/admin/markets/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ message: "El mercado es obligatorio." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockInventoryLedger(client as unknown as QueryClient);
    await client.query("DELETE FROM clients WHERE market_id=$1", [id]);
    await client.query("DELETE FROM inventory WHERE market_id=$1", [id]);
    await client.query("DELETE FROM inventory_movements WHERE market_id=$1", [id]);
    await client.query("DELETE FROM markets WHERE id=$1", [id]);
    await client.query("COMMIT");
    res.json({ deleted: id, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to delete market");
    res.status(500).json({ message: "No se pudo eliminar el mercado." });
  } finally {
    client.release();
  }
});

router.post("/app-storage/admin/clients", async (req, res): Promise<void> => {
  const input = req.body?.client;
  const category = isRecord(input) ? value(input, "category").toUpperCase() : "";
  if (!isRecord(input) || !value(input, "name") || !value(input, "marketId") || !["MIXTO", "CONFETI"].includes(category)) {
    res.status(400).json({ message: "El cliente requiere nombre, mercado y categoría MIXTO o CONFETI." });
    return;
  }
  const id = value(input, "id") || randomUUID();
  const clientRecord: StoredRecord = {
    id,
    code: value(input, "code") || `CLI-${id.slice(0, 8).toUpperCase()}`,
    name: value(input, "name"),
    phone: value(input, "phone") || undefined,
    category,
    marketId: value(input, "marketId"),
    status: "ACTIVO",
    updatedAt: new Date().toISOString(),
  };
  try {
    await upsertRecord(pool as unknown as QueryClient, "clients", clientRecord);
    res.status(201).json({ client: clientRecord, snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create client");
    res.status(500).json({ message: "No se pudo crear el cliente." });
  }
});

router.delete("/app-storage/admin/clients/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ message: "El cliente es obligatorio." });
    return;
  }
  try {
    await pool.query("DELETE FROM clients WHERE id=$1", [id]);
    res.json({ deleted: id, snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to delete client");
    res.status(500).json({ message: "No se pudo eliminar el cliente." });
  }
});

router.put("/app-storage/admin/sales/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id || "").trim();
  const input = req.body?.sale;
  const amountSoles = isRecord(input) ? Number(input.amountSoles) : Number.NaN;
  if (!id || !isRecord(input) || !value(input, "clientId") || !Number.isFinite(amountSoles) || amountSoles <= 0) {
    res.status(400).json({ message: "La venta requiere cliente e importe mayor a cero." });
    return;
  }
  try {
    const existing = await pool.query(
      "SELECT data FROM sales WHERE id=$1 LIMIT 1",
      [id],
    ) as unknown as { rows: Array<{ data: StoredRecord }> };
    if (!existing.rows[0]) {
      res.status(404).json({ message: "La venta no existe." });
      return;
    }
    const updatedAt = new Date().toISOString();
    const sale = {
      ...existing.rows[0].data,
      id,
      clientId: value(input, "clientId"),
      amountSoles,
      comment: value(input, "comment") || undefined,
      status: "SINCRONIZADA",
      updatedAt,
    };
    await pool.query(
      `UPDATE sales
       SET client_id=$2,amount_soles=$3,status='SINCRONIZADA',data=$4,record_updated_at=$5,updated_at=now()
       WHERE id=$1`,
      [id, sale.clientId, amountSoles, sale, updatedAt],
    );
    res.json({ sale, snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to update sale");
    res.status(500).json({ message: "No se pudo editar la venta." });
  }
});

router.delete("/app-storage/admin/sales/:id", async (req, res): Promise<void> => {
  const id = String(req.params.id || "").trim();
  if (!id) {
    res.status(400).json({ message: "La venta es obligatoria." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const revisionIsCurrent = await lockAndValidateCatalogRevision(
      client as unknown as QueryClient,
      req.get("x-catalog-revision") || null,
    );
    if (!revisionIsCurrent) {
      await client.query("ROLLBACK");
      res.status(409).json({ message: "La información cambió. Actualiza la aplicación antes de eliminar nuevamente." });
      return;
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`sale:${id}`]);
    await lockInventoryLedger(client as unknown as QueryClient);
    const saleResult = await client.query(
      "SELECT id FROM sales WHERE id=$1 FOR UPDATE",
      [id],
    );
    const saleExisted = Boolean(saleResult.rows[0]);
    const movementPrefix = `CAN-${id}-`;
    const movementResult = await client.query(
      `SELECT market_id,item_id,quantity,data
       FROM inventory_movements
       WHERE kind='CANJE' AND left(id,length($1))=$1
       FOR UPDATE`,
      [movementPrefix],
    ) as unknown as {
      rows: Array<{ market_id: string; item_id: string | null; quantity: number; data: StoredRecord }>;
    };
    const movementsByMarket = new Map<string, typeof movementResult.rows>();
    for (const movement of movementResult.rows) {
      const current = movementsByMarket.get(movement.market_id) || [];
      current.push(movement);
      movementsByMarket.set(movement.market_id, current);
    }
    for (const [marketId, saleMovements] of movementsByMarket) {
      const inventoryResult = await client.query(
        "SELECT redemption_stock,data FROM inventory WHERE market_id=$1 FOR UPDATE",
        [marketId],
      ) as unknown as { rows: Array<{ redemption_stock: Record<string, number>; data: StoredRecord }> };
      const current = inventoryResult.rows[0];
      if (!current) continue;
      const redemptionStock = { ...(current.redemption_stock || {}) };
      for (const movement of saleMovements) {
        const source = isRecord(movement.data) ? movement.data : {};
        const components = isRecord(source.canjeComponents) ? source.canjeComponents : null;
        if (components) {
          for (const [itemId, componentQuantity] of Object.entries(components)) {
            redemptionStock[itemId] = Math.max(0, Number(redemptionStock[itemId]) || 0)
              + Math.max(0, Number(componentQuantity) || 0) * Math.max(0, Number(movement.quantity) || 0);
          }
        } else {
          const itemId = movement.item_id || value(source, "itemId");
          if (itemId) {
            redemptionStock[itemId] = Math.max(0, Number(redemptionStock[itemId]) || 0)
              + Math.max(0, Number(movement.quantity) || 0);
          }
        }
      }
      const updatedAt = new Date().toISOString();
      const inventoryData = { ...(current.data || {}), redemptionStock, updatedAt };
      await client.query(
        "UPDATE inventory SET redemption_stock=$2,data=$3,record_updated_at=$4,updated_at=now() WHERE market_id=$1",
        [marketId, redemptionStock, inventoryData, updatedAt],
      );
    }
    await client.query(
      "DELETE FROM inventory_movements WHERE kind='CANJE' AND left(id,length($1))=$1",
      [movementPrefix],
    );
    await client.query(
      `INSERT INTO app_storage_tombstones (collection,record_id,deleted_at)
       VALUES ('sales',$1,now())
       ON CONFLICT (collection,record_id) DO UPDATE SET deleted_at=now(),updated_at=now()`,
      [id],
    );
    await client.query("DELETE FROM sales WHERE id=$1", [id]);
    await client.query("COMMIT");
    res.json({ deleted: id, saleExisted, restoredCanjeMovements: movementResult.rows.length, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to delete sale");
    res.status(500).json({ message: "No se pudo eliminar la venta." });
  } finally {
    client.release();
  }
});

router.get("/app-storage/admin/canjes", async (_req, res): Promise<void> => {
  try {
    const snapshot = await readSnapshot();
    res.json({ canjes: canjeSnapshot(snapshot) });
  } catch {
    res.status(500).json({ message: "No se pudieron leer los canjes." });
  }
});

router.post("/app-storage/admin/canjes", async (req, res): Promise<void> => {
  const input = req.body?.canje;
  if (!isRecord(input) || !value(input, "marketId") || (!value(input, "itemId") && !value(input, "canjeProductId")) || numeric(input, "quantity") <= 0) {
    res.status(400).json({ message: "El canje requiere mercado, producto y cantidad mayor a cero." });
    return;
  }
  const canje: StoredRecord = {
    id: value(input, "id") || `CANJE-${Date.now()}-${randomUUID().slice(0, 8)}`,
    marketId: value(input, "marketId"),
    kind: "AJUSTE_CANJES",
    itemId: value(input, "itemId") || undefined,
    canjeProductId: value(input, "canjeProductId") || undefined,
    canjeProductLabel: value(input, "canjeProductLabel") || undefined,
    canjeComponents: isRecord(input.canjeComponents) ? input.canjeComponents : undefined,
    quantity: Math.floor(numeric(input, "quantity")),
    actorId: value(input, "actorId") || "ADMIN",
    actorName: value(input, "actorName") || "Analista",
    date: value(input, "date") || new Date().toISOString(),
    status: "PENDIENTE",
  };
  const components = isRecord(canje.canjeComponents) ? canje.canjeComponents : {};
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockInventoryLedger(client as unknown as QueryClient);
    await upsertRecord(client as unknown as QueryClient, "movements", canje);
    const inventoryResult = await client.query(
      "SELECT tasting_stock, redemption_stock, data FROM inventory WHERE market_id=$1 FOR UPDATE",
      [canje.marketId],
    ) as unknown as { rows: Array<{ tasting_stock: number; redemption_stock: Record<string, number>; data: StoredRecord }> };
    const current = inventoryResult.rows[0];
    const redemptionStock = {
      AVENA: Math.max(0, Number(current?.redemption_stock?.AVENA) || 0),
      BATEA: Math.max(0, Number(current?.redemption_stock?.BATEA) || 0),
      MANDIL: Math.max(0, Number(current?.redemption_stock?.MANDIL) || 0),
      SPAGHETTI: Math.max(0, Number(current?.redemption_stock?.SPAGHETTI) || 0),
    };
    for (const itemId of Object.keys(redemptionStock)) {
      redemptionStock[itemId as keyof typeof redemptionStock] += Math.max(0, Number(components[itemId]) || 0) * Math.floor(numeric(canje, "quantity"));
    }
    const inventoryRecord: StoredRecord = {
      ...(current?.data || {}),
      marketId: canje.marketId,
      tastingStock: Math.max(0, Number(current?.tasting_stock) || 0),
      redemptionStock,
      updatedAt: canje.date,
    };
    await client.query(
      `INSERT INTO inventory (market_id,tasting_stock,redemption_stock,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (market_id) DO UPDATE SET redemption_stock=EXCLUDED.redemption_stock,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [canje.marketId, inventoryRecord.tastingStock, redemptionStock, inventoryRecord, canje.date],
    );
    await client.query("COMMIT");
    res.status(201).json({ canje, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to create canje");
    res.status(500).json({ message: "No se pudo crear el canje." });
  } finally {
    client.release();
  }
});

router.delete("/app-storage/admin/canjes/:source/:id", async (req, res): Promise<void> => {
  const source = String(req.params.source || "");
  const id = String(req.params.id || "").trim();
  const table = source === "movement" ? "inventory_movements" : source === "sale" ? "sales" : null;
  if (!table || !id) {
    res.status(400).json({ message: "El origen del canje no es válido." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (source === "sale") {
      const revisionIsCurrent = await lockAndValidateCatalogRevision(
        client as unknown as QueryClient,
        req.get("x-catalog-revision") || null,
      );
      if (!revisionIsCurrent) {
        await client.query("ROLLBACK");
        res.status(409).json({ message: "La información cambió. Actualiza la aplicación antes de eliminar nuevamente." });
        return;
      }
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`sale:${id}`]);
    }
    await lockInventoryLedger(client as unknown as QueryClient);
    if (source === "movement") {
      const result = await client.query(
        "SELECT market_id, quantity, data FROM inventory_movements WHERE id=$1 FOR UPDATE",
        [id],
      ) as unknown as { rows: Array<{ market_id: string; quantity: number; data: StoredRecord }> };
      const movement = result.rows[0];
      const productId = movement?.data?.canjeProductId;
      const components = isRecord(movement?.data?.canjeComponents) ? movement.data.canjeComponents : {};
      if (movement && value(movement.data, "kind") === "AJUSTE_CANJES" && productId) {
        const inventoryResult = await client.query(
          "SELECT redemption_stock, data FROM inventory WHERE market_id=$1 FOR UPDATE",
          [movement.market_id],
        ) as unknown as { rows: Array<{ redemption_stock: Record<string, number>; data: StoredRecord }> };
        const current = inventoryResult.rows[0];
        const redemptionStock = {
          AVENA: Math.max(0, Number(current?.redemption_stock?.AVENA) || 0),
          BATEA: Math.max(0, Number(current?.redemption_stock?.BATEA) || 0),
          MANDIL: Math.max(0, Number(current?.redemption_stock?.MANDIL) || 0),
          SPAGHETTI: Math.max(0, Number(current?.redemption_stock?.SPAGHETTI) || 0),
        };
        for (const itemId of Object.keys(redemptionStock)) {
          redemptionStock[itemId as keyof typeof redemptionStock] = Math.max(
            0,
            redemptionStock[itemId as keyof typeof redemptionStock] - (Math.max(0, Number(components[itemId]) || 0) * Math.max(0, Number(movement.quantity) || 0)),
          );
        }
        if (current) {
          const inventoryRecord = { ...(current.data || {}), redemptionStock, updatedAt: new Date().toISOString() };
          await client.query(
            "UPDATE inventory SET redemption_stock=$2,data=$3,record_updated_at=$4,updated_at=now() WHERE market_id=$1",
            [movement.market_id, redemptionStock, inventoryRecord, inventoryRecord.updatedAt],
          );
        }
      }
    }
    if (source === "sale") {
      await client.query(
        `INSERT INTO app_storage_tombstones (collection,record_id,deleted_at)
         VALUES ('sales',$1,now())
         ON CONFLICT (collection,record_id) DO UPDATE SET deleted_at=now(),updated_at=now()`,
        [id],
      );
    }
    await client.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    await client.query("COMMIT");
    res.json({ deleted: id, source, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to delete canje");
    res.status(500).json({ message: "No se pudo eliminar el canje." });
  } finally {
    client.release();
  }
});

router.get("/app-storage/admin/degustaciones", async (_req, res): Promise<void> => {
  try {
    const snapshot = await readSnapshot();
    res.json({ degustaciones: degustacionSnapshot(snapshot) });
  } catch {
    res.status(500).json({ message: "No se pudieron leer las degustaciones." });
  }
});

router.post("/app-storage/admin/degustaciones", async (req, res): Promise<void> => {
  const input = req.body?.degustacion;
  if (!isRecord(input) || !value(input, "marketId") || !value(input, "degustacionProductId") || numeric(input, "quantity") <= 0) {
    res.status(400).json({ message: "La degustación requiere mercado, producto y cantidad mayor a cero." });
    return;
  }
  const degustacion: StoredRecord = {
    id: value(input, "id") || `DEG-ABASTECIMIENTO-${Date.now()}-${randomUUID().slice(0, 8)}`,
    marketId: value(input, "marketId"),
    kind: "AJUSTE_DEGUSTACION",
    degustacionProductId: value(input, "degustacionProductId"),
    degustacionProductLabel: value(input, "degustacionProductLabel") || "Panetón",
    quantity: Math.floor(numeric(input, "quantity")),
    actorId: value(input, "actorId") || "ADMIN",
    actorName: value(input, "actorName") || "Analista",
    date: value(input, "date") || new Date().toISOString(),
    status: "PENDIENTE",
  };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockInventoryLedger(client as unknown as QueryClient);
    await upsertRecord(client as unknown as QueryClient, "movements", degustacion);
    const inventoryResult = await client.query(
      "SELECT tasting_stock, redemption_stock, data FROM inventory WHERE market_id=$1 FOR UPDATE",
      [degustacion.marketId],
    ) as unknown as { rows: Array<{ tasting_stock: number; redemption_stock: Record<string, number>; data: StoredRecord }> };
    const current = inventoryResult.rows[0];
    const redemptionStock = {
      AVENA: Math.max(0, Number(current?.redemption_stock?.AVENA) || 0),
      BATEA: Math.max(0, Number(current?.redemption_stock?.BATEA) || 0),
      MANDIL: Math.max(0, Number(current?.redemption_stock?.MANDIL) || 0),
      SPAGHETTI: Math.max(0, Number(current?.redemption_stock?.SPAGHETTI) || 0),
    };
    const inventoryRecord: StoredRecord = {
      ...(current?.data || {}),
      marketId: degustacion.marketId,
      tastingStock: Math.max(0, Number(current?.tasting_stock) || 0) + Math.floor(numeric(degustacion, "quantity")),
      redemptionStock,
      updatedAt: degustacion.date,
    };
    await client.query(
      `INSERT INTO inventory (market_id,tasting_stock,redemption_stock,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (market_id) DO UPDATE SET tasting_stock=EXCLUDED.tasting_stock,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [degustacion.marketId, inventoryRecord.tastingStock, redemptionStock, inventoryRecord, degustacion.date],
    );
    await client.query("COMMIT");
    res.status(201).json({ degustacion, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to create degustacion");
    res.status(500).json({ message: "No se pudo crear la degustación." });
  } finally {
    client.release();
  }
});

router.delete("/app-storage/admin/degustaciones/:source/:id", async (req, res): Promise<void> => {
  const source = String(req.params.source || "");
  const id = String(req.params.id || "").trim();
  if (source !== "movement" || !id) {
    res.status(400).json({ message: "El origen de la degustación no es válido." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await lockInventoryLedger(client as unknown as QueryClient);
    const result = await client.query(
      "SELECT market_id, quantity, data FROM inventory_movements WHERE id=$1 FOR UPDATE",
      [id],
    ) as unknown as { rows: Array<{ market_id: string; quantity: number; data: StoredRecord }> };
    const movement = result.rows[0];
    if (movement && value(movement.data, "kind") === "AJUSTE_DEGUSTACION" && value(movement.data, "degustacionProductId")) {
      const inventoryResult = await client.query(
        "SELECT tasting_stock, data FROM inventory WHERE market_id=$1 FOR UPDATE",
        [movement.market_id],
      ) as unknown as { rows: Array<{ tasting_stock: number; data: StoredRecord }> };
      const current = inventoryResult.rows[0];
      if (current) {
        const tastingStock = Math.max(0, Number(current.tasting_stock) || 0) - Math.max(0, Number(movement.quantity) || 0);
        const inventoryRecord = { ...(current.data || {}), tastingStock, updatedAt: new Date().toISOString() };
        await client.query(
          "UPDATE inventory SET tasting_stock=$2,data=$3,record_updated_at=$4,updated_at=now() WHERE market_id=$1",
          [movement.market_id, tastingStock, inventoryRecord, inventoryRecord.updatedAt],
        );
      }
    }
    await client.query("DELETE FROM inventory_movements WHERE id=$1", [id]);
    await client.query("COMMIT");
    res.json({ deleted: id, source, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to delete degustacion");
    res.status(500).json({ message: "No se pudo eliminar la degustación." });
  } finally {
    client.release();
  }
});

router.post("/app-storage/admin/cleanup", async (req, res): Promise<void> => {
  if (req.body?.confirmation !== "LIMPIAR_MERCADOS_CLIENTES_CANJES") {
    res.status(400).json({ message: "Confirmación inválida." });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('catalog_revision',0))");
    await lockInventoryLedger(client as unknown as QueryClient);
    await client.query("DELETE FROM sales");
    await client.query("DELETE FROM app_storage_tombstones");
    await client.query("DELETE FROM attendance");
    await client.query("DELETE FROM session_closures");
    await client.query("DELETE FROM inventory_movements");
    await client.query("DELETE FROM clients");
    await client.query("DELETE FROM inventory");
    await client.query("DELETE FROM markets");
    await client.query("DELETE FROM assignments");
    await client.query("DELETE FROM users WHERE role <> 'ANALISTA'");
    const catalogRevision = randomUUID();
    await client.query(
      `INSERT INTO app_metadata (key,value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
      ["catalog_revision", catalogRevision],
    );
    await client.query("COMMIT");
    res.json({ deleted: ["markets", "clients", "sales", "attendance", "session_closures", "inventory", "inventory_movements", "assignments", "non_analyst_users"], catalogRevision, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to clean catalogs");
    res.status(500).json({ message: "No se pudo limpiar la información." });
  } finally {
    client.release();
  }
});

router.post("/app-storage/login", async (req, res): Promise<void> => {
  const dni = String(req.body?.dni ?? "").trim();
  const password = String(req.body?.password ?? "");
  if (!/^\d{8}$/.test(dni) || !password) {
    res.status(400).json({ message: "DNI y clave son obligatorios." });
    return;
  }
  try {
    const result = await pool.query(
      "SELECT data,password_hash,status FROM users WHERE dni=$1 LIMIT 1",
      [dni],
    );
    const row = result.rows[0];
    if (!row || row.status !== "ACTIVO" || !row.password_hash ||
        !(await verifyPassword(password, row.password_hash))) {
      res.status(401).json({ message: "DNI o clave incorrectos." });
      return;
    }
    res.json({ user: publicUser(row.data as StoredRecord) });
  } catch (error) {
    req.log.error({ err: error }, "Unable to validate login");
    res.status(500).json({ message: "No se pudo validar el acceso." });
  }
});

export default router;