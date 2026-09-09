import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "@workspace/db";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const scrypt = promisify(scryptCallback);
let catalogRevision: string | null = null;

type StoredRecord = Record<string, unknown>;
type QueryClient = {
  query: (text: string, values?: unknown[]) => Promise<{ rows: Array<{ data: StoredRecord }> }>;
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

function canjeSnapshot(snapshot: StorageSnapshot) {
  return [
    ...snapshot.movements
      .filter((movement) => value(movement, "kind") === "CANJE")
      .map((movement) => ({ ...movement, source: "movement", canjeId: value(movement, "id") })),
    ...snapshot.sales
      .filter((sale) => value(sale, "mode") === "CANJE")
      .map((sale) => ({ ...sale, source: "sale", canjeId: value(sale, "id") })),
  ].sort((first, second) => recordDate(second)?.localeCompare(recordDate(first) || "") || 0);
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
    await client.query(
      `INSERT INTO users (id,dni,name,role,status,password_hash,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dni) DO UPDATE SET id=EXCLUDED.id,name=EXCLUDED.name,role=EXCLUDED.role,status=EXCLUDED.status,
       password_hash=COALESCE(EXCLUDED.password_hash,users.password_hash),data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [value(source, "id") || key, key, value(source, "name"), value(source, "role"),
        value(source, "status") || "ACTIVO", passwordHash, normalized, updated],
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
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const name of Object.keys(collectionConfig) as CollectionName[]) {
      const records = Array.isArray(guardedIncoming[name]) ? guardedIncoming[name] : [];
      for (const record of records) {
        if (record && typeof record === "object") await upsertRecord(client as unknown as QueryClient, name, record);
      }
    }
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
    res.json({ storage: "replit-postgresql", snapshot: await readSnapshot() });
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
    res.json({ storage: "replit-postgresql", syncedAt: new Date().toISOString(), catalogRevision, snapshot });
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
    await syncSnapshot({ assignments: [assignment] }, catalogRevision);
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
  if (!isRecord(input) || !value(input, "name") || !value(input, "marketId")) {
    res.status(400).json({ message: "El cliente requiere nombre y mercado." });
    return;
  }
  const id = value(input, "id") || randomUUID();
  const clientRecord: StoredRecord = {
    id,
    code: value(input, "code") || `CLI-${id.slice(0, 8).toUpperCase()}`,
    name: value(input, "name"),
    phone: value(input, "phone") || undefined,
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
  if (!isRecord(input) || !value(input, "marketId") || !value(input, "itemId") || numeric(input, "quantity") <= 0) {
    res.status(400).json({ message: "El canje requiere mercado, producto y cantidad mayor a cero." });
    return;
  }
  const canje: StoredRecord = {
    id: value(input, "id") || `CANJE-${Date.now()}-${randomUUID().slice(0, 8)}`,
    marketId: value(input, "marketId"),
    kind: "CANJE",
    itemId: value(input, "itemId"),
    quantity: Math.floor(numeric(input, "quantity")),
    actorId: value(input, "actorId") || "ADMIN",
    actorName: value(input, "actorName") || "Analista",
    date: value(input, "date") || new Date().toISOString(),
    status: "PENDIENTE",
  };
  try {
    await upsertRecord(pool as unknown as QueryClient, "movements", canje);
    res.status(201).json({ canje, snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create canje");
    res.status(500).json({ message: "No se pudo crear el canje." });
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
  try {
    await pool.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
    res.json({ deleted: id, source, snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to delete canje");
    res.status(500).json({ message: "No se pudo eliminar el canje." });
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
    await client.query("DELETE FROM sales");
    await client.query("DELETE FROM attendance");
    await client.query("DELETE FROM session_closures");
    await client.query("DELETE FROM inventory_movements");
    await client.query("DELETE FROM clients");
    await client.query("DELETE FROM inventory");
    await client.query("DELETE FROM markets");
    await client.query("DELETE FROM assignments");
    await client.query("DELETE FROM users WHERE role <> 'ANALISTA'");
    await client.query("COMMIT");
    catalogRevision = randomUUID();
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