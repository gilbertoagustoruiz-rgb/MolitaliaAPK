import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { pool } from "@workspace/db";
import { Router, type IRouter } from "express";
import { backupSnapshot } from "./google-sheets-storage";

const router: IRouter = Router();
const scrypt = promisify(scryptCallback);
const googleSheetsBackupEnabled = process.env.GOOGLE_SHEETS_BACKUP_ENABLED === "true";
const googleSheetsBackupPendingKey = "google_sheets_backup_pending";
const googleSheetsBackupLastSuccessKey = "google_sheets_backup_last_success";
const googleSheetsBackupLastErrorKey = "google_sheets_backup_last_error";
const promoterStockBaselineKey = "promoter_stock_baseline_v2";
const promoterRoles = ["PROMOTOR", "PROMOTOR ROTATIVO", "PROMOTOR PERMANENTE"];
const promoterStockBaseline = {
  tastingStock: 50,
  redemptionStock: { AVENA: 120, BATEA: 50, MANDIL: 50, SPAGHETTI: 100 },
};
let googleSheetsBackupTimer: NodeJS.Timeout | null = null;
let googleSheetsBackupRunning = false;
const campaignTimeZone = "America/Lima";
const automaticClosureIntervalMs = 30_000;
let lastPreviousDayAutomaticClosureSweep = "";
let lastCurrentDayAutomaticClosureSweep = "";

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

function campaignDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: campaignTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value || "";
  return {
    day: `${part("year")}-${part("month")}-${part("day")}`,
    hour: Number(part("hour")),
    minute: Number(part("minute")),
  };
}

function previousCampaignDay(day: string) {
  const date = new Date(`${day}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function campaignDayBounds(day: string) {
  return {
    start: `${day}T00:00:00.000-05:00`,
    end: `${day}T23:59:59.999-05:00`,
    closureDate: `${day}T23:59:00.000-05:00`,
  };
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

async function ensurePromoterStockBaseline() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('promoter_stock_baseline',0))");
    const alreadySeeded = await client.query("SELECT value FROM app_metadata WHERE key=$1 FOR UPDATE", [promoterStockBaselineKey]);
    if (alreadySeeded.rows[0]?.value === "applied") {
      await client.query("COMMIT");
      return;
    }
    const updatedAt = new Date().toISOString();
    const result = await client.query(
      `SELECT id,data FROM users
       WHERE status='ACTIVO'
         AND data->>'role' = ANY($1::text[])
       FOR UPDATE`,
      [promoterRoles],
    );
    for (const row of result.rows) {
      const current = isRecord(row.data) ? row.data : {};
      const next = {
        ...current,
        tastingStock: promoterStockBaseline.tastingStock,
        redemptionStock: { ...promoterStockBaseline.redemptionStock },
        updatedAt,
      };
      await client.query(
        "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
        [row.id, next, updatedAt],
      );
    }
    await client.query(
      `INSERT INTO app_metadata (key,value)
       VALUES ($1,'applied')
       ON CONFLICT (key) DO UPDATE SET value='applied',updated_at=now()`,
      [promoterStockBaselineKey],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
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

async function readSnapshot(client: QueryClient = pool as unknown as QueryClient) {
  const snapshot = emptySnapshot();
  for (const name of Object.keys(collectionConfig) as CollectionName[]) {
    const { table } = collectionConfig[name];
    const orderBy = name === "attendance"
      ? "event_date DESC, created_at DESC"
      : name === "closures"
        ? "closure_date DESC, created_at DESC"
        : "created_at";
    const result = await client.query(`SELECT data FROM ${table} ORDER BY ${orderBy}`);
    snapshot[name] = result.rows.map((row) =>
      name === "users" ? publicUser(row.data as StoredRecord) : row.data as StoredRecord,
    );
  }
  return snapshot;
}

async function setBackupMetadata(key: string, valueToStore: string | null) {
  if (valueToStore === null) {
    await pool.query("DELETE FROM app_metadata WHERE key=$1", [key]);
    return;
  }
  await pool.query(
    `INSERT INTO app_metadata (key,value)
     VALUES ($1,$2)
     ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value,updated_at=now()`,
    [key, valueToStore],
  );
}

function scheduleGoogleSheetsBackup(delayMs = 250) {
  if (googleSheetsBackupTimer) return;
  googleSheetsBackupTimer = setTimeout(() => {
    googleSheetsBackupTimer = null;
    void runGoogleSheetsBackup();
  }, delayMs);
  googleSheetsBackupTimer.unref();
}

async function requestGoogleSheetsBackup(reason: string) {
  if (!googleSheetsBackupEnabled) return;
  try {
    await setBackupMetadata(
      googleSheetsBackupPendingKey,
      JSON.stringify({ requestedAt: new Date().toISOString(), reason }),
    );
    scheduleGoogleSheetsBackup();
  } catch (error) {
    console.error("Unable to queue Google Sheets backup", error);
    scheduleGoogleSheetsBackup(10_000);
  }
}

async function createAutomaticClosuresForDay(day: string) {
  const bounds = campaignDayBounds(day);
  const client = await pool.connect();
  let created = 0;
  try {
    await client.query("BEGIN");
    const lock = await client.query(
      "SELECT pg_try_advisory_xact_lock(hashtextextended($1,0)) AS locked",
      [`automatic_closures:${day}`],
    );
    if (!lock.rows[0]?.locked) {
      await client.query("ROLLBACK");
      return 0;
    }
    const openPromoters = await client.query(
      `SELECT DISTINCT ON (attendance.promoter_id)
         attendance.promoter_id,attendance.market_id,attendance.client_id,users.data AS user_data
       FROM attendance
       JOIN users ON users.id=attendance.promoter_id
       WHERE attendance.event_date >= $1::timestamptz
         AND attendance.event_date <= $2::timestamptz
         AND NOT EXISTS (
           SELECT 1 FROM session_closures
           WHERE session_closures.promoter_id=attendance.promoter_id
             AND session_closures.closure_date >= $1::timestamptz
             AND session_closures.closure_date <= $2::timestamptz
         )
       ORDER BY attendance.promoter_id,attendance.event_date DESC,attendance.created_at DESC`,
      [bounds.start, bounds.end],
    );
    for (const row of openPromoters.rows) {
      const promoterId = String(row.promoter_id || "");
      const marketId = String(row.market_id || "");
      if (!promoterId || !marketId) continue;
      const userData = isRecord(row.user_data) ? row.user_data : {};
      const closure: StoredRecord = {
        id: `CIERRE-AUTO-${day}-${promoterId}`,
        promoterId,
        promoterRole: value(userData, "role") || undefined,
        promoterRoleLabel: value(userData, "roleLabel") || value(userData, "role") || undefined,
        marketId,
        clientId: row.client_id ? String(row.client_id) : undefined,
        tastingUsed: 0,
        leads: 0,
        automatic: true,
        closureType: "AUTOMATICO",
        evidence: `Cierre automático generado por el sistema a las 23:59 (hora de Lima) por falta de cierre manual del ${day}.`,
        date: new Date(bounds.closureDate).toISOString(),
        status: "SINCRONIZADA",
      };
      await upsertRecord(client as unknown as QueryClient, "closures", closure);
      created += 1;
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error(`Unable to create automatic closures for ${day}`, error);
  } finally {
    client.release();
  }
  if (created) {
    void requestGoogleSheetsBackup(`cierres automáticos del ${day}`);
  }
  return created;
}

async function runAutomaticClosureSweep() {
  const current = campaignDateParts();
  const previousDay = previousCampaignDay(current.day);
  if (lastPreviousDayAutomaticClosureSweep !== previousDay) {
    await createAutomaticClosuresForDay(previousDay);
    lastPreviousDayAutomaticClosureSweep = previousDay;
  }
  if (current.hour === 23 && current.minute >= 59 && lastCurrentDayAutomaticClosureSweep !== current.day) {
    await createAutomaticClosuresForDay(current.day);
    lastCurrentDayAutomaticClosureSweep = current.day;
  }
}

const automaticClosureTimer = setInterval(() => {
  void runAutomaticClosureSweep();
}, automaticClosureIntervalMs);
automaticClosureTimer.unref();
setTimeout(() => void runAutomaticClosureSweep(), 1_000).unref();

async function runGoogleSheetsBackup() {
  if (!googleSheetsBackupEnabled) return;
  if (googleSheetsBackupRunning) return;
  googleSheetsBackupRunning = true;
  const client = await pool.connect();
  let locked = false;
  try {
    const lockResult = await client.query(
      "SELECT pg_try_advisory_lock(hashtextextended('google_sheets_backup',0)) AS locked",
    );
    locked = Boolean(lockResult.rows[0]?.locked);
    if (!locked) return;

    const pending = await client.query(
      "SELECT value FROM app_metadata WHERE key=$1 LIMIT 1",
      [googleSheetsBackupPendingKey],
    );
    if (!pending.rows[0]) return;

    const snapshot = await readSnapshot(client as unknown as QueryClient);
    await backupSnapshot(snapshot);
    await setBackupMetadata(googleSheetsBackupLastSuccessKey, new Date().toISOString());
    await setBackupMetadata(googleSheetsBackupLastErrorKey, null);
    await setBackupMetadata(googleSheetsBackupPendingKey, null);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error desconocido";
    console.error("Google Sheets backup failed", error);
    await setBackupMetadata(
      googleSheetsBackupLastErrorKey,
      JSON.stringify({ failedAt: new Date().toISOString(), message }),
    ).catch((metadataError) => console.error("Unable to record backup failure", metadataError));
    scheduleGoogleSheetsBackup(60_000);
  } finally {
    if (locked) {
      await client.query(
        "SELECT pg_advisory_unlock(hashtextextended('google_sheets_backup',0))",
      ).catch(() => undefined);
    }
    client.release();
    googleSheetsBackupRunning = false;
  }
}

router.use((req, res, next) => {
  if (["POST", "PUT", "PATCH", "DELETE"].includes(req.method)) {
    res.on("finish", () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        void requestGoogleSheetsBackup(`${req.method} ${req.path}`);
      }
    });
  }
  next();
});

function saleIdFromCanjeMovement(record: StoredRecord) {
  const id = value(record, "id");
  const match = id.match(/^CAN-(.+)-(AVENA|BATEA|MANDIL|SPAGHETTI)$/);
  return match?.[1] || null;
}

function isLegacyMarketInventoryMovement(record: StoredRecord) {
  const kind = value(record, "kind");
  return ["AJUSTE_DEGUSTACION", "AJUSTE_CANJES", "DEGUSTACION", "CANJE"].includes(kind)
    && !value(record, "promoterId");
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
    // Promoter-owned stock is deducted from the user JSON record. These
    // movements retain marketId for location history but must not mutate the
    // legacy market inventory balance.
    if (value(source, "promoterId")) continue;
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
    const existingByDni = await client.query("SELECT id,data FROM users WHERE dni=$1 LIMIT 1", [key]);
    let userId = value(source, "id") || key;
    if (existingByDni.rows[0]?.id) {
      userId = String(existingByDni.rows[0].id);
    } else {
      const existingById = await client.query("SELECT id FROM users WHERE id=$1 LIMIT 1", [userId]);
      if (existingById.rows[0]?.id) userId = `USR-${key}`;
    }
    const existingUserData = isRecord(existingByDni.rows[0]?.data) ? existingByDni.rows[0].data as StoredRecord : {};
    const remainsArchived = existingUserData.sheetArchived === true && source.sheetArchived !== false;
    const userData = remainsArchived
      ? { ...normalized, id: userId, status: "INACTIVO", sheetArchived: true, sheetArchivedAt: existingUserData.sheetArchivedAt }
      : { ...normalized, id: userId };
    await client.query(
      `INSERT INTO users (id,dni,name,role,status,password_hash,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dni) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,status=EXCLUDED.status,
       password_hash=COALESCE(EXCLUDED.password_hash,users.password_hash),data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [userId, key, value(userData, "name"), value(userData, "role"),
        value(userData, "status") || "ACTIVO", passwordHash, userData, updated],
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
       status=EXCLUDED.status,data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()
       WHERE sales.record_updated_at IS NULL OR EXCLUDED.record_updated_at >= sales.record_updated_at`,
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
    const tombstones = await client.query("SELECT collection,record_id FROM app_storage_tombstones");
    const deletedRecords = new Set(tombstones.rows.map(row => `${row.collection}:${row.record_id}`));
    for (const name of Object.keys(collectionConfig) as CollectionName[]) {
      if (name === "inventory") continue;
      const records = Array.isArray(guardedIncoming[name]) ? guardedIncoming[name] : [];
      for (const record of records) {
        if (!isRecord(record)) continue;
        if (deletedRecords.has(`${name}:${value(record, 'id')}`)) continue;
        const config = collectionConfig[name];
        const existing = await client.query(`SELECT data FROM ${config.table} WHERE ${config.column}=$1`, [value(record, config.key)]);
        const editedAt = existing.rows[0]?.data?.updatedAt;
        if (editedAt && (!recordDate(record) || String(editedAt) > String(recordDate(record)))) continue;
        if (name === "sales" && record && typeof record === "object" && deletedSaleIds.has(value(record, "id"))) continue;
        if (name === "movements" && record && typeof record === "object") {
          if (isLegacyMarketInventoryMovement(record)) continue;
          const saleId = saleIdFromCanjeMovement(record);
          if (saleId && deletedSaleIds.has(saleId)) continue;
        }
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

if (googleSheetsBackupEnabled) {
  void requestGoogleSheetsBackup("inicio del servidor");
  const googleSheetsBackupInterval = setInterval(() => {
    void runGoogleSheetsBackup();
  }, 60_000);
  googleSheetsBackupInterval.unref();
}

router.get("/app-storage", async (req, res): Promise<void> => {
  try {
    await ensurePromoterStockBaseline();
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

router.post("/app-storage/admin/users/sync", async (req, res): Promise<void> => {
  const users = req.body?.users;
  if (!Array.isArray(users) || !users.length || users.some((user) => !isRecord(user) || !/^\d{8}$/.test(value(user, "dni")))) {
    res.status(400).json({ message: "La hoja debe contener usuarios válidos con DNI de 8 dígitos." });
    return;
  }
  const dnis = users.map((user) => value(user, "dni"));
  if (new Set(dnis).size !== dnis.length) {
    res.status(400).json({ message: "La hoja contiene DNI repetidos. No se actualizó ningún usuario." });
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
      res.status(409).json({ message: "La información cambió. Vuelve a pulsar Actualizar hoja." });
      return;
    }
    for (const user of users) {
      await upsertRecord(client as unknown as QueryClient, "users", { ...user, sheetArchived: false });
    }
    const archivedAt = new Date().toISOString();
    await client.query(
      `UPDATE users
       SET status='INACTIVO',
           data=data || jsonb_build_object('status','INACTIVO','sheetArchived',true,'sheetArchivedAt',$2::text),
           record_updated_at=$2,
           updated_at=now()
       WHERE NOT (dni = ANY($1::text[]))`,
      [dnis, archivedAt],
    );
    await client.query("COMMIT");
    void requestGoogleSheetsBackup("sincronización autoritativa de usuarios");
    res.json({ synced: dnis.length, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to synchronize authoritative users");
    res.status(500).json({ message: "No se pudo sincronizar la hoja de Promotores." });
  } finally {
    client.release();
  }
});

// Administrative record corrections keep stable IDs and reconcile personal stock.
router.all('/app-storage/admin/records/:collection/:id', async (req, res): Promise<void> => {
  const name = String(req.params.collection) as CollectionName;
  const id = String(req.params.id);
  if (!['markets', 'users', 'attendance', 'movements'].includes(name) || !['PUT', 'DELETE'].includes(req.method)) { res.status(400).json({ message: 'Operación no válida.' }); return; }
  const credentials = await pool.query('SELECT data,password_hash,status FROM users WHERE dni=$1',[req.get('x-admin-dni') || '']);
  const actor = credentials.rows[0];
  if (!actor || actor.status !== 'ACTIVO' || !['ADMIN','ANALISTA','TRADE','SUPERVISOR'].includes(actor.data.role) || !actor.password_hash || !(await verifyPassword(req.get('x-admin-key') || '',actor.password_hash))) {
    res.status(403).json({message:'Inicia sesión con un usuario autorizado para editar o eliminar.'}); return;
  }
  if (name === 'users' && id === actor.data.id && (req.method === 'DELETE' || req.body?.record?.status === 'INACTIVO')) {
    res.status(409).json({message:'No puedes eliminar o desactivar tu propia sesión.'}); return;
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await lockInventoryLedger(db as unknown as QueryClient);
    const table = collectionConfig[name].table;
    const result = await db.query(`SELECT data FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
    if (!result.rows[0]) throw new Error('El registro ya no existe. Actualiza la pantalla.');
    const old = result.rows[0].data as StoredRecord;
    const input = isRecord(req.body?.record) ? req.body.record : {};
    const deleting = req.method === 'DELETE';
    const fields: Record<string, string[]> = {
      markets: ['name','region','department','province','district','status'],
      users: ['dni','name','role','roleLabel','marketId','clientId','status','password'],
      attendance: ['promoterId','clientId','marketId','type','date','photo'],
      movements: ['promoterId','actorId','actorName','marketId','quantity','date','itemId','canjeProductId','canjeProductLabel','canjeComponents','degustacionProductId','degustacionProductLabel'],
    };
    const next: StoredRecord = { ...old, ...Object.fromEntries(fields[name].filter(key => key in input).map(key => [key,input[key]])), id, updatedAt: new Date().toISOString() };
    const required = (keys: string[]) => { if (keys.some(key => !value(next,key).trim())) throw new Error('Completa todos los campos obligatorios.'); };
    if (!deleting) {
      if (name === 'markets') required(['name','department','province','district']);
      if (name === 'users') {
        if (!['PROMOTOR','PROMOTOR ROTATIVO','PROMOTOR PERMANENTE','COORDINADOR','SUPERVISOR','ANALISTA','TRADE','ADMIN','CLIENTE'].includes(value(next,'role'))) throw new Error('Rol no válido.');
        required(['name','role','status']);
        if (!/^\d{8}$/.test(value(next,'dni'))) throw new Error('El DNI debe tener 8 dígitos.');
        if (value(input,'password') && value(input,'password').length < 8) throw new Error('La clave debe tener al menos 8 caracteres.');
        if (!value(input,'password')) delete next.password;
      }
      if (name === 'attendance' || name === 'movements') {
        if (!Number.isFinite(new Date(value(next,'date')).getTime())) throw new Error('Fecha no válida.');
        required(['marketId']);
        if (!(await db.query('SELECT id FROM markets WHERE id=$1',[next.marketId])).rows.length) throw new Error('El mercado no existe.');
      }
      if (name === 'attendance') {
        required(['promoterId','clientId','photo']);
        if (!['ENTRADA','SALIDA'].includes(value(next,'type'))) throw new Error('Evento no válido.');
        if (!(await db.query('SELECT id FROM clients WHERE id=$1 AND market_id=$2',[next.clientId,next.marketId])).rows.length) throw new Error('El cliente no pertenece al mercado.');
        const promoter = await db.query('SELECT data FROM users WHERE id=$1',[next.promoterId]);
        if (!promoter.rows.length) throw new Error('El promotor no existe.');
        next.promoterRole = promoter.rows[0].data.role; next.promoterRoleLabel = promoter.rows[0].data.roleLabel || next.promoterRole;
      }
    }
    if (name === 'users' && (deleting || next.role !== old.role || next.status === 'INACTIVO')) {
      if (['ADMIN','ANALISTA'].includes(value(old,'role'))) {
        const others = await db.query("SELECT id FROM users WHERE id<>$1 AND status='ACTIVO' AND data->>'role' IN ('ADMIN','ANALISTA')",[id]);
        if (!others.rows.length) throw new Error('Debes conservar al menos un administrador o analista activo.');
      }
    }
    if (name === 'markets' && deleting) {
      for (const related of ['clients','sales','attendance','inventory_movements']) {
        if ((await db.query(`SELECT 1 FROM ${related} WHERE market_id=$1 LIMIT 1`,[id])).rows.length) throw new Error('El mercado tiene registros relacionados. Reasígnalos antes de eliminarlo.');
      }
    }
    if (name === 'movements') {
      if (!deleting && !String(next.kind).includes('DEGUSTACION')) {
        if (!value(next,'itemId') && !isRecord(next.canjeComponents)) throw new Error('Selecciona un producto de canje.');
        if (isRecord(next.canjeComponents) && Object.entries(next.canjeComponents).some(([key,qty]) => !['AVENA','SPAGHETTI','BATEA','MANDIL'].includes(key) || !Number.isInteger(qty) || Number(qty) < 0)) throw new Error('Composición de canje inválida.');
      }
      if (!deleting && (!Number.isInteger(Number(next.quantity)) || Number(next.quantity) <= 0)) throw new Error('La cantidad debe ser un entero mayor que cero.');
      const saleId = saleIdFromCanjeMovement(old);
      if (saleId) throw new Error('Este canje está asociado a una venta. Edítalo desde Ventas para mantener sus evidencias e inventario.');
      for (const [record, direction] of [[old,-1], ...(deleting ? [] : [[next,1]])] as [StoredRecord,number][]) {
        const owner = value(record,'promoterId') || value(record,'actorId');
        const found = await db.query('SELECT data FROM users WHERE id=$1 FOR UPDATE',[owner]);
        if (!found.rows.length) throw new Error('No se encontró al propietario del stock.');
        const person = found.rows[0].data;
        const kind = value(record,'kind');
        const sign = kind.startsWith('AJUSTE_') ? direction : -direction;
        if (kind.includes('DEGUSTACION')) person.tastingStock = Number(person.tastingStock || 0) + sign * Number(record.quantity);
        else {
          const stock = { ...(person.redemptionStock || {}) };
          for (const item of ['AVENA','SPAGHETTI','BATEA','MANDIL']) stock[item] = Number(stock[item] || 0) + sign * movementItemQuantity(record,item);
          person.redemptionStock = stock;
        }
        // Intermediate reversal may be negative; validate final balances below.
        await db.query('UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1',[owner,{...person,updatedAt:next.updatedAt},next.updatedAt]);
      }
      for (const owner of new Set([value(old,'promoterId') || value(old,'actorId'), value(next,'promoterId') || value(next,'actorId')])) {
        const data = (await db.query('SELECT data FROM users WHERE id=$1',[owner])).rows[0]?.data;
        if (data && (Number(data.tastingStock) < 0 || Object.values(data.redemptionStock || {}).some(x => Number(x) < 0))) throw new Error('Stock insuficiente para aplicar esta corrección.');
      }
    }
    if (deleting) {
      await db.query(`DELETE FROM ${table} WHERE id=$1`,[id]);
      await db.query("INSERT INTO app_storage_tombstones (collection,record_id,deleted_at) VALUES ($1,$2,now()) ON CONFLICT (collection,record_id) DO UPDATE SET deleted_at=now()",[name,id]);
      if (name === 'users') await db.query('DELETE FROM assignments WHERE promoter_id=$1',[id]);
    } else if (name === 'users') {
      const passwordHash = value(next,'password') ? await hashPassword(value(next,'password')) : null;
      delete next.password;
      await db.query('UPDATE users SET dni=$2,name=$3,role=$4,status=$5,password_hash=COALESCE($6,password_hash),data=$7,record_updated_at=$8,updated_at=now() WHERE id=$1',[id,next.dni,next.name,next.role,next.status,passwordHash,next,next.updatedAt]);
    } else if (name === 'attendance') {
      await db.query("UPDATE attendance SET promoter_id=$2,client_id=$3,market_id=$4,event_type=$5,event_date=$6,photo=$7,data=$8,record_updated_at=$9,updated_at=now() WHERE id=$1",[id,next.promoterId,next.clientId,next.marketId,next.type,next.date,next.photo,next,next.updatedAt]);
    } else if (name === 'movements') {
      await db.query('UPDATE inventory_movements SET market_id=$2,item_id=$3,quantity=$4,actor_id=$5,movement_date=$6,data=$7,record_updated_at=$8,updated_at=now() WHERE id=$1',[id,next.marketId,next.itemId || null,next.quantity,next.actorId,next.date,next,next.updatedAt]);
    } else await upsertRecord(db as unknown as QueryClient,name,next);
    await db.query('COMMIT');
    res.json({ snapshot: await readSnapshot() });
  } catch (error) {
    await db.query('ROLLBACK');
    req.log.error({err:error}, 'Administrative correction failed');
    res.status(409).json({message: error instanceof Error && !('code' in error) ? error.message : 'No se pudo guardar. Verifica duplicados y registros relacionados.'});
  } finally { db.release(); }
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
    status: value(input, "status").toUpperCase() === "INACTIVO" ? "INACTIVO" : "ACTIVO",
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
    await pool.query("INSERT INTO app_storage_tombstones (collection,record_id,deleted_at) VALUES ('clients',$1,now()) ON CONFLICT (collection,record_id) DO UPDATE SET deleted_at=now()",[id]);
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
  const saleDate = isRecord(input) ? new Date(value(input, "date")) : new Date(Number.NaN);
  if (!id || !isRecord(input) || !value(input, "clientId") || !Number.isFinite(amountSoles) || amountSoles <= 0 || Number.isNaN(saleDate.getTime())) {
    res.status(400).json({ message: "La venta requiere cliente, fecha válida e importe mayor a cero." });
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
      res.status(409).json({ message: "La información cambió. Actualiza la aplicación antes de editar nuevamente." });
      return;
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`sale:${id}`]);
    const existing = await client.query(
      "SELECT promoter_id,market_id,data FROM sales WHERE id=$1 FOR UPDATE",
      [id],
    ) as unknown as { rows: Array<{ promoter_id: string; market_id: string; data: StoredRecord }> };
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "La venta no existe." });
      return;
    }
    const currentSale = existing.rows[0];
    const promoterResult = await client.query(
      "SELECT data FROM users WHERE id=$1 FOR UPDATE",
      [currentSale.promoter_id],
    ) as unknown as { rows: Array<{ data: StoredRecord }> };
    if (!promoterResult.rows[0]) {
      await client.query("ROLLBACK");
      res.status(409).json({ message: "No se encontró al promotor propietario del inventario." });
      return;
    }
    const movementPrefix = `CAN-${id}-`;
    const oldMovements = await client.query(
      `SELECT item_id,quantity,data FROM inventory_movements
       WHERE kind='CANJE' AND left(id,length($1))=$1 FOR UPDATE`,
      [movementPrefix],
    ) as unknown as { rows: Array<{ item_id: string | null; quantity: number; data: StoredRecord }> };
    const itemIds = ["AVENA", "SPAGHETTI", "BATEA", "MANDIL"];
    const promoterData = promoterResult.rows[0].data || {};
    const stockSource = isRecord(promoterData.redemptionStock) ? promoterData.redemptionStock : {};
    const availableStock = Object.fromEntries(itemIds.map((itemId) => [itemId, Math.max(0, Number(stockSource[itemId]) || 0)]));
    for (const movement of oldMovements.rows) {
      const movementData = isRecord(movement.data) ? movement.data : {};
      if (value(movementData, "promoterId") !== currentSale.promoter_id) continue;
      const itemId = movement.item_id || value(movementData, "itemId");
      if (itemIds.includes(itemId)) availableStock[itemId] += Math.max(0, Number(movement.quantity) || 0);
    }
    const requestedSource = isRecord(input.redemptionItems) ? input.redemptionItems : {};
    const requested = Object.fromEntries(itemIds.map((itemId) => [itemId, Math.max(0, Math.floor(Number(requestedSource[itemId]) || 0))]));
    for (const itemId of itemIds) {
      if (requested[itemId] > availableStock[itemId]) {
        await client.query("ROLLBACK");
        res.status(409).json({ message: `Stock insuficiente de ${itemId} para actualizar el canje.` });
        return;
      }
    }
    const updatedAt = new Date().toISOString();
    const sale = {
      ...currentSale.data,
      id,
      clientId: value(input, "clientId"),
      amountSoles,
      date: saleDate.toISOString(),
      comment: value(input, "comment") || undefined,
      bonus: value(input, "bonus") || undefined,
      redemptionCount: value(input, "bonus") ? Math.max(1, Math.floor(numeric(input, "redemptionCount"))) : 0,
      redemptionItems: value(input, "bonus") ? requested : undefined,
      receiptPhoto: value(input, "receiptPhoto"),
      exchangePhoto: value(input, "bonus") ? value(input, "exchangePhoto") || undefined : undefined,
      status: "SINCRONIZADA",
      updatedAt,
    };
    await client.query(
      `UPDATE sales
       SET client_id=$2,amount_soles=$3,sale_date=$4,status='SINCRONIZADA',receipt_photo=$5,exchange_photo=$6,data=$7,record_updated_at=$8,updated_at=now()
       WHERE id=$1`,
      [id, sale.clientId, amountSoles, saleDate, sale.receiptPhoto || null, sale.exchangePhoto || null, sale, updatedAt],
    );
    await client.query(
      "DELETE FROM inventory_movements WHERE kind='CANJE' AND left(id,length($1))=$1",
      [movementPrefix],
    );
    for (const itemId of itemIds) {
      if (!requested[itemId]) continue;
      const movement = {
        id: `${movementPrefix}${itemId}`,
        marketId: currentSale.market_id,
        kind: "CANJE",
        itemId,
        quantity: requested[itemId],
        actorId: currentSale.promoter_id,
        actorName: value(promoterData, "name") || "Promotor",
        promoterId: currentSale.promoter_id,
        date: updatedAt,
        status: "SINCRONIZADA",
      };
      await client.query(
        `INSERT INTO inventory_movements (id,market_id,kind,item_id,quantity,actor_id,movement_date,status,data,record_updated_at)
         VALUES ($1,$2,'CANJE',$3,$4,$5,$6,'SINCRONIZADA',$7,$8)`,
        [movement.id, movement.marketId, itemId, movement.quantity, movement.actorId, updatedAt, movement, updatedAt],
      );
      availableStock[itemId] -= requested[itemId];
    }
    const nextPromoterData = { ...promoterData, redemptionStock: availableStock };
    await client.query(
      "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
      [currentSale.promoter_id, nextPromoterData, updatedAt],
    );
    await client.query("COMMIT");
    res.json({ sale, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to update sale");
    res.status(500).json({ message: "No se pudo editar la venta." });
  } finally {
    client.release();
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
      const legacySaleMovements = saleMovements.filter((movement) =>
        !value(isRecord(movement.data) ? movement.data : {}, "promoterId"),
      );
      if (!legacySaleMovements.length) continue;
      const inventoryResult = await client.query(
        "SELECT redemption_stock,data FROM inventory WHERE market_id=$1 FOR UPDATE",
        [marketId],
      ) as unknown as { rows: Array<{ redemption_stock: Record<string, number>; data: StoredRecord }> };
      const current = inventoryResult.rows[0];
      if (!current) continue;
      const redemptionStock = { ...(current.redemption_stock || {}) };
      for (const movement of legacySaleMovements) {
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
  if (Array.isArray(req.body?.canjes)) {
    const inputs: StoredRecord[] = (req.body.canjes as unknown[]).filter((input): input is StoredRecord => isRecord(input));
    const validItemIds = new Set(["AVENA", "SPAGHETTI", "BATEA", "MANDIL"]);
    const promoterId = inputs.length ? value(inputs[0], "promoterId") : "";
    if (!inputs.length || inputs.length !== req.body.canjes.length ||
        !promoterId || inputs.some(input => {
          const kind = value(input, "kind");
          const validKind = kind === "AJUSTE_CANJES"
            ? validItemIds.has(value(input, "itemId"))
            : kind === "AJUSTE_DEGUSTACION" && value(input, "degustacionProductId") === "PANETON";
          return value(input, "promoterId") !== promoterId || !validKind || numeric(input, "quantity") <= 0;
        })) {
      res.status(400).json({ message: "El abastecimiento requiere un promotor y cantidades válidas para los artículos." });
      return;
    }
    const canjes: StoredRecord[] = inputs.map(input => ({
      id: value(input, "id") || `CANJE-${Date.now()}-${value(input, "itemId")}-${randomUUID().slice(0, 8)}`,
      marketId: value(input, "marketId") || `PERSONAL:${promoterId}`,
      kind: value(input, "kind") || "AJUSTE_CANJES",
      itemId: value(input, "itemId") || undefined,
      degustacionProductId: value(input, "degustacionProductId") || undefined,
      degustacionProductLabel: value(input, "degustacionProductLabel") || undefined,
      promoterId,
      quantity: Math.floor(numeric(input, "quantity")),
      actorId: value(input, "actorId") || "ADMIN",
      actorName: value(input, "actorName") || "Analista",
      date: value(input, "date") || new Date().toISOString(),
      status: "PENDIENTE",
    }));
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockInventoryLedger(client as unknown as QueryClient);
      const userResult = await client.query(
        "SELECT data FROM users WHERE id=$1 FOR UPDATE",
        [promoterId],
      ) as unknown as { rows: Array<{ data: StoredRecord }> };
      const current = userResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        res.status(404).json({ message: "El promotor seleccionado no existe." });
        return;
      }
      const currentStock = isRecord(current.data.redemptionStock) ? current.data.redemptionStock : {};
      const redemptionStock = {
        AVENA: Math.max(0, Number(currentStock.AVENA) || 0),
        BATEA: Math.max(0, Number(currentStock.BATEA) || 0),
        MANDIL: Math.max(0, Number(currentStock.MANDIL) || 0),
        SPAGHETTI: Math.max(0, Number(currentStock.SPAGHETTI) || 0),
      };
      let tastingStock = Math.max(0, Number(current.data.tastingStock) || 0);
      for (const canje of canjes) {
        if (value(canje, "kind") === "AJUSTE_DEGUSTACION") {
          tastingStock += Math.floor(numeric(canje, "quantity"));
        } else {
          const itemId = value(canje, "itemId") as keyof typeof redemptionStock;
          redemptionStock[itemId] += Math.floor(numeric(canje, "quantity"));
        }
        await upsertRecord(client as unknown as QueryClient, "movements", canje);
      }
      const updatedAt = canjes[canjes.length - 1].date;
      await client.query(
        "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
        [promoterId, { ...current.data, tastingStock, redemptionStock, updatedAt }, updatedAt],
      );
      await client.query("COMMIT");
      res.status(201).json({ canjes, snapshot: await readSnapshot() });
      return;
    } catch (error) {
      await client.query("ROLLBACK");
      req.log.error({ err: error }, "Unable to create grouped canjes");
      res.status(500).json({ message: "No se pudo cargar el stock agrupado." });
    } finally {
      client.release();
    }
    return;
  }
  const input = req.body?.canje;
  const personalStock = isRecord(input) && Boolean(value(input, "promoterId"));
  const validItemIds = new Set(["AVENA", "SPAGHETTI", "BATEA", "MANDIL"]);
  if (!isRecord(input) || numeric(input, "quantity") <= 0 ||
      (personalStock ? !validItemIds.has(value(input, "itemId")) : (!value(input, "marketId") || (!value(input, "itemId") && !value(input, "canjeProductId"))))) {
    res.status(400).json({ message: "El abastecimiento requiere promotor, artículo y cantidad mayor a cero." });
    return;
  }
  const canje: StoredRecord = {
    id: value(input, "id") || `CANJE-${Date.now()}-${randomUUID().slice(0, 8)}`,
    marketId: value(input, "marketId") || `PERSONAL:${value(input, "promoterId")}`,
    kind: "AJUSTE_CANJES",
    itemId: value(input, "itemId") || undefined,
    promoterId: value(input, "promoterId") || undefined,
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
    if (personalStock) {
      const userResult = await client.query(
        "SELECT data FROM users WHERE id=$1 FOR UPDATE",
        [canje.promoterId],
      ) as unknown as { rows: Array<{ data: StoredRecord }> };
      const current = userResult.rows[0];
      if (!current) {
        await client.query("ROLLBACK");
        res.status(404).json({ message: "El promotor seleccionado no existe." });
        return;
      }
      const currentStock = isRecord(current.data.redemptionStock) ? current.data.redemptionStock : {};
      const redemptionStock = {
        AVENA: Math.max(0, Number(currentStock.AVENA) || 0),
        BATEA: Math.max(0, Number(currentStock.BATEA) || 0),
        MANDIL: Math.max(0, Number(currentStock.MANDIL) || 0),
        SPAGHETTI: Math.max(0, Number(currentStock.SPAGHETTI) || 0),
      };
      const itemId = value(canje, "itemId") as keyof typeof redemptionStock;
      redemptionStock[itemId] += Math.floor(numeric(canje, "quantity"));
      const updatedAt = value(canje, "date");
      const userData = { ...current.data, redemptionStock, updatedAt };
      await upsertRecord(client as unknown as QueryClient, "movements", canje);
      await client.query(
        "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
        [canje.promoterId, userData, updatedAt],
      );
      await client.query("COMMIT");
      res.status(201).json({ canje, snapshot: await readSnapshot() });
      return;
    }
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
      const promoterId = value(movement?.data || {}, "promoterId");
      const personalItemId = value(movement?.data || {}, "itemId");
      const components = isRecord(movement?.data?.canjeComponents) ? movement.data.canjeComponents : {};
      if (movement && value(movement.data, "kind") === "AJUSTE_DEGUSTACION" && promoterId) {
        const userResult = await client.query(
          "SELECT data FROM users WHERE id=$1 FOR UPDATE",
          [promoterId],
        ) as unknown as { rows: Array<{ data: StoredRecord }> };
        const currentUser = userResult.rows[0];
        if (currentUser) {
          const tastingStock = Math.max(0, Number(currentUser.data.tastingStock) || 0) - Math.max(0, Number(movement.quantity) || 0);
          const updatedAt = new Date().toISOString();
          await client.query(
            "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
            [promoterId, { ...currentUser.data, tastingStock, updatedAt }, updatedAt],
          );
        }
      } else if (movement && value(movement.data, "kind") === "AJUSTE_CANJES" && promoterId && personalItemId) {
        const userResult = await client.query(
          "SELECT data FROM users WHERE id=$1 FOR UPDATE",
          [promoterId],
        ) as unknown as { rows: Array<{ data: StoredRecord }> };
        const currentUser = userResult.rows[0];
        if (currentUser) {
          const currentStock = isRecord(currentUser.data.redemptionStock) ? currentUser.data.redemptionStock : {};
          const redemptionStock = {
            AVENA: Math.max(0, Number(currentStock.AVENA) || 0),
            BATEA: Math.max(0, Number(currentStock.BATEA) || 0),
            MANDIL: Math.max(0, Number(currentStock.MANDIL) || 0),
            SPAGHETTI: Math.max(0, Number(currentStock.SPAGHETTI) || 0),
          };
          const itemId = personalItemId as keyof typeof redemptionStock;
          if (itemId in redemptionStock) redemptionStock[itemId] = Math.max(0, redemptionStock[itemId] - Math.max(0, Number(movement.quantity) || 0));
          const updatedAt = new Date().toISOString();
          await client.query(
            "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
            [promoterId, { ...currentUser.data, redemptionStock, updatedAt }, updatedAt],
          );
        }
      } else if (movement && value(movement.data, "kind") === "AJUSTE_CANJES" && productId) {
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
    const movementKind = movement ? value(movement.data, "kind") : "";
    if (movement && movementKind !== "DEGUSTACION") {
      await client.query("ROLLBACK");
      res.status(400).json({ message: "El registro no corresponde a una degustación operativa." });
      return;
    }
    if (movement && movementKind === "DEGUSTACION") {
      const promoterId = value(movement.data, "promoterId") || value(movement.data, "actorId");
      if (!promoterId) {
        await client.query("ROLLBACK");
        res.status(409).json({ message: "No se encontró al promotor que registró la degustación." });
        return;
      }
      const userResult = await client.query(
        "SELECT data FROM users WHERE id=$1 FOR UPDATE",
        [promoterId],
      ) as unknown as { rows: Array<{ data: StoredRecord }> };
      const currentUser = userResult.rows[0];
      if (!currentUser) {
        await client.query("ROLLBACK");
        res.status(409).json({ message: "No se encontró al promotor propietario del stock." });
        return;
      }
      const updatedAt = new Date().toISOString();
      const tastingStock = Math.max(0, Number(currentUser.data?.tastingStock) || 0) + Math.max(0, Number(movement.quantity) || 0);
      await client.query(
        "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
        [promoterId, { ...(currentUser.data || {}), tastingStock, updatedAt }, updatedAt],
      );
      const movementDate = value(movement.data, "date");
      if (movementDate) {
        const closureResult = await client.query(
          "SELECT id,data FROM session_closures WHERE promoter_id=$1 AND closure_date=$2 FOR UPDATE",
          [promoterId, movementDate],
        ) as unknown as { rows: Array<{ id: string; data: StoredRecord }> };
        for (const closure of closureResult.rows) {
          await client.query(
            "UPDATE session_closures SET tasting_used=0,data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
            [closure.id, { ...(closure.data || {}), tastingUsed: 0, updatedAt }, updatedAt],
          );
        }
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
    await ensurePromoterStockBaseline();
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
