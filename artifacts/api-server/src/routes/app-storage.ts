import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "@workspace/db";
import { Router, type IRouter } from "express";

const router: IRouter = Router();
const scrypt = promisify(scryptCallback);

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

async function syncSnapshot(incoming: Partial<StorageSnapshot>) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const name of Object.keys(collectionConfig) as CollectionName[]) {
      const records = Array.isArray(incoming[name]) ? incoming[name] : [];
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
    const snapshot = await syncSnapshot(incoming as Partial<StorageSnapshot>);
    res.json({ storage: "replit-postgresql", syncedAt: new Date().toISOString(), snapshot });
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
    await syncSnapshot({ assignments: [assignment] });
    const { assignments } = await readSnapshot();
    res.json({ storage: "replit-postgresql", assignment, assignments });
  } catch (error) {
    req.log.error({ err: error }, "Unable to save assignment");
    res.status(500).json({ message: "No se pudo guardar la asignación." });
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