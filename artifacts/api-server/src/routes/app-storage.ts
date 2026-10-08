import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { pool } from "@workspace/db";
import { Router, type IRouter, type Request } from "express";

const router: IRouter = Router();
const scrypt = promisify(scryptCallback);
const campaignTimeZone = "America/Lima";
const automaticClosureIntervalMs = 30_000;
const redemptionItemIds = ["AVENA", "BATEA", "MANDIL", "SPAGHETTI"];
const miniHalfPlanchaSkus = new Set([
  "TODINNITO-85",
  "MINI-COSTA-MINIONS-80",
  "MINI-COSTA-JURASSIC-80",
]);

type StoredRecord = Record<string, unknown>;
type QueryClient = {
  query: (
    text: string,
    values?: unknown[],
  ) => Promise<{ rows: Array<Record<string, unknown>> }>;
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
  | "productPrices"
  | "categories";
type StorageSnapshot = Record<CollectionName, StoredRecord[]>;

const collectionConfig: Record<
  CollectionName,
  { table: string; key: string; column: string }
> = {
  markets: { table: "markets", key: "id", column: "id" },
  users: { table: "users", key: "dni", column: "dni" },
  clients: { table: "clients", key: "id", column: "id" },
  sales: { table: "sales", key: "id", column: "id" },
  attendance: { table: "attendance", key: "id", column: "id" },
  inventory: { table: "inventory", key: "marketId", column: "market_id" },
  movements: { table: "inventory_movements", key: "id", column: "id" },
  assignments: {
    table: "assignments",
    key: "promoterId",
    column: "promoter_id",
  },
  closures: { table: "session_closures", key: "id", column: "id" },
  productPrices: { table: "product_prices", key: "sku", column: "sku" },
  categories: { table: "client_categories", key: "id", column: "id" },
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
    categories: [],
  };
}

function value(record: StoredRecord, key: string) {
  return String(record[key] ?? "").trim();
}

function numeric(record: StoredRecord, key: string) {
  const result = Number(record[key]);
  return Number.isFinite(result) ? result : 0;
}

function hasRedemptionConsumption(record: StoredRecord) {
  if (value(record, "bonus")) return true;
  const items = record.redemptionItems;
  if (!isRecord(items)) return false;
  return redemptionItemIds.some(
    (itemId) => Math.max(0, Number(items[itemId]) || 0) > 0,
  );
}

function requireFinalClientForCanje(record: StoredRecord) {
  if (hasRedemptionConsumption(record) && !value(record, "finalClientName")) {
    throw new Error(
      "Nombre Cliente Final es obligatorio cuando la venta tiene canje.",
    );
  }
}

function dateValue(record: StoredRecord) {
  const raw = value(record, "date");
  const date = raw ? new Date(raw) : new Date();
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function recordDate(record: StoredRecord) {
  return value(record, "updatedAt") || value(record, "date") || null;
}

function saleItemDrafts(source: StoredRecord) {
  const mode = value(source, "mode");
  if (mode === "PLANCHAS" && Array.isArray(source.planchaLines)) {
    return source.planchaLines
      .filter(isRecord)
      .map((line, index) => ({
        lineNo: index + 1,
        sku: value(line, "sku"),
        quantity: numeric(line, "units"),
        unitPrice: numeric(line, "unitPrice"),
        presentation: value(line, "presentation") || null,
        raw: line,
      }))
      .filter((line) => line.sku && line.quantity > 0);
  }
  if (mode === "UNIDADES" && isRecord(source.unitPrices)) {
    const entries = Object.entries(source.unitPrices);
    if (!entries.length) return [];
    const [sku, rawPrice] = entries[0];
    const quantity = numeric(source, "units");
    return quantity > 0
      ? [{
          lineNo: 1,
          sku: String(sku || "").trim(),
          quantity,
          unitPrice: Number(rawPrice) || 0,
          presentation: value(source, "presentation") || null,
          raw: {
            sku,
            quantity,
            unitPrice: Number(rawPrice) || 0,
            presentation: value(source, "presentation") || undefined,
          },
        }]
      : [];
  }
  return [];
}

async function replaceSaleItems(
  client: QueryClient,
  saleId: string,
  source: StoredRecord,
  options: { allowLegacyWithoutSku?: boolean } = {},
) {
  const drafts = saleItemDrafts(source);
  if (!drafts.length) {
    if (options.allowLegacyWithoutSku) return;
    throw new Error(
      "La venta no contiene un SKU válido. Actualiza Marcas antes de registrar la venta.",
    );
  }
  const skuList = [...new Set(drafts.map((line) => line.sku))];
  const catalog = await client.query(
    "SELECT sku,product FROM product_prices WHERE sku = ANY($1::text[])",
    [skuList],
  );
  const catalogBySku = new Map(
    catalog.rows.map((row) => [String(row.sku), String(row.product || "")]),
  );
  const missing = skuList.filter((sku) => !catalogBySku.has(sku));
  if (missing.length) {
    if (options.allowLegacyWithoutSku) return;
    throw new Error(
      `SKU no encontrado en Marcas: ${missing.join(", ")}. No se modificó la venta.`,
    );
  }

  await client.query("DELETE FROM sale_items WHERE sale_id=$1", [saleId]);
  for (const line of drafts) {
    const amount = line.quantity * line.unitPrice;
    await client.query(
      `INSERT INTO sale_items
        (sale_id,line_no,sku,product_name,quantity,unit_price,amount_soles,mode,presentation,data,updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
      [
        saleId,
        line.lineNo,
        line.sku,
        catalogBySku.get(line.sku) || "",
        line.quantity,
        line.unitPrice,
        amount,
        value(source, "mode"),
        line.presentation,
        line.raw,
      ],
    );
  }
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
    closureDate: `${day}T23:59:59.000-05:00`,
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
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('inventory_ledger',0))",
  );
}

async function lockAndValidateCatalogRevision(
  client: QueryClient,
  incomingRevision: string | null,
) {
  await client.query(
    "SELECT pg_advisory_xact_lock_shared(hashtextextended('catalog_revision',0))",
  );
  const currentRevision = await readCatalogRevision(client);
  return !currentRevision || incomingRevision === currentRevision;
}

async function readCatalogRevision(
  client: QueryClient = pool as unknown as QueryClient,
) {
  const result = await client.query(
    "SELECT value FROM app_metadata WHERE key=$1",
    ["catalog_revision"],
  );
  return value(result.rows[0] || {}, "value") || null;
}

// El stock personal/promotor se conserva solo como dato histórico dentro de users.data.
// El saldo operativo se administra exclusivamente en warehouses.stock.

function canjeSnapshot(snapshot: StorageSnapshot) {
  return [
    ...snapshot.movements
      .filter((movement) => value(movement, "kind") === "CANJE")
      .map((movement) => ({
        ...movement,
        source: "movement",
        canjeId: value(movement, "id"),
      })),
    ...snapshot.sales
      .filter((sale) => value(sale, "mode") === "CANJE")
      .map((sale) => ({ ...sale, source: "sale", canjeId: value(sale, "id") })),
  ].sort(
    (first, second) =>
      recordDate(second)?.localeCompare(recordDate(first) || "") || 0,
  );
}

async function readSnapshot(
  client: QueryClient = pool as unknown as QueryClient,
) {
  const snapshot = emptySnapshot();
  for (const name of Object.keys(collectionConfig) as CollectionName[]) {
    const { table } = collectionConfig[name];
    const orderBy =
      name === "attendance"
        ? "event_date DESC, created_at DESC"
        : name === "closures"
          ? "closure_date DESC, created_at DESC"
          : "created_at";
    const select =
      operationalCollections.has(name)
        ? `SELECT data,status FROM ${table} ORDER BY ${orderBy}`
        : `SELECT data FROM ${table} ORDER BY ${orderBy}`;
    const result = await client.query(select);
    snapshot[name] = result.rows.map((row) => {
      const data = row.data as StoredRecord;
      if (name === "users") return publicUser(data);
      if (operationalCollections.has(name))
        return {
          ...data,
          status: String(row.status || data.status || "SINCRONIZADA"),
        };
      return data;
    });
  }
  return snapshot;
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
      `SELECT latest.*,users.data AS user_data FROM (
         SELECT DISTINCT ON (promoter_id,client_id)
           id,promoter_id,market_id,client_id,event_type
         FROM attendance
         WHERE event_date >= $1::timestamptz AND event_date <= $2::timestamptz
         ORDER BY promoter_id,client_id,event_date DESC,created_at DESC
       ) latest
       JOIN users ON users.id=latest.promoter_id
       WHERE latest.event_type='ENTRADA'`,
      [bounds.start, bounds.end],
    );
    for (const row of openPromoters.rows) {
      const promoterId = String(row.promoter_id || "");
      const marketId = String(row.market_id || "");
      if (!promoterId || !marketId) continue;
      const userData = isRecord(row.user_data) ? row.user_data : {};
      const closure: StoredRecord = {
        id: `CIERRE-AUTO-${day}-${promoterId}-${row.client_id}`,
        promoterId,
        promoterRole: value(userData, "role") || undefined,
        promoterRoleLabel:
          value(userData, "roleLabel") || value(userData, "role") || undefined,
        marketId,
        clientId: row.client_id ? String(row.client_id) : undefined,
        tastingUsed: 0,
        leads: 0,
        automatic: true,
        closureType: "AUTOMATICO",
        evidence: `Cierre automático generado por el sistema a las 23:59:59 (hora de Lima) por falta de cierre manual del ${day}.`,
        date: new Date(bounds.closureDate).toISOString(),
        status: "SINCRONIZADA",
      };
      await upsertRecord(client as unknown as QueryClient, "attendance", {
        ...closure,
        id: `MAR-AUTO-${day}-${row.id}`,
        type: "SALIDA",
        automatic: true,
      });
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
  return created;
}

async function runAutomaticClosureSweep() {
  const current = campaignDateParts();
  const previousDay = previousCampaignDay(current.day);
  // Only close completed Lima days. Rechecking also catches late synchronization;
  // the generated SALIDA becomes the latest event, making this idempotent.
  await createAutomaticClosuresForDay(previousDay);
}

const automaticClosureTimer = setInterval(() => {
  void runAutomaticClosureSweep();
}, automaticClosureIntervalMs);
automaticClosureTimer.unref();
setTimeout(() => void runAutomaticClosureSweep(), 1_000).unref();


function saleIdFromCanjeMovement(record: StoredRecord) {
  const id = value(record, "id");
  const match = id.match(/^CAN-(.+)-(AVENA|BATEA|MANDIL|SPAGHETTI)$/);
  return match?.[1] || null;
}

function isLegacyMarketInventoryMovement(record: StoredRecord) {
  const kind = value(record, "kind");
  return (
    ["AJUSTE_DEGUSTACION", "AJUSTE_CANJES", "DEGUSTACION", "CANJE"].includes(
      kind,
    ) && !value(record, "promoterId")
  );
}

function movementItemQuantity(record: StoredRecord, itemId: string) {
  const quantity = numeric(record, "quantity");
  const components = isRecord(record.canjeComponents)
    ? record.canjeComponents
    : null;
  if (components) return (Number(components[itemId]) || 0) * quantity;
  return value(record, "itemId") === itemId ? quantity : 0;
}

// inventory e inventory_movements se conservan para trazabilidad histórica.
// Ninguna reconciliación de saldo operativo se ejecuta contra esas tablas.

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
      [
        key,
        value(source, "name"),
        value(source, "region") || null,
        value(source, "department") || null,
        value(source, "province") || null,
        value(source, "district") || null,
        value(source, "status") || "ACTIVO",
        normalized,
        updated,
      ],
    );
  } else if (name === "users") {
    const password = value(source, "password");
    const passwordHash = password ? await hashPassword(password) : null;
    const existingByDni = await client.query(
      "SELECT id,data FROM users WHERE dni=$1 LIMIT 1",
      [key],
    );
    let userId = value(source, "id") || key;
    if (existingByDni.rows[0]?.id) {
      userId = String(existingByDni.rows[0].id);
    } else {
      const existingById = await client.query(
        "SELECT id FROM users WHERE id=$1 LIMIT 1",
        [userId],
      );
      if (existingById.rows[0]?.id) userId = `USR-${key}`;
    }
    const existingUserData = isRecord(existingByDni.rows[0]?.data)
      ? (existingByDni.rows[0].data as StoredRecord)
      : {};
    const remainsArchived =
      (existingUserData.catalogArchived === true ||
        existingUserData.sheetArchived === true) &&
      source.catalogArchived !== false &&
      source.sheetArchived !== false;
    const userData = remainsArchived
      ? {
          ...normalized,
          id: userId,
          status: "INACTIVO",
          catalogArchived: true,
          catalogArchivedAt:
            existingUserData.catalogArchivedAt ||
            existingUserData.sheetArchivedAt,
        }
      : { ...normalized, id: userId, catalogArchived: false };
    await client.query(
      `INSERT INTO users (id,dni,name,role,status,password_hash,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (dni) DO UPDATE SET name=EXCLUDED.name,role=EXCLUDED.role,status=EXCLUDED.status,
       password_hash=COALESCE(EXCLUDED.password_hash,users.password_hash),data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        userId,
        key,
        value(userData, "name"),
        value(userData, "role"),
        value(userData, "status") || "ACTIVO",
        passwordHash,
        userData,
        updated,
      ],
    );
  } else if (name === "clients") {
    await client.query(
      `INSERT INTO clients (id,code,name,market_id,status,data,record_updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (id) DO UPDATE SET code=EXCLUDED.code,name=EXCLUDED.name,market_id=EXCLUDED.market_id,
       status=EXCLUDED.status,data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        key,
        value(source, "code") || key,
        value(source, "name"),
        value(source, "marketId"),
        value(source, "status") || "ACTIVO",
        normalized,
        updated,
      ],
    );
  } else if (name === "sales") {
    await client.query(
      `INSERT INTO sales (id,promoter_id,client_id,market_id,mode,units,amount_soles,weight_kg,sale_date,status,receipt_photo,exchange_photo,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET receipt_photo=EXCLUDED.receipt_photo,exchange_photo=EXCLUDED.exchange_photo,
       status=EXCLUDED.status,data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()
       WHERE sales.record_updated_at IS NULL OR EXCLUDED.record_updated_at >= sales.record_updated_at`,
      [
        key,
        value(source, "promoterId"),
        value(source, "clientId"),
        value(source, "marketId"),
        value(source, "mode"),
        numeric(source, "units"),
        numeric(source, "amountSoles"),
        source.weightKg == null ? null : numeric(source, "weightKg"),
        dateValue(source),
        "SINCRONIZADA",
        value(source, "receiptPhoto") || null,
        value(source, "exchangePhoto") || null,
        normalized,
        updated,
      ],
    );
    await replaceSaleItems(client, key, normalized);
  } else if (name === "attendance") {
    await client.query(
      `INSERT INTO attendance (id,promoter_id,client_id,market_id,event_type,event_date,status,photo,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET photo=EXCLUDED.photo,status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        key,
        value(source, "promoterId"),
        value(source, "clientId"),
        value(source, "marketId"),
        value(source, "type"),
        dateValue(source),
        "SINCRONIZADA",
        value(source, "photo") || null,
        normalized,
        updated,
      ],
    );
  } else if (name === "inventory") {
    await client.query(
      `INSERT INTO inventory (market_id,tasting_stock,redemption_stock,data,record_updated_at) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (market_id) DO UPDATE SET tasting_stock=EXCLUDED.tasting_stock,redemption_stock=EXCLUDED.redemption_stock,
       data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        key,
        numeric(source, "tastingStock"),
        source.redemptionStock ?? {},
        normalized,
        updated,
      ],
    );
  } else if (name === "movements") {
    await client.query(
      `INSERT INTO inventory_movements (id,market_id,kind,item_id,quantity,actor_id,movement_date,status,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        key,
        value(source, "marketId"),
        value(source, "kind"),
        value(source, "itemId") || null,
        numeric(source, "quantity"),
        value(source, "actorId"),
        dateValue(source),
        "SINCRONIZADA",
        normalized,
        updated,
      ],
    );
  } else if (name === "assignments") {
    await client.query(
      `INSERT INTO assignments (promoter_id,promoter_dni,market_ids,client_ids,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (promoter_id) DO UPDATE SET promoter_dni=EXCLUDED.promoter_dni,market_ids=EXCLUDED.market_ids,
       client_ids=EXCLUDED.client_ids,data=EXCLUDED.data,record_updated_at=EXCLUDED.record_updated_at,updated_at=now()
       WHERE assignments.record_updated_at <= EXCLUDED.record_updated_at`,
      [
        key,
        value(source, "promoterDni") || null,
        Array.isArray(source.marketIds) ? source.marketIds : [],
        Array.isArray(source.clientIds) ? source.clientIds : [],
        normalized,
        updated ?? new Date().toISOString(),
      ],
    );
  } else if (name === "closures") {
    await client.query(
      `INSERT INTO session_closures (id,promoter_id,market_id,client_id,tasting_used,leads,closure_date,status,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        key,
        value(source, "promoterId"),
        value(source, "marketId"),
        value(source, "clientId") || null,
        numeric(source, "tastingUsed"),
        numeric(source, "leads"),
        dateValue(source),
        "SINCRONIZADA",
        normalized,
        updated,
      ],
    );
  } else if (name === "productPrices") {
    await client.query(
      `INSERT INTO product_prices (sku,product,units_per_package,unit_price,total_price,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (sku) DO UPDATE SET product=EXCLUDED.product,units_per_package=EXCLUDED.units_per_package,
       unit_price=EXCLUDED.unit_price,total_price=EXCLUDED.total_price,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        key,
        value(source, "product") || key,
        numeric(source, "unitsPerPackage"),
        numeric(source, "unitPrice"),
        numeric(source, "totalPrice"),
        normalized,
        updated ?? new Date().toISOString(),
      ],
    );
  } else if (name === "categories") {
    await client.query(
      `INSERT INTO client_categories (id,name,status,data,record_updated_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,data=EXCLUDED.data,
       record_updated_at=EXCLUDED.record_updated_at,updated_at=now()`,
      [
        key,
        value(source, "name") || key,
        value(source, "status") === "INACTIVO" ? "INACTIVO" : "ACTIVO",
        normalized,
        updated ?? new Date().toISOString(),
      ],
    );
  }
}

async function validateNewAttendance(
  db: QueryClient,
  record: StoredRecord,
) {
  const promoterId = value(record, "promoterId");
  const clientId = value(record, "clientId");
  const marketId = value(record, "marketId");
  const type = value(record, "type");
  const photo = value(record, "photo");
  const date = dateValue(record);

  if (!promoterId || !clientId || !marketId)
    throw new Error("La marcación requiere Promotor, Mercado y Cliente.");
  if (!["ENTRADA", "SALIDA"].includes(type))
    throw new Error("El tipo de marcación debe ser ENTRADA o SALIDA.");
  if (!photo)
    throw new Error("La fotografía de la marcación es obligatoria.");

  const promoterResult = await db.query(
    "SELECT id,dni,role,status,data FROM users WHERE id=$1 LIMIT 1",
    [promoterId],
  );
  const promoter = promoterResult.rows[0];
  const promoterData = isRecord(promoter?.data) ? promoter.data : {};
  const role = String(promoter?.role || value(promoterData, "role") || "");
  if (
    !promoter ||
    promoter.status !== "ACTIVO" ||
    !["PROMOTOR", "PROMOTOR ROTATIVO", "PROMOTOR PERMANENTE"].includes(role)
  )
    throw new Error("El promotor de la marcación no existe o está inactivo.");

  const client = await db.query(
    "SELECT id FROM clients WHERE id=$1 AND market_id=$2 AND status='ACTIVO' LIMIT 1",
    [clientId, marketId],
  );
  if (!client.rows.length)
    throw new Error("El Cliente no pertenece al Mercado o está inactivo.");

  const market = await db.query(
    "SELECT id FROM markets WHERE id=$1 AND status='ACTIVO' LIMIT 1",
    [marketId],
  );
  if (!market.rows.length)
    throw new Error("El Mercado de la marcación no existe o está inactivo.");

  const assignment = await db.query(
    "SELECT market_ids,client_ids FROM assignments WHERE promoter_id=$1 LIMIT 1",
    [promoterId],
  );
  const coverage = assignment.rows[0];
  const allowedMarkets = coverage
    ? Array.isArray(coverage.market_ids)
      ? coverage.market_ids.map(String)
      : []
    : value(promoterData, "marketId")
      ? [value(promoterData, "marketId")]
      : [];
  const allowedClients = coverage && Array.isArray(coverage.client_ids)
    ? coverage.client_ids.map(String)
    : [];

  if (!allowedMarkets.includes(marketId))
    throw new Error("El Mercado no está asignado al promotor.");
  if (coverage && !allowedClients.includes(clientId))
    throw new Error("El Cliente no está asignado al promotor.");

  const campaignDay = campaignDateParts(date).day;
  const bounds = campaignDayBounds(campaignDay);
  const count = await db.query(
    `SELECT COUNT(*)::int AS count
       FROM attendance
      WHERE promoter_id=$1
        AND event_type=$2
        AND event_date >= $3::timestamptz
        AND event_date <= $4::timestamptz
        AND id<>$5`,
    [promoterId, type, bounds.start, bounds.end, value(record, "id")],
  );
  if (Number(count.rows[0]?.count || 0) >= 3)
    throw new Error(
      `Ya existe el máximo de 3 ${type === "ENTRADA" ? "entradas" : "salidas"} para ese día.`,
    );

  const isRotative = role === "PROMOTOR ROTATIVO";
  const latest = await db.query(
    isRotative
      ? `SELECT event_type
           FROM attendance
          WHERE promoter_id=$1
            AND market_id=$2
            AND event_date >= $3::timestamptz
            AND event_date < $4::timestamptz
            AND id<>$5
          ORDER BY event_date DESC,created_at DESC
          LIMIT 1`
      : `SELECT event_type
           FROM attendance
          WHERE promoter_id=$1
            AND client_id=$2
            AND event_date >= $3::timestamptz
            AND event_date < $4::timestamptz
            AND id<>$5
          ORDER BY event_date DESC,created_at DESC
          LIMIT 1`,
    [promoterId, isRotative ? marketId : clientId, bounds.start, date.toISOString(), value(record, "id")],
  );
  const latestType = String(latest.rows[0]?.event_type || "");
  if (type === "SALIDA" && latestType !== "ENTRADA")
    throw new Error("La Salida requiere una Entrada activa previa.");
  if (type === "ENTRADA" && latestType === "ENTRADA")
    throw new Error("Ya existe una Entrada activa previa.");

  return { role, campaignDay };
}

async function syncSnapshot(
  incoming: Partial<StorageSnapshot>,
  incomingRevision?: string | null,
) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended('catalog_revision',0))",
    );
    const catalogRevision = await readCatalogRevision(
      client as unknown as QueryClient,
    );
    const catalogIsAuthorized =
      !catalogRevision || incomingRevision === catalogRevision;
    const guardedIncoming: Partial<StorageSnapshot> =
      catalogRevision && !catalogIsAuthorized
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
            users: Array.isArray(incoming.users)
              ? incoming.users.filter(
                  (user) => value(user, "role") === "ANALISTA",
                )
              : incoming.users,
          }
        : { ...incoming, assignments: [] };
    const saleIdsToLock = new Set<string>();
    for (const sale of Array.isArray(guardedIncoming.sales)
      ? guardedIncoming.sales
      : []) {
      const saleId = value(sale, "id");
      if (saleId) saleIdsToLock.add(saleId);
    }
    for (const movement of Array.isArray(guardedIncoming.movements)
      ? guardedIncoming.movements
      : []) {
      const saleId = saleIdFromCanjeMovement(movement);
      if (saleId) saleIdsToLock.add(saleId);
    }
    for (const saleId of [...saleIdsToLock].sort()) {
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`sale:${saleId}`],
      );
    }
    await lockInventoryLedger(client as unknown as QueryClient);
    const deletedSalesResult = await client.query(
      "SELECT record_id FROM app_storage_tombstones WHERE collection='sales'",
    );
    const deletedSaleIds = new Set(
      deletedSalesResult.rows.map((row) => String(row.record_id)),
    );
    const tombstones = await client.query(
      "SELECT collection,record_id FROM app_storage_tombstones",
    );
    const deletedRecords = new Set(
      tombstones.rows.map((row) => `${row.collection}:${row.record_id}`),
    );
    for (const name of Object.keys(collectionConfig) as CollectionName[]) {
      // inventory es histórico: nunca se acepta como fuente de saldo operativo.
      if (name === "inventory") continue;
      const sourceRecords = Array.isArray(guardedIncoming[name])
        ? guardedIncoming[name]
        : [];
      const records =
        name === "attendance"
          ? [...sourceRecords].sort(
              (first, second) =>
                dateValue(first).getTime() - dateValue(second).getTime(),
            )
          : sourceRecords;
      for (const record of records) {
        if (!isRecord(record)) continue;
        if (deletedRecords.has(`${name}:${value(record, "id")}`)) continue;
        const config = collectionConfig[name];
        const existing = await client.query(
          `SELECT data FROM ${config.table} WHERE ${config.column}=$1`,
          [value(record, config.key)],
        );
        const editedAt = existing.rows[0]?.data?.updatedAt;
        if (
          editedAt &&
          (!recordDate(record) || String(editedAt) > String(recordDate(record)))
        )
          continue;
        if (
          name === "sales" &&
          record &&
          typeof record === "object" &&
          deletedSaleIds.has(value(record, "id"))
        )
          continue;
        if (name === "movements" && record && typeof record === "object") {
          if (isLegacyMarketInventoryMovement(record)) continue;
          const saleId = saleIdFromCanjeMovement(record);
          if (saleId && deletedSaleIds.has(saleId)) continue;
        }
        if (record && typeof record === "object") {
          const isNewRecord = !existing.rows.length;
          if (isNewRecord && name === "attendance") {
            await validateNewAttendance(
              client as unknown as QueryClient,
              record,
            );
          }
          if (isNewRecord && name === "sales") {
            requireFinalClientForCanje(record);
          }
          if (isNewRecord && name === "sales" && hasRedemptionConsumption(record)) {
            const requirementsSource = isRecord(record.redemptionItems) ? record.redemptionItems : {};
            const requirements = Object.fromEntries(
              redemptionItemIds.map((itemId) => [itemId, Math.max(0, Math.floor(Number(requirementsSource[itemId]) || 0))]),
            );
            await applyWarehouseStockMovement(
              client as unknown as QueryClient,
              value(record, "marketId"),
              requirements,
              "CANJE",
              value(record, "promoterId") || value(record, "createdById") || "SYNC",
              `SALE:${value(record, "id")}`,
            );
          }
          if (name === "movements" && value(record, "kind") === "DEGUSTACION") {
            const movementId = value(record, "id");
            const existingMovement = await client.query(
              "SELECT id FROM inventory_movements WHERE id=$1 LIMIT 1",
              [movementId],
            );
            if (!existingMovement.rows.length) {
              const productId = value(record, "degustacionProductId");
              const quantity = Math.max(0, Math.trunc(Number(record.quantity) || 0));
              const maxQuantity =
                productId === "PANETON_900G"
                  ? 2
                  : productId === "PANETON_85G"
                    ? 8
                    : 0;
              if (!maxQuantity)
                throw new Error("La presentación de degustación no es válida.");
              if (quantity < 1 || quantity > maxQuantity)
                throw new Error(
                  `Cantidad inválida para ${productId}. Máximo permitido: ${maxQuantity}.`,
                );
              await applyWarehouseStockMovement(
                client as unknown as QueryClient,
                value(record, "marketId"),
                { [productId]: quantity },
                "DEGUSTACION",
                value(record, "actorId") || value(record, "promoterId"),
                `DEGUSTACION:${movementId}`,
              );
            }
          }
          await upsertRecord(client as unknown as QueryClient, name, record);
        }
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

async function authorizedTradeActor(req: Request) {
  const dni = req.get("x-admin-dni") || "";
  const key = req.get("x-admin-key") || "";
  if (!dni || !key) return null;
  const credentials = await pool.query(
    "SELECT id,role,data,password_hash,status FROM users WHERE dni=$1 LIMIT 1",
    [dni],
  );
  const actor = credentials.rows[0];
  const actorData = isRecord(actor?.data) ? actor.data : {};
  const actorRole = String(actor?.role || value(actorData, "role") || "");
  if (
    !actor ||
    actor.status !== "ACTIVO" ||
    !["ADMIN", "ANALISTA"].includes(actorRole) ||
    !actor.password_hash ||
    !(await verifyPassword(key, actor.password_hash))
  ) return null;
  return { id: String(actor.id), role: actorRole, data: actorData };
}

async function authorizedWarehouseActor(req: Request) {
  return authorizedTradeActor(req);
}


const warehouseTransferItemIds = [
  "PANETON_900G",
  "PANETON_85G",
  "AVENA",
  "BATEA",
  "MANDIL",
  "SPAGHETTI",
] as const;

function normalizeTransferItems(input: unknown) {
  const record = isRecord(input) ? input : {};
  const items: Record<string, number> = {};
  for (const itemId of warehouseTransferItemIds) {
    const quantity = Math.max(0, Math.floor(Number(record[itemId]) || 0));
    if (quantity > 0) items[itemId] = quantity;
  }
  return items;
}

async function lockTransferWarehouses(
  db: QueryClient,
  sourceWarehouseId: string,
  destinationWarehouseId: string,
) {
  if (!sourceWarehouseId || !destinationWarehouseId)
    throw new Error("Selecciona almacén origen y destino.");
  if (sourceWarehouseId === destinationWarehouseId)
    throw new Error("El almacén origen y destino deben ser diferentes.");
  const ids = [sourceWarehouseId, destinationWarehouseId].sort();
  const result = await db.query(
    "SELECT id,name,status,stock,data FROM warehouses WHERE id = ANY($1::text[]) ORDER BY id FOR UPDATE",
    [ids],
  );
  if (result.rows.length !== 2)
    throw new Error("Uno de los almacenes no existe.");
  const byId = new Map(result.rows.map((row) => [String(row.id), row]));
  const source = byId.get(sourceWarehouseId);
  const destination = byId.get(destinationWarehouseId);
  if (!source || !destination)
    throw new Error("No se pudieron identificar los almacenes del traslado.");
  if (source.status !== "ACTIVO" || destination.status !== "ACTIVO")
    throw new Error("Origen y destino deben estar activos.");
  return { source, destination };
}

async function applyWarehouseTransfer(
  db: QueryClient,
  transferId: string,
  sourceWarehouseId: string,
  destinationWarehouseId: string,
  items: Record<string, number>,
  actorId: string,
  movementDate: string,
) {
  const { source, destination } = await lockTransferWarehouses(
    db,
    sourceWarehouseId,
    destinationWarehouseId,
  );
  const sourceStock = isRecord(source.stock) ? { ...source.stock } : {};
  const destinationStock = isRecord(destination.stock) ? { ...destination.stock } : {};
  const entries = Object.entries(items).filter(([, quantity]) => quantity > 0);
  if (!entries.length) throw new Error("Ingresa al menos un producto para trasladar.");

  for (const [itemId, quantity] of entries) {
    const available = Math.max(0, Number(sourceStock[itemId]) || 0);
    if (available < quantity)
      throw new Error(
        `Stock insuficiente de ${itemId} en ${source.name}. Disponible: ${available}.`,
      );
  }

  for (const [itemId, quantity] of entries) {
    sourceStock[itemId] = Math.max(0, Number(sourceStock[itemId]) || 0) - quantity;
    destinationStock[itemId] =
      Math.max(0, Number(destinationStock[itemId]) || 0) + quantity;

    const outMovement = {
      id: `TRS-OUT-${transferId}-${itemId}-${randomUUID()}`,
      warehouseId: sourceWarehouseId,
      kind: "TRASLADO_SALIDA",
      itemId,
      quantity: -quantity,
      actorId,
      transferId,
      referenceId: `TRANSFER:${transferId}`,
      date: movementDate,
      destinationWarehouseId,
    };
    const inMovement = {
      id: `TRS-IN-${transferId}-${itemId}-${randomUUID()}`,
      warehouseId: destinationWarehouseId,
      kind: "TRASLADO_ENTRADA",
      itemId,
      quantity,
      actorId,
      transferId,
      referenceId: `TRANSFER:${transferId}`,
      date: movementDate,
      sourceWarehouseId,
    };
    await db.query(
      "INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [outMovement.id, sourceWarehouseId, outMovement.kind, itemId, -quantity, actorId, movementDate, outMovement],
    );
    await db.query(
      "INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [inMovement.id, destinationWarehouseId, inMovement.kind, itemId, quantity, actorId, movementDate, inMovement],
    );
  }

  await db.query(
    "UPDATE warehouses SET stock=$2,data=jsonb_set(COALESCE(data,'{}'::jsonb),'{stock}',$2::jsonb,true),updated_at=now() WHERE id=$1",
    [sourceWarehouseId, sourceStock],
  );
  await db.query(
    "UPDATE warehouses SET stock=$2,data=jsonb_set(COALESCE(data,'{}'::jsonb),'{stock}',$2::jsonb,true),updated_at=now() WHERE id=$1",
    [destinationWarehouseId, destinationStock],
  );
}

async function reverseWarehouseTransfer(
  db: QueryClient,
  transfer: {
    id: string;
    source_warehouse_id: string;
    destination_warehouse_id: string;
    items: unknown;
  },
  actorId: string,
) {
  const items = normalizeTransferItems(transfer.items);
  const { source, destination } = await lockTransferWarehouses(
    db,
    String(transfer.source_warehouse_id),
    String(transfer.destination_warehouse_id),
  );
  const sourceStock = isRecord(source.stock) ? { ...source.stock } : {};
  const destinationStock = isRecord(destination.stock) ? { ...destination.stock } : {};
  const entries = Object.entries(items).filter(([, quantity]) => quantity > 0);

  for (const [itemId, quantity] of entries) {
    const destinationAvailable = Math.max(0, Number(destinationStock[itemId]) || 0);
    if (destinationAvailable < quantity) {
      throw new Error(
        `No se puede editar/eliminar el traslado porque ${destination.name} ya no tiene suficientes unidades de ${itemId} para revertirlo. Disponible: ${destinationAvailable}.`,
      );
    }
  }

  const movementDate = new Date().toISOString();
  for (const [itemId, quantity] of entries) {
    sourceStock[itemId] = Math.max(0, Number(sourceStock[itemId]) || 0) + quantity;
    destinationStock[itemId] =
      Math.max(0, Number(destinationStock[itemId]) || 0) - quantity;
    const sourceMovement = {
      id: `TRS-REV-SRC-${transfer.id}-${itemId}-${randomUUID()}`,
      warehouseId: String(transfer.source_warehouse_id),
      kind: "TRASLADO_REVERSION_ORIGEN",
      itemId,
      quantity,
      actorId,
      transferId: transfer.id,
      referenceId: `TRANSFER:${transfer.id}`,
      date: movementDate,
    };
    const destinationMovement = {
      id: `TRS-REV-DST-${transfer.id}-${itemId}-${randomUUID()}`,
      warehouseId: String(transfer.destination_warehouse_id),
      kind: "TRASLADO_REVERSION_DESTINO",
      itemId,
      quantity: -quantity,
      actorId,
      transferId: transfer.id,
      referenceId: `TRANSFER:${transfer.id}`,
      date: movementDate,
    };
    await db.query(
      "INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [sourceMovement.id, transfer.source_warehouse_id, sourceMovement.kind, itemId, quantity, actorId, movementDate, sourceMovement],
    );
    await db.query(
      "INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
      [destinationMovement.id, transfer.destination_warehouse_id, destinationMovement.kind, itemId, -quantity, actorId, movementDate, destinationMovement],
    );
  }

  await db.query(
    "UPDATE warehouses SET stock=$2,data=jsonb_set(COALESCE(data,'{}'::jsonb),'{stock}',$2::jsonb,true),updated_at=now() WHERE id=$1",
    [transfer.source_warehouse_id, sourceStock],
  );
  await db.query(
    "UPDATE warehouses SET stock=$2,data=jsonb_set(COALESCE(data,'{}'::jsonb),'{stock}',$2::jsonb,true),updated_at=now() WHERE id=$1",
    [transfer.destination_warehouse_id, destinationStock],
  );
}

async function warehouseForMarket(db: QueryClient, marketId: string) {
  const marketResult = await db.query("SELECT data FROM markets WHERE id=$1 AND status='ACTIVO' LIMIT 1", [marketId]);
  const marketData = isRecord(marketResult.rows[0]?.data) ? marketResult.rows[0].data : {};
  const directWarehouseId = value(marketData, "warehouseId");
  if (directWarehouseId) {
    const direct = await db.query("SELECT id,name,stock,data FROM warehouses WHERE id=$1 AND status='ACTIVO' LIMIT 1", [directWarehouseId]);
    if (!direct.rows.length) throw new Error("El almacén asignado al mercado no está activo o no existe.");
    return direct.rows[0];
  }
  const legacy = await db.query("SELECT id,name,stock,data FROM warehouses WHERE status='ACTIVO' AND $1 = ANY(market_ids) LIMIT 2", [marketId]);
  if (!legacy.rows.length) throw new Error("El mercado no tiene almacén asignado.");
  if (legacy.rows.length > 1) throw new Error("El mercado está asignado a más de un almacén.");
  return legacy.rows[0];
}

async function applyWarehouseStockMovement(
  db: QueryClient,
  marketId: string,
  requirements: Record<string, number>,
  kind: string,
  actorId: string,
  referenceId: string,
) {
  const warehouse = await warehouseForMarket(db, marketId);
  const locked = await db.query("SELECT id,name,stock FROM warehouses WHERE id=$1 FOR UPDATE", [warehouse.id]);
  const row = locked.rows[0];
  const stock = isRecord(row.stock) ? { ...row.stock } : {};
  for (const [itemId, raw] of Object.entries(requirements)) {
    const quantity = Math.max(0, Math.floor(Number(raw) || 0));
    if (!quantity) continue;
    const available = Math.max(0, Number(stock[itemId]) || 0);
    if (available < quantity) throw new Error(`Stock insuficiente de ${itemId} en ${row.name}. Disponible: ${available}.`);
  }
  const now = new Date().toISOString();
  for (const [itemId, raw] of Object.entries(requirements)) {
    const quantity = Math.max(0, Math.floor(Number(raw) || 0));
    if (!quantity) continue;
    stock[itemId] = Math.max(0, Number(stock[itemId]) || 0) - quantity;
    const movement = { id:`ALM-CONS-${randomUUID()}`, warehouseId:String(row.id), marketId, kind, itemId, quantity:-quantity, actorId, referenceId, date:now };
    await db.query("INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [movement.id,row.id,kind,itemId,-quantity,actorId,now,movement]);
  }
  await db.query("UPDATE warehouses SET stock=$2,data=jsonb_set(COALESCE(data,'{}'::jsonb),'{stock}',$2::jsonb,true),updated_at=now() WHERE id=$1", [row.id,stock]);
  return { warehouseId:String(row.id), stock };
}

async function restoreWarehouseStockMovements(db: QueryClient, referenceId: string, actorId: string) {
  const existing = await db.query(
    "SELECT id,warehouse_id,item_id,quantity,data FROM warehouse_movements WHERE data->>'referenceId'=$1 AND quantity<0 FOR UPDATE",
    [referenceId],
  );
  if (!existing.rows.length) return 0;
  const grouped = new Map<string, Array<{itemId:string; quantity:number; sourceId:string}>>();
  for (const row of existing.rows) {
    const items = grouped.get(String(row.warehouse_id)) || [];
    items.push({ itemId:String(row.item_id), quantity:Math.abs(Number(row.quantity)||0), sourceId:String(row.id) });
    grouped.set(String(row.warehouse_id),items);
  }
  const now = new Date().toISOString();
  let restored = 0;
  for (const [warehouseId,items] of grouped) {
    const locked = await db.query("SELECT stock FROM warehouses WHERE id=$1 FOR UPDATE",[warehouseId]);
    if (!locked.rows.length) continue;
    const stock = isRecord(locked.rows[0].stock) ? { ...locked.rows[0].stock } : {};
    for (const item of items) {
      const already = await db.query("SELECT 1 FROM warehouse_movements WHERE data->>'restoresMovementId'=$1 LIMIT 1",[item.sourceId]);
      if (already.rows.length) continue;
      stock[item.itemId]=Math.max(0,Number(stock[item.itemId])||0)+item.quantity;
      const movement={id:`ALM-REST-${randomUUID()}`,warehouseId,itemId:item.itemId,quantity:item.quantity,kind:"RESTAURACION",actorId,referenceId,date:now,restoresMovementId:item.sourceId};
      await db.query("INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[movement.id,warehouseId,movement.kind,item.itemId,item.quantity,actorId,now,movement]);
      restored += 1;
    }
    await db.query("UPDATE warehouses SET stock=$2,data=jsonb_set(COALESCE(data,'{}'::jsonb),'{stock}',$2::jsonb,true),updated_at=now() WHERE id=$1",[warehouseId,stock]);
  }
  return restored;
}

async function recalculateDegustacionClosure(
  db: QueryClient,
  promoterId: string,
  marketId: string,
  movementDate: string,
) {
  if (!promoterId || !marketId || !movementDate) return;

  const closures = await db.query(
    `SELECT id,data,closure_date
       FROM session_closures
      WHERE promoter_id=$1
        AND market_id=$2
        AND ABS(EXTRACT(EPOCH FROM (closure_date - $3::timestamptz))) <= 43200
      ORDER BY ABS(EXTRACT(EPOCH FROM (closure_date - $3::timestamptz)))
      LIMIT 1
      FOR UPDATE`,
    [promoterId, marketId, movementDate],
  );
  const closure = closures.rows[0];
  if (!closure) return;

  const closureDate = new Date(String(closure.closure_date)).toISOString();
  const movements = await db.query(
    `SELECT quantity,data
       FROM inventory_movements
      WHERE kind='DEGUSTACION'
        AND market_id=$1
        AND COALESCE(data->>'promoterId',data->>'actorId','')=$2
        AND movement_date BETWEEN $3::timestamptz - interval '1 minute'
                              AND $3::timestamptz + interval '1 minute'`,
    [marketId, promoterId, closureDate],
  );

  let tasting900g = 0;
  let tasting85g = 0;
  for (const row of movements.rows) {
    const data = isRecord(row.data) ? row.data : {};
    const productId = value(data, "degustacionProductId");
    const quantity = Math.max(0, Math.floor(Number(row.quantity) || 0));
    if (productId === "PANETON_85G") tasting85g += quantity;
    else if (productId === "PANETON_900G" || productId === "PANETON")
      tasting900g += quantity;
  }
  const tastingUsed = tasting900g + tasting85g;
  const leads = tasting900g * 80 + tasting85g * 10;
  const updatedAt = new Date().toISOString();
  const data = isRecord(closure.data) ? closure.data : {};
  const nextData = {
    ...data,
    tastingUsed,
    tasting900g,
    tasting85g,
    leads,
    updatedAt,
  };
  await db.query(
    `UPDATE session_closures
        SET tasting_used=$2,
            leads=$3,
            data=$4,
            record_updated_at=$5,
            updated_at=now()
      WHERE id=$1`,
    [closure.id, tastingUsed, leads, nextData, updatedAt],
  );
}


router.get("/app-storage/warehouses/:id/audit", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) return void res.status(403).json({ message: "Solo Admin o Analista puede auditar almacenes." });
  const warehouseId=String(req.params.id||"");
  const warehouseResult=await pool.query("SELECT id,name,stock,data FROM warehouses WHERE id=$1 LIMIT 1",[warehouseId]);
  if(!warehouseResult.rows.length) return void res.status(404).json({message:"El almacén no existe."});
  const movements=await pool.query(
    `SELECT wm.id,wm.kind,wm.item_id,wm.quantity,wm.actor_id,wm.movement_date,wm.data,
            COALESCE(m.name,wm.data->>'marketId','') AS market_name,
            COALESCE(u.data->>'name',u.dni,wm.actor_id,'') AS actor_name
       FROM warehouse_movements wm
       LEFT JOIN markets m ON m.id=wm.data->>'marketId'
       LEFT JOIN users u ON u.id=wm.actor_id
      WHERE wm.warehouse_id=$1
      ORDER BY wm.movement_date,wm.id`,
    [warehouseId],
  );
  const totals:Record<string,{entries:number;exits:number;net:number}>={};
  for(const row of movements.rows){
    const item=String(row.item_id||"SIN_ITEM");
    const q=Number(row.quantity)||0;
    const current=totals[item]||{entries:0,exits:0,net:0};
    if(q>0)current.entries+=q; else current.exits+=Math.abs(q);
    current.net+=q; totals[item]=current;
  }
  res.json({warehouse:{id:warehouseResult.rows[0].id,name:warehouseResult.rows[0].name,stock:warehouseResult.rows[0].stock},totals,movements:movements.rows});
});

router.post("/app-storage/warehouses/regularize-history", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) return void res.status(403).json({ message: "Solo Admin o Analista puede regularizar almacenes." });
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const warehouses=await db.query("SELECT id,name,stock FROM warehouses ORDER BY name FOR UPDATE");
    const markets=await db.query("SELECT id,data FROM markets");
    const warehouseByMarket=new Map<string,string>();
    for(const row of markets.rows){
      const data=isRecord(row.data)?row.data:{};
      const warehouseId=value(data,"warehouseId");
      if(warehouseId) warehouseByMarket.set(String(row.id),warehouseId);
    }
    const baseByWarehouse=new Map<string,Record<string,number>>();
    const baseDateByWarehouse=new Map<string,string|null>();
    for(const warehouse of warehouses.rows){
      const warehouseId=String(warehouse.id);
      const correction=await db.query("SELECT data,movement_date FROM warehouse_movements WHERE warehouse_id=$1 AND kind='CORRECCION_IMPORTACION' ORDER BY movement_date DESC,created_at DESC LIMIT 1",[warehouseId]);
      const stock:Record<string,number>={PANETON_900G:0,PANETON_85G:0,AVENA:0,BATEA:0,MANDIL:0,SPAGHETTI:0};
      let baseDate:string|null=null;
      if(correction.rows.length){
        const data=isRecord(correction.rows[0].data)?correction.rows[0].data:{};
        const quantities=isRecord(data.quantities)?data.quantities:{};
        for(const itemId of Object.keys(stock)) stock[itemId]=Math.max(0,Math.floor(Number(quantities[itemId])||0));
        baseDate=correction.rows[0].movement_date?new Date(correction.rows[0].movement_date).toISOString():null;
      } else {
        const initial=await db.query("SELECT item_id,SUM(quantity)::numeric AS quantity,MAX(movement_date) AS base_date FROM warehouse_movements WHERE warehouse_id=$1 AND kind='CARGA_INICIAL' GROUP BY item_id",[warehouseId]);
        if(!initial.rows.length) continue;
        for(const row of initial.rows) if(Object.prototype.hasOwnProperty.call(stock,String(row.item_id))) stock[String(row.item_id)]=Math.max(0,Number(row.quantity)||0);
        const dates=initial.rows.map((row:any)=>row.base_date).filter(Boolean).map((v:any)=>new Date(v).getTime());
        baseDate=dates.length?new Date(Math.max(...dates)).toISOString():null;
      }
      if(baseDate){
        const recargas=await db.query("SELECT item_id,SUM(quantity)::numeric AS quantity FROM warehouse_movements WHERE warehouse_id=$1 AND kind='RECARGA' AND movement_date>$2 GROUP BY item_id",[warehouseId,baseDate]);
        for(const row of recargas.rows) if(Object.prototype.hasOwnProperty.call(stock,String(row.item_id))) stock[String(row.item_id)]+=Math.max(0,Number(row.quantity)||0);
      }
      baseByWarehouse.set(warehouseId,stock);
      baseDateByWarehouse.set(warehouseId,baseDate);
    }
    const normalizeWarehouseName=(input:unknown)=>String(input||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();
    const explicitAdjustments:Record<string,Record<string,number>>={
      TRUJILLO:{AVENA:120,SPAGHETTI:100},
      "LA PARADA":{PANETON_900G:21,PANETON_85G:21},
      "UNICACHI NORTE":{AVENA:1200},
      PRODUCTORES:{AVENA:1200},
    };
    let explicitAdjustmentsApplied=0;
    for(const warehouse of warehouses.rows){
      const warehouseId=String(warehouse.id);
      const stock=baseByWarehouse.get(warehouseId);
      if(!stock) continue;
      const adjustment=explicitAdjustments[normalizeWarehouseName(warehouse.name)];
      if(!adjustment) continue;
      for(const [itemId,quantity] of Object.entries(adjustment)){
        stock[itemId]=(Number(stock[itemId])||0)+Math.max(0,Math.floor(Number(quantity)||0));
      }
      explicitAdjustmentsApplied++;
    }
    const activeTransfers=await db.query(
      "SELECT id,source_warehouse_id,destination_warehouse_id,items,transfer_date FROM transfers WHERE status='ACTIVO' ORDER BY transfer_date,id",
    );
    let transfersProcessed=0;
    for(const transfer of activeTransfers.rows){
      const transferDate=new Date(transfer.transfer_date).toISOString();
      const sourceId=String(transfer.source_warehouse_id||"");
      const destinationId=String(transfer.destination_warehouse_id||"");
      const items=normalizeTransferItems(transfer.items);
      const sourceStock=baseByWarehouse.get(sourceId);
      const destinationStock=baseByWarehouse.get(destinationId);
      const sourceBaseDate=baseDateByWarehouse.get(sourceId);
      const destinationBaseDate=baseDateByWarehouse.get(destinationId);
      const applySource=Boolean(sourceStock)&&(!sourceBaseDate||new Date(transferDate).getTime()>new Date(sourceBaseDate).getTime());
      const applyDestination=Boolean(destinationStock)&&(!destinationBaseDate||new Date(transferDate).getTime()>new Date(destinationBaseDate).getTime());
      for(const [itemId,quantity] of Object.entries(items)){
        if(applySource&&sourceStock){
          if((Number(sourceStock[itemId])||0)<quantity)
            throw new Error(`Stock insuficiente de ${itemId} al reconstruir traslado ${transfer.id} desde almacén origen.`);
          sourceStock[itemId]=(Number(sourceStock[itemId])||0)-quantity;
        }
        if(applyDestination&&destinationStock)
          destinationStock[itemId]=(Number(destinationStock[itemId])||0)+quantity;
      }
      transfersProcessed++;
    }

    const canjes=await db.query("SELECT id,market_id,item_id,quantity,data FROM inventory_movements WHERE kind='CANJE' ORDER BY movement_date,id");
    const saleIdsWithCanje=new Set<string>();
    let canjesProcessed=0,tastingsProcessed=0,skipped=0;
    const subtract=(marketId:string,requirements:Record<string,number>,label:string)=>{
      const warehouseId=warehouseByMarket.get(marketId);
      if(!warehouseId){skipped++;return;}
      const stock=baseByWarehouse.get(warehouseId);
      if(!stock){skipped++;return;}
      for(const [itemId,raw] of Object.entries(requirements)){
        const qty=Math.max(0,Math.floor(Number(raw)||0));
        if(!qty)continue;
        if(!Object.prototype.hasOwnProperty.call(stock,itemId))continue;
        if(stock[itemId]<qty) throw new Error(`Stock insuficiente de ${itemId} al reconstruir ${label}. Disponible: ${stock[itemId]}, requerido: ${qty}.`);
        stock[itemId]-=qty;
      }
    };
    for(const row of canjes.rows){
      const movementId=String(row.id||"");
      const match=movementId.match(/^CAN-(.+)-(AVENA|BATEA|MANDIL|SPAGHETTI)$/);
      if(match) saleIdsWithCanje.add(match[1]);
      const source=isRecord(row.data)?row.data:{};
      const components=isRecord(source.canjeComponents)?source.canjeComponents:null;
      const quantity=Math.max(0,Math.floor(Number(row.quantity)||0));
      const requirements:Record<string,number>={};
      if(components){
        for(const itemId of redemptionItemIds) requirements[itemId]=Math.max(0,Math.floor((Number(components[itemId])||0)*quantity));
      }else{
        const itemId=String(row.item_id||value(source,"itemId"));
        if(redemptionItemIds.includes(itemId)&&quantity) requirements[itemId]=quantity;
      }
      if(!Object.values(requirements).some(Number)){skipped++;continue;}
      subtract(String(row.market_id),requirements,`canje ${movementId}`);
      canjesProcessed++;
    }
    const sales=await db.query("SELECT id,market_id,data FROM sales WHERE data ? 'redemptionItems' ORDER BY sale_date,id");
    for(const row of sales.rows){
      const saleId=String(row.id||"");
      if(saleIdsWithCanje.has(saleId)){skipped++;continue;}
      const source=isRecord(row.data?.redemptionItems)?row.data.redemptionItems:{};
      const requirements=Object.fromEntries(redemptionItemIds.map(itemId=>[itemId,Math.max(0,Math.floor(Number(source[itemId])||0))]));
      if(!Object.values(requirements).some(Number)){skipped++;continue;}
      subtract(String(row.market_id),requirements,`venta ${saleId}`);
      canjesProcessed++;
    }
    const tastings=await db.query("SELECT id,market_id,quantity FROM inventory_movements WHERE kind='DEGUSTACION' ORDER BY movement_date,id");
    for(const row of tastings.rows){
      const quantity=Math.max(0,Math.floor(Number(row.quantity)||0));
      if(!quantity){skipped++;continue;}
      subtract(String(row.market_id),{PANETON_900G:quantity},`degustación ${row.id}`);
      tastingsProcessed++;
    }
    const now=new Date().toISOString();
    for(const [warehouseId,stock] of baseByWarehouse){
      await db.query("UPDATE warehouses SET stock=$2,data=jsonb_set(COALESCE(data,'{}'::jsonb),'{stock}',$2::jsonb,true),updated_at=now() WHERE id=$1",[warehouseId,stock]);
      const movement={id:`ALM-REBUILD-${randomUUID()}`,warehouseId,kind:"RECONSTRUCCION_CONSUMOS",itemId:"MULTI",quantity:0,actorId:actor.id,date:now,stock};
      await db.query("INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[movement.id,warehouseId,movement.kind,"MULTI",0,actor.id,now,movement]);
    }
    await db.query("COMMIT");
    res.json({warehousesRebuilt:baseByWarehouse.size,explicitAdjustmentsApplied,transfersProcessed,canjesProcessed,tastingsProcessed,skipped});
  } catch(error) {
    await db.query("ROLLBACK").catch(()=>undefined);
    req.log.error({err:error},"Unable to rebuild warehouse consumption history");
    res.status(409).json({message:error instanceof Error?error.message:"No se pudo reconstruir el stock histórico."});
  } finally { db.release(); }
});

router.post("/app-storage/warehouses/regularize-september-zero-closures", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) {
    res.status(403).json({
      message: "Solo Admin o Analista puede regularizar cierres históricos.",
    });
    return;
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await lockInventoryLedger(db as unknown as QueryClient);

    const closures = await db.query(
      `SELECT sc.id,sc.promoter_id,sc.market_id,sc.client_id,sc.closure_date,sc.data
         FROM session_closures sc
        WHERE sc.closure_date >= '2026-09-14T00:00:00.000-05:00'::timestamptz
          AND sc.closure_date <= '2026-09-30T23:59:59.999-05:00'::timestamptz
          AND COALESCE(sc.tasting_used,0)=0
          AND NOT EXISTS (
            SELECT 1
              FROM inventory_movements im
             WHERE im.kind='DEGUSTACION'
               AND im.market_id=sc.market_id
               AND COALESCE(im.data->>'promoterId',im.data->>'actorId','')=sc.promoter_id
               AND im.movement_date BETWEEN sc.closure_date - interval '1 minute'
                                        AND sc.closure_date + interval '1 minute'
          )
        ORDER BY sc.closure_date,sc.id
        FOR UPDATE`,
    );

    let regularized = 0;
    const byWarehouse: Record<string, number> = {};

    for (const row of closures.rows) {
      const closureId = String(row.id || "");
      const promoterId = String(row.promoter_id || "");
      const marketId = String(row.market_id || "");
      const closureDate = new Date(String(row.closure_date)).toISOString();
      if (!closureId || !promoterId || !marketId || !closureDate) {
        throw new Error(`Cierre histórico incompleto: ${closureId || "sin id"}.`);
      }

      const warehouse = await warehouseForMarket(
        db as unknown as QueryClient,
        marketId,
      );
      const warehouseId = String(warehouse.id || "");
      const warehouseName = String(warehouse.name || warehouseId);
      byWarehouse[warehouseName] = (byWarehouse[warehouseName] || 0) + 1;

      const movementId = `REG-SEP26-${closureId}`;
      const existingMovement = await db.query(
        "SELECT 1 FROM inventory_movements WHERE id=$1 LIMIT 1",
        [movementId],
      );
      if (existingMovement.rows.length) continue;

      await applyWarehouseStockMovement(
        db as unknown as QueryClient,
        marketId,
        { PANETON_900G: 1 },
        "DEGUSTACION",
        promoterId,
        `DEGUSTACION:${movementId}`,
      );

      const movement: StoredRecord = {
        id: movementId,
        marketId,
        kind: "DEGUSTACION",
        degustacionProductId: "PANETON_900G",
        degustacionProductLabel: "Panetón 900 g",
        quantity: 1,
        actorId: promoterId,
        promoterId,
        date: closureDate,
        status: "SINCRONIZADA",
        regularization: "CIERRES_0_2026-09-14_2026-09-30",
        regularizedBy: actor.id,
        closureId,
        updatedAt: new Date().toISOString(),
      };
      await upsertRecord(
        db as unknown as QueryClient,
        "movements",
        movement,
      );

      await recalculateDegustacionClosure(
        db as unknown as QueryClient,
        promoterId,
        marketId,
        closureDate,
      );
      regularized += 1;
    }

    await db.query("COMMIT");
    res.json({
      regularized,
      startDate: "2026-09-14",
      endDate: "2026-09-30",
      productId: "PANETON_900G",
      quantityPerClosure: 1,
      leadsPerClosure: 80,
      byWarehouse,
      snapshot: await readSnapshot(),
    });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    req.log.error(
      { err: error },
      "Unable to regularize September closures with zero tasting",
    );
    res.status(409).json({
      message:
        error instanceof Error
          ? error.message
          : "No se pudieron regularizar los cierres de septiembre.",
    });
  } finally {
    db.release();
  }
});


router.get("/app-storage/transfers", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) {
    res.status(403).json({ message: "Solo Admin o Analista puede consultar traslados." });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT t.id,t.source_warehouse_id,t.destination_warehouse_id,t.items,t.note,t.status,
              t.actor_id,t.transfer_date,t.data,t.created_at,t.updated_at,
              ws.name AS source_warehouse_name,wd.name AS destination_warehouse_name
         FROM transfers t
         JOIN warehouses ws ON ws.id=t.source_warehouse_id
         JOIN warehouses wd ON wd.id=t.destination_warehouse_id
        ORDER BY t.transfer_date DESC,t.created_at DESC`,
    );
    res.json({
      transfers: result.rows.map((row) => ({
        id: String(row.id),
        sourceWarehouseId: String(row.source_warehouse_id),
        sourceWarehouseName: String(row.source_warehouse_name),
        destinationWarehouseId: String(row.destination_warehouse_id),
        destinationWarehouseName: String(row.destination_warehouse_name),
        items: isRecord(row.items) ? row.items : {},
        note: row.note || "",
        status: row.status,
        actorId: row.actor_id,
        date: new Date(row.transfer_date).toISOString(),
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    });
  } catch (error) {
    req.log.error({ err: error }, "Unable to read transfers");
    res.status(500).json({ message: "No se pudieron leer los traslados." });
  }
});

router.post("/app-storage/transfers", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) {
    res.status(403).json({ message: "Solo Admin o Analista puede registrar traslados." });
    return;
  }
  const input = isRecord(req.body?.transfer) ? req.body.transfer : {};
  const sourceWarehouseId = value(input, "sourceWarehouseId");
  const destinationWarehouseId = value(input, "destinationWarehouseId");
  const items = normalizeTransferItems(input.items);
  const note = value(input, "note");
  const transferDateRaw = value(input, "date");
  const transferDate = transferDateRaw
    ? new Date(transferDateRaw).toISOString()
    : new Date().toISOString();
  const id = value(input, "id") || `TRS-${randomUUID()}`;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const duplicate = await db.query("SELECT 1 FROM transfers WHERE id=$1 LIMIT 1", [id]);
    if (duplicate.rows.length) throw new Error("Ya existe un traslado con ese código.");
    await applyWarehouseTransfer(
      db as unknown as QueryClient,
      id,
      sourceWarehouseId,
      destinationWarehouseId,
      items,
      actor.id,
      transferDate,
    );
    const data = {
      id,
      sourceWarehouseId,
      destinationWarehouseId,
      items,
      note,
      status: "ACTIVO",
      actorId: actor.id,
      date: transferDate,
    };
    await db.query(
      `INSERT INTO transfers(id,source_warehouse_id,destination_warehouse_id,items,note,status,actor_id,transfer_date,data)
       VALUES($1,$2,$3,$4,$5,'ACTIVO',$6,$7,$8)`,
      [id, sourceWarehouseId, destinationWarehouseId, items, note || null, actor.id, transferDate, data],
    );
    await db.query("COMMIT");
    res.status(201).json({ transfer: data });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to create transfer");
    res.status(409).json({
      message: error instanceof Error ? error.message : "No se pudo registrar el traslado.",
    });
  } finally {
    db.release();
  }
});

router.put("/app-storage/transfers/:id", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) {
    res.status(403).json({ message: "Solo Admin o Analista puede editar traslados." });
    return;
  }
  const id = String(req.params.id || "").trim();
  const input = isRecord(req.body?.transfer) ? req.body.transfer : {};
  const sourceWarehouseId = value(input, "sourceWarehouseId");
  const destinationWarehouseId = value(input, "destinationWarehouseId");
  const items = normalizeTransferItems(input.items);
  const note = value(input, "note");
  const transferDateRaw = value(input, "date");
  const transferDate = transferDateRaw
    ? new Date(transferDateRaw).toISOString()
    : new Date().toISOString();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const currentResult = await db.query(
      "SELECT id,source_warehouse_id,destination_warehouse_id,items,status FROM transfers WHERE id=$1 FOR UPDATE",
      [id],
    );
    const current = currentResult.rows[0];
    if (!current) throw new Error("El traslado no existe.");
    if (current.status !== "ACTIVO") throw new Error("Un traslado anulado no puede editarse.");
    await reverseWarehouseTransfer(db as unknown as QueryClient, current, actor.id);
    await applyWarehouseTransfer(
      db as unknown as QueryClient,
      id,
      sourceWarehouseId,
      destinationWarehouseId,
      items,
      actor.id,
      transferDate,
    );
    const data = {
      id,
      sourceWarehouseId,
      destinationWarehouseId,
      items,
      note,
      status: "ACTIVO",
      actorId: actor.id,
      date: transferDate,
      editedAt: new Date().toISOString(),
    };
    await db.query(
      `UPDATE transfers
          SET source_warehouse_id=$2,destination_warehouse_id=$3,items=$4,note=$5,
              actor_id=$6,transfer_date=$7,data=$8,updated_at=now()
        WHERE id=$1`,
      [id, sourceWarehouseId, destinationWarehouseId, items, note || null, actor.id, transferDate, data],
    );
    await db.query("COMMIT");
    res.json({ transfer: data });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to update transfer");
    res.status(409).json({
      message: error instanceof Error ? error.message : "No se pudo editar el traslado.",
    });
  } finally {
    db.release();
  }
});

router.delete("/app-storage/transfers/:id", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) {
    res.status(403).json({ message: "Solo Admin o Analista puede eliminar traslados." });
    return;
  }
  const id = String(req.params.id || "").trim();
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const currentResult = await db.query(
      "SELECT id,source_warehouse_id,destination_warehouse_id,items,status,data FROM transfers WHERE id=$1 FOR UPDATE",
      [id],
    );
    const current = currentResult.rows[0];
    if (!current) throw new Error("El traslado no existe.");
    if (current.status !== "ACTIVO") throw new Error("El traslado ya está anulado.");
    await reverseWarehouseTransfer(db as unknown as QueryClient, current, actor.id);
    const currentData = isRecord(current.data) ? current.data : {};
    const data = {
      ...currentData,
      status: "ANULADO",
      cancelledAt: new Date().toISOString(),
      cancelledBy: actor.id,
    };
    await db.query(
      "UPDATE transfers SET status='ANULADO',data=$2,updated_at=now() WHERE id=$1",
      [id, data],
    );
    await db.query("COMMIT");
    res.json({ id, status: "ANULADO" });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to cancel transfer");
    res.status(409).json({
      message: error instanceof Error ? error.message : "No se pudo eliminar el traslado.",
    });
  } finally {
    db.release();
  }
});

router.get("/app-storage/warehouses", async (_req, res): Promise<void> => {
  try {
    const warehouses = await pool.query("SELECT data,stock,market_ids FROM warehouses ORDER BY name");
    const movements = await pool.query("SELECT data FROM warehouse_movements ORDER BY movement_date DESC,created_at DESC");
    res.json({
      warehouses: warehouses.rows.map((row) => ({ ...(isRecord(row.data) ? row.data : {}), stock: isRecord(row.stock) ? row.stock : {}, marketIds: Array.isArray(row.market_ids) ? row.market_ids : [] })),
      movements: movements.rows.map((row) => row.data),
    });
  } catch (error) {
    console.error("Unable to read warehouses", error);
    res.status(500).json({ message: "No se pudieron leer los almacenes." });
  }
});

router.post("/app-storage/warehouses", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) return void res.status(403).json({ message: "Solo Admin o Analista puede administrar almacenes." });
  const input = isRecord(req.body?.warehouse) ? req.body.warehouse : {};
  const id = value(input, "id") || `ALM-${randomUUID()}`;
  const name = value(input, "name").toUpperCase();
  const region = value(input, "region").toUpperCase();
  const department = value(input, "department").toUpperCase();
  const province = value(input, "province").toUpperCase();
  const district = value(input, "district").toUpperCase();
  if (!name || !region || !department || !province || !district)
    return void res.status(400).json({
      message: "Completa nombre, región, departamento, provincia y distrito del almacén.",
    });

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const duplicate = await db.query(
      "SELECT id FROM warehouses WHERE UPPER(name)=UPPER($1) AND id<>$2 LIMIT 1",
      [name, id],
    );
    if (duplicate.rows.length)
      throw new Error("Ya existe otro almacén con ese nombre.");

    const existing = await db.query("SELECT stock FROM warehouses WHERE id=$1 FOR UPDATE", [id]);
    const stock = isRecord(existing.rows[0]?.stock) ? existing.rows[0].stock : {};
    const status = value(input, "status") === "INACTIVO" ? "INACTIVO" : "ACTIVO";

    if (status === "INACTIVO") {
      const linkedMarkets = await db.query(
        "SELECT id FROM markets WHERE status='ACTIVO' AND data->>'warehouseId'=$1 LIMIT 1",
        [id],
      );
      if (linkedMarkets.rows.length)
        throw new Error("Reasigna los Mercados activos antes de desactivar este almacén.");
    }

    const warehouse = {
      ...input,
      id,
      name,
      region,
      department,
      province,
      district,
      marketIds: [],
      stock,
      status,
      updatedAt: new Date().toISOString(),
    };
    await db.query(
      `INSERT INTO warehouses(id,name,location,status,market_ids,stock,data)
       VALUES($1,$2,$3,$4,'{}'::text[],$5,$6)
       ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,location=EXCLUDED.location,status=EXCLUDED.status,data=EXCLUDED.data,updated_at=now()`,
      [id,name,[region,department,province,district].join(" / "),status,stock,warehouse],
    );
    await db.query("COMMIT");
    res.json({ warehouse });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    res.status(409).json({ message: error instanceof Error ? error.message : "No se pudo guardar el almacén." });
  } finally {
    db.release();
  }
});

router.delete("/app-storage/warehouses/:id", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) return void res.status(403).json({ message: "Solo Admin o Analista puede eliminar almacenes." });
  const id = String(req.params.id || "").trim();
  if (!id) return void res.status(400).json({ message: "El almacén es obligatorio." });

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query("SELECT stock FROM warehouses WHERE id=$1 FOR UPDATE", [id]);
    if (!found.rows.length) {
      await db.query("ROLLBACK");
      res.status(404).json({ message: "El almacén no existe." });
      return;
    }
    const linkedMarket = await db.query(
      "SELECT id FROM markets WHERE data->>'warehouseId'=$1 LIMIT 1",
      [id],
    );
    const legacyLinks = await db.query(
      "SELECT market_ids FROM warehouses WHERE id=$1",
      [id],
    );
    const legacyMarketIds = Array.isArray(legacyLinks.rows[0]?.market_ids)
      ? legacyLinks.rows[0].market_ids
      : [];
    if (linkedMarket.rows.length || legacyMarketIds.length)
      throw new Error("El almacén tiene Mercados asignados. Reasígnalos antes de eliminarlo.");

    const movement = await db.query(
      "SELECT 1 FROM warehouse_movements WHERE warehouse_id=$1 LIMIT 1",
      [id],
    );
    if (movement.rows.length)
      throw new Error("El almacén tiene historial de movimientos. Déjalo INACTIVO para conservar la trazabilidad.");

    const stock = isRecord(found.rows[0].stock) ? found.rows[0].stock : {};
    if (Object.values(stock).some((quantity) => Number(quantity) > 0))
      throw new Error("El almacén todavía tiene stock. No puede eliminarse.");

    await db.query("DELETE FROM warehouses WHERE id=$1", [id]);
    await db.query("COMMIT");
    res.json({ deleted: id });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    res.status(409).json({
      message: error instanceof Error ? error.message : "No se pudo eliminar el almacén.",
    });
  } finally {
    db.release();
  }
});

router.put("/app-storage/warehouses/:id/import-stock", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) return void res.status(403).json({ message: "Solo Admin o Analista puede corregir stock importado." });
  const quantities = isRecord(req.body?.quantities) ? req.body.quantities : {};
  const allowed = ["PANETON_900G","PANETON_85G","AVENA","BATEA","MANDIL","SPAGHETTI"];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query("SELECT stock,data FROM warehouses WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!found.rows[0]) throw new Error("El almacén no existe.");
    const stock = isRecord(found.rows[0].stock) ? { ...found.rows[0].stock } : {};
    const now = new Date().toISOString();
    for (const itemId of allowed) {
      if (!Object.prototype.hasOwnProperty.call(quantities,itemId)) continue;
      stock[itemId] = Math.max(0, Math.floor(Number(quantities[itemId]) || 0));
    }
    const movement = { id:`ALM-IMP-${randomUUID()}`,warehouseId:req.params.id,kind:"CORRECCION_IMPORTACION",quantities,actorId:actor.id,date:now };
    await db.query("INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",[movement.id,req.params.id,movement.kind,"MULTI",0,actor.id,now,movement]);
    const data=isRecord(found.rows[0].data)?{...found.rows[0].data,stock,updatedAt:now}:{id:req.params.id,stock,updatedAt:now};
    await db.query("UPDATE warehouses SET stock=$2,data=$3,updated_at=now() WHERE id=$1",[req.params.id,stock,data]);
    await db.query("COMMIT");
    res.json({stock});
  } catch(error) {
    await db.query("ROLLBACK").catch(()=>undefined);
    res.status(409).json({message:error instanceof Error?error.message:"No se pudo corregir el stock importado."});
  } finally { db.release(); }
});

router.post("/app-storage/warehouses/:id/recharge", async (req, res): Promise<void> => {
  const actor = await authorizedWarehouseActor(req);
  if (!actor) return void res.status(403).json({ message: "Solo Admin o Analista puede cargar stock." });
  const quantities = isRecord(req.body?.quantities) ? req.body.quantities : {};
  const initial = req.body?.initial === true;
  const allowed = ["PANETON_900G","PANETON_85G","AVENA","BATEA","MANDIL","SPAGHETTI"];
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query("SELECT stock,data FROM warehouses WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!found.rows[0]) throw new Error("El almacén no existe.");
    const stock = isRecord(found.rows[0].stock) ? { ...found.rows[0].stock } : {};
    if (initial && Object.values(stock).some((quantity) => Number(quantity) > 0)) throw new Error("El almacén ya tiene stock inicial.");
    const now = new Date().toISOString();
    let added = 0;
    for (const itemId of allowed) {
      const quantity = Math.floor(Math.max(0, Number(quantities[itemId]) || 0));
      if (!quantity) continue;
      stock[itemId] = Math.max(0, Number(stock[itemId]) || 0) + quantity;
      const kind = initial ? "CARGA_INICIAL" : "RECARGA";
      const movement = { id: `ALM-${initial ? "INI" : "REC"}-${randomUUID()}`, warehouseId:req.params.id, kind, itemId, quantity, actorId:actor.id, date:now };
      await db.query("INSERT INTO warehouse_movements(id,warehouse_id,kind,item_id,quantity,actor_id,movement_date,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [movement.id,req.params.id,kind,itemId,quantity,actor.id,now,movement]);
      added += quantity;
    }
    if (!added) throw new Error("Ingresa al menos una cantidad mayor a cero.");
    const data = isRecord(found.rows[0].data) ? { ...found.rows[0].data, stock, updatedAt:now } : { id:req.params.id,stock,updatedAt:now };
    await db.query("UPDATE warehouses SET stock=$2,data=$3,updated_at=now() WHERE id=$1", [req.params.id,stock,data]);
    await db.query("COMMIT");
    res.json({ stock });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    res.status(409).json({ message: error instanceof Error ? error.message : "No se pudo cargar el stock." });
  } finally { db.release(); }
});

async function validateTradeSale(
  db: QueryClient,
  sale: StoredRecord,
) {
  if (value(sale, "mode") !== "PLANCHAS" || numeric(sale, "planchas") <= 80)
    throw new Error("La solicitud debe corresponder a una venta mayor a 80 planchas.");

  requireFinalClientForCanje(sale);

  const promoterId = value(sale, "promoterId");
  const marketId = value(sale, "marketId");
  const clientId = value(sale, "clientId");
  if (!promoterId || !marketId || !clientId)
    throw new Error("La solicitud requiere Promotor, Mercado y Cliente.");

  const promoterResult = await db.query(
    "SELECT id,dni,role,status,data FROM users WHERE id=$1 LIMIT 1",
    [promoterId],
  );
  const promoter = promoterResult.rows[0];
  const promoterData = isRecord(promoter?.data) ? promoter.data : {};
  const promoterRole = String(promoter?.role || value(promoterData, "role") || "");
  if (
    !promoter ||
    promoter.status !== "ACTIVO" ||
    !["PROMOTOR", "PROMOTOR ROTATIVO", "PROMOTOR PERMANENTE"].includes(promoterRole)
  )
    throw new Error("El promotor de la solicitud no existe o no está activo.");

  const market = await db.query(
    "SELECT id FROM markets WHERE id=$1 AND status='ACTIVO' LIMIT 1",
    [marketId],
  );
  if (!market.rows.length)
    throw new Error("El Mercado de la solicitud no existe o está inactivo.");

  const client = await db.query(
    "SELECT id FROM clients WHERE id=$1 AND market_id=$2 AND status='ACTIVO' LIMIT 1",
    [clientId, marketId],
  );
  if (!client.rows.length)
    throw new Error("El Cliente no pertenece al Mercado o está inactivo.");

  const assignment = await db.query(
    "SELECT market_ids,client_ids FROM assignments WHERE promoter_id=$1 LIMIT 1",
    [promoterId],
  );
  const coverage = assignment.rows[0];
  const allowedMarkets = coverage
    ? Array.isArray(coverage.market_ids) ? coverage.market_ids.map(String) : []
    : value(promoterData, "marketId")
      ? [value(promoterData, "marketId")]
      : [];
  const allowedClients = coverage && Array.isArray(coverage.client_ids)
    ? coverage.client_ids.map(String)
    : [];

  if (!allowedMarkets.includes(marketId))
    throw new Error("El Mercado no está asignado al promotor.");
  if (coverage && !allowedClients.includes(clientId))
    throw new Error("El Cliente no está asignado al promotor.");

  const drafts = saleItemDrafts(sale);
  if (!drafts.length)
    throw new Error("La venta Trade no contiene SKU válidos de Marcas.");
  const skuList = [...new Set(drafts.map((line) => line.sku))];
  const catalog = await db.query(
    "SELECT sku,data FROM product_prices WHERE sku = ANY($1::text[])",
    [skuList],
  );
  const catalogBySku = new Map(
    catalog.rows.map((row) => [
      String(row.sku),
      String(isRecord(row.data) ? row.data.status || "ACTIVO" : "ACTIVO"),
    ]),
  );
  const invalidSku = skuList.find(
    (sku) => !catalogBySku.has(sku) || catalogBySku.get(sku) === "INACTIVO",
  );
  if (invalidSku)
    throw new Error(`SKU no disponible en Marcas: ${invalidSku}.`);

  const saleId = value(sale, "id");
  if (!saleId || !saleId.startsWith("VTA-"))
    throw new Error("Código de venta Trade no válido.");

  return { promoter, promoterData, promoterId, marketId, clientId, saleId };
}

router.get("/app-storage/trade-approvals", async (_req, res): Promise<void> => {
  try {
    const result = await pool.query(
      "SELECT data,status,requested_at,resolved_at,resolved_by,resolution_comment FROM trade_approvals ORDER BY requested_at DESC,created_at DESC",
    );
    res.json({
      approvals: result.rows.map((row) => ({
        ...(isRecord(row.data) ? row.data : {}),
        status: row.status,
        requestedAt: row.requested_at,
        resolvedAt: row.resolved_at,
        resolvedBy: row.resolved_by,
        resolutionComment: row.resolution_comment,
      })),
    });
  } catch {
    res.status(500).json({ message: "No se pudieron leer las aprobaciones Trade." });
  }
});

router.post("/app-storage/trade-approvals", async (req, res): Promise<void> => {
  const sale = isRecord(req.body?.sale) ? req.body.sale : null;
  if (!sale) {
    res.status(400).json({ message: "Solicitud Trade no válida." });
    return;
  }

  const id = value(req.body as StoredRecord, "id") || `TRD-${randomUUID()}`;
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const validated = await validateTradeSale(db as unknown as QueryClient, sale);

    const existingSale = await db.query(
      "SELECT id FROM sales WHERE id=$1 LIMIT 1",
      [validated.saleId],
    );
    if (existingSale.rows.length)
      throw new Error("La venta ya existe y no puede solicitar aprobación nuevamente.");

    const existingApproval = await db.query(
      `SELECT id,status
         FROM trade_approvals
        WHERE id=$1
           OR data->'sale'->>'id'=$2
        LIMIT 1
        FOR UPDATE`,
      [id, validated.saleId],
    );
    if (existingApproval.rows.length)
      throw new Error("Ya existe una solicitud Trade para esta venta.");

    const requestedAt = new Date().toISOString();
    const approval = {
      id,
      promoterId: validated.promoterId,
      promoterName:
        value(validated.promoterData, "name") || value(sale, "promoterName"),
      promoterRole:
        value(validated.promoterData, "role") ||
        String(validated.promoter.role || ""),
      promoterRoleLabel:
        value(validated.promoterData, "roleLabel") ||
        value(validated.promoterData, "role") ||
        String(validated.promoter.role || ""),
      clientId: validated.clientId,
      finalClientName: value(sale, "finalClientName") || undefined,
      marketId: validated.marketId,
      sale: {
        ...sale,
        promoterId: validated.promoterId,
        clientId: validated.clientId,
        marketId: validated.marketId,
        status: "PENDIENTE_APROBACION_TRADE",
      },
      status: "PENDIENTE",
      requestedAt,
    };
    await db.query(
      `INSERT INTO trade_approvals
        (id,promoter_id,client_id,market_id,status,requested_at,data)
       VALUES ($1,$2,$3,$4,'PENDIENTE',$5,$6)`,
      [id, validated.promoterId, validated.clientId, validated.marketId, requestedAt, approval],
    );
    await db.query("COMMIT");
    res.status(201).json({ approval });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to create Trade approval");
    res.status(409).json({
      message: error instanceof Error ? error.message : "No se pudo guardar la solicitud Trade.",
    });
  } finally {
    db.release();
  }
});

router.post("/app-storage/trade-approvals/:id/resolve", async (req, res): Promise<void> => {
  const actor = await authorizedTradeActor(req);
  if (!actor) {
    res.status(403).json({ message: "Se requiere un usuario Admin o Analista autorizado." });
    return;
  }
  const decision = String(req.body?.decision || "").toUpperCase();
  if (!["APROBADA", "RECHAZADA"].includes(decision)) {
    res.status(400).json({ message: "Decisión no válida." });
    return;
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const found = await db.query("SELECT * FROM trade_approvals WHERE id=$1 FOR UPDATE", [req.params.id]);
    if (!found.rows[0]) throw new Error("La solicitud no existe.");
    if (found.rows[0].status !== "PENDIENTE") throw new Error("La solicitud ya fue resuelta.");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
      [`trade-approval:${req.params.id}`],
    );
    await lockInventoryLedger(db as unknown as QueryClient);
    const approvalData = isRecord(found.rows[0].data) ? found.rows[0].data : {};
    const sale = isRecord(approvalData.sale) ? approvalData.sale : null;
    if (!sale) throw new Error("La solicitud no contiene la venta.");
    const resolvedAt = new Date().toISOString();
    if (decision === "APROBADA") {
      const validated = await validateTradeSale(db as unknown as QueryClient, sale);
      const existingSale = await db.query(
        "SELECT id FROM sales WHERE id=$1 LIMIT 1",
        [validated.saleId],
      );
      if (existingSale.rows.length)
        throw new Error("La venta de esta solicitud ya fue registrada.");
      const requirementsToConsume = isRecord(sale.redemptionItems) ? sale.redemptionItems : {};
      const approvedSale = {
        ...sale,
        status: "PENDIENTE",
        tradeApprovalId: String(req.params.id),
        tradeApprovedAt: resolvedAt,
        tradeApprovedBy: actor.id,
        updatedAt: resolvedAt,
      };
      await upsertRecord(db as unknown as QueryClient, "sales", approvedSale);
      const requirements = requirementsToConsume;
      for (const itemId of redemptionItemIds) {
        const quantity = Math.max(0, Number(requirements[itemId]) || 0);
        if (!quantity) continue;
        await upsertRecord(db as unknown as QueryClient, "movements", {
          id: `CAN-${value(approvedSale, "id")}-${itemId}`,
          marketId: value(approvedSale, "marketId"),
          kind: "CANJE",
          itemId,
          quantity,
          actorId: value(approvedSale, "promoterId"),
          actorName: value(approvalData, "promoterName"),
          promoterId: value(approvedSale, "promoterId"),
          date: resolvedAt,
          status: "PENDIENTE",
        });
      }
      await applyWarehouseStockMovement(
        db as unknown as QueryClient,
        value(approvedSale, "marketId"),
        requirements,
        "CANJE",
        String(actor.id),
        `SALE:${value(approvedSale, "id")}`,
      );
    }
    const nextData = {
      ...approvalData,
      status: decision,
      resolvedAt,
      resolvedBy: actor.id,
      resolvedByName: value(actor.data, "name"),
      resolutionComment: String(req.body?.comment || "").trim() || undefined,
    };
    await db.query(
      `UPDATE trade_approvals SET status=$2,resolved_at=$3,resolved_by=$4,resolution_comment=$5,data=$6,updated_at=now() WHERE id=$1`,
      [req.params.id, decision, resolvedAt, actor.id, nextData.resolutionComment || null, nextData],
    );
    await db.query("COMMIT");
    res.json({ approval: nextData, snapshot: decision === "APROBADA" ? await readSnapshot() : undefined });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    res.status(409).json({ message: error instanceof Error ? error.message : "No se pudo resolver la solicitud." });
  } finally {
    db.release();
  }
});

router.get("/app-storage", async (req, res): Promise<void> => {
  try {
    res.json({
      storage: "digitalocean-postgresql",
      stockSource: "warehouses",
      catalogRevision: await readCatalogRevision(),
      snapshot: await readSnapshot(),
    });
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
    const incomingRevision =
      typeof req.body?.catalogRevision === "string"
        ? req.body.catalogRevision
        : null;
    const snapshot = await syncSnapshot(
      incoming as Partial<StorageSnapshot>,
      incomingRevision,
    );
    res.json({
      storage: "digitalocean-postgresql",
      syncedAt: new Date().toISOString(),
      catalogRevision: await readCatalogRevision(),
      snapshot,
    });
  } catch (error) {
    req.log.error({ err: error }, "Unable to sync app storage");
    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : "No se pudo sincronizar PostgreSQL.",
    });
  }
});

router.get("/app-storage/assignments", async (req, res): Promise<void> => {
  try {
    const { assignments } = await readSnapshot();
    res.json({ storage: "digitalocean-postgresql", assignments });
  } catch (error) {
    req.log.error({ err: error }, "Unable to read assignments");
    res.status(500).json({ message: "No se pudieron leer las asignaciones." });
  }
});

router.post("/app-storage/assignments", async (req, res): Promise<void> => {
  const actor = await authorizedTradeActor(req);
  if (!actor) {
    res.status(403).json({
      message: "Solo Admin o Analista puede modificar asignaciones.",
    });
    return;
  }
  const assignment = isRecord(req.body?.assignment) ? req.body.assignment : {};
  const promoterId = value(assignment, "promoterId");
  const marketIds = Array.isArray(assignment.marketIds)
    ? [...new Set(assignment.marketIds.map((item: unknown) => String(item).trim()).filter(Boolean))]
    : [];
  const clientIds = Array.isArray(assignment.clientIds)
    ? [...new Set(assignment.clientIds.map((item: unknown) => String(item).trim()).filter(Boolean))]
    : [];
  if (!promoterId) {
    res.status(400).json({ message: "La asignación requiere promoterId." });
    return;
  }

  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const promoterResult = await db.query(
      "SELECT id,dni,role,status,data FROM users WHERE id=$1 FOR UPDATE",
      [promoterId],
    );
    const promoter = promoterResult.rows[0];
    const role = String(promoter?.role || promoter?.data?.role || "");
    if (
      !promoter ||
      promoter.status !== "ACTIVO" ||
      !["PROMOTOR", "PROMOTOR ROTATIVO", "PROMOTOR PERMANENTE", "COORDINADOR"].includes(role)
    )
      throw new Error("Selecciona un Promotor o Coordinador activo.");

    if (marketIds.length) {
      const marketResult = await db.query(
        "SELECT id FROM markets WHERE id = ANY($1::text[]) AND status='ACTIVO'",
        [marketIds],
      );
      if (marketResult.rows.length !== marketIds.length)
        throw new Error("Una o más asignaciones apuntan a Mercados inactivos o inexistentes.");
    }
    if (!marketIds.length && clientIds.length)
      throw new Error("No puedes asignar Clientes sin asignar al menos un Mercado.");

    if (clientIds.length) {
      const clientResult = await db.query(
        "SELECT id,market_id FROM clients WHERE id = ANY($1::text[]) AND status='ACTIVO'",
        [clientIds],
      );
      if (clientResult.rows.length !== clientIds.length)
        throw new Error("Uno o más Clientes están inactivos o no existen.");
      const invalidClient = clientResult.rows.find(
        (row) => !marketIds.includes(String(row.market_id)),
      );
      if (invalidClient)
        throw new Error("Todos los Clientes asignados deben pertenecer a los Mercados seleccionados.");
    }

    const updatedAt = new Date().toISOString();
    const normalized = {
      promoterId,
      promoterDni: String(promoter.dni || ""),
      marketIds,
      clientIds,
      updatedAt,
    };
    await db.query(
      `INSERT INTO assignments
        (promoter_id,promoter_dni,market_ids,client_ids,data,record_updated_at)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(promoter_id) DO UPDATE SET
         promoter_dni=EXCLUDED.promoter_dni,
         market_ids=EXCLUDED.market_ids,
         client_ids=EXCLUDED.client_ids,
         data=EXCLUDED.data,
         record_updated_at=EXCLUDED.record_updated_at,
         updated_at=now()`,
      [promoterId, normalized.promoterDni, marketIds, clientIds, normalized, updatedAt],
    );

    const currentData = isRecord(promoter.data) ? promoter.data : {};
    const nextUserData = { ...currentData, updatedAt };
    if (marketIds.length) nextUserData.marketId = marketIds[0];
    else delete nextUserData.marketId;
    await db.query(
      "UPDATE users SET data=$2,record_updated_at=$3,updated_at=now() WHERE id=$1",
      [promoterId, nextUserData, updatedAt],
    );

    await db.query("COMMIT");
    const snapshot = await readSnapshot();
    res.json({
      storage: "digitalocean-postgresql",
      assignment: normalized,
      assignments: snapshot.assignments,
      snapshot,
    });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to save assignment");
    res.status(409).json({
      message: error instanceof Error ? error.message : "No se pudo guardar la asignación.",
    });
  } finally {
    db.release();
  }
});

router.post(
  "/app-storage/admin/users/sync",
  async (req, res): Promise<void> => {
    const actor = await authorizedTradeActor(req);
    if (!actor) {
      res.status(403).json({
        message: "Solo Admin o Analista pueden importar o sincronizar usuarios.",
      });
      return;
    }
    const users = req.body?.users;
    if (
      !Array.isArray(users) ||
      !users.length ||
      users.some(
        (user) => !isRecord(user) || !/^\d{8}$/.test(value(user, "dni")),
      )
    ) {
      res.status(400).json({
        message: "El archivo debe contener usuarios válidos con DNI de 8 dígitos.",
      });
      return;
    }
    const dnis = users.map((user) => value(user, "dni"));
    if (new Set(dnis).size !== dnis.length) {
      res.status(400).json({
        message:
          "El archivo contiene DNI repetidos. No se actualizó ningún usuario.",
      });
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
        res.status(409).json({
          message: "La información cambió. Vuelve a cargar el archivo.",
        });
        return;
      }
      for (const user of users) {
        await upsertRecord(client as unknown as QueryClient, "users", {
          ...user,
          catalogArchived: false,
        });
      }
      const archivedAt = new Date().toISOString();
      await client.query(
        `UPDATE users
       SET status='INACTIVO',
           data=(data - 'sheetArchived' - 'sheetArchivedAt') ||
                jsonb_build_object('status','INACTIVO','catalogArchived',true,'catalogArchivedAt',$2::text),
           record_updated_at=$2,
           updated_at=now()
       WHERE NOT (dni = ANY($1::text[]))`,
        [dnis, archivedAt],
      );
      await client.query("COMMIT");
      res.json({ synced: dnis.length, snapshot: await readSnapshot() });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      req.log.error(
        { err: error },
        "Unable to synchronize authoritative users",
      );
      res
        .status(500)
        .json({ message: "No se pudo sincronizar el archivo de Promotores." });
    } finally {
      client.release();
    }
  },
);

// Administrative record corrections keep stable IDs. Legacy movement edits never mutate operational stock.
router.all(
  "/app-storage/admin/records/:collection/:id",
  async (req, res): Promise<void> => {
    const name = String(req.params.collection) as CollectionName;
    const id = String(req.params.id);
    if (
      !["markets", "users", "attendance", "movements"].includes(name) ||
      !["PUT", "DELETE"].includes(req.method)
    ) {
      res.status(400).json({ message: "Operación no válida." });
      return;
    }
    const actor = await authorizedTradeActor(req);
    if (!actor) {
      res.status(403).json({
        message: "Solo Admin o Analista pueden editar o eliminar registros.",
      });
      return;
    }
    if (
      name === "users" &&
      id === actor.id &&
      (req.method === "DELETE" || req.body?.record?.status === "INACTIVO")
    ) {
      res
        .status(409)
        .json({ message: "No puedes eliminar o desactivar tu propia sesión." });
      return;
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await lockInventoryLedger(db as unknown as QueryClient);
      const table = collectionConfig[name].table;
      const result = await db.query(
        `SELECT data FROM ${table} WHERE id=$1 FOR UPDATE`,
        [id],
      );
      if (!result.rows[0])
        throw new Error("El registro ya no existe. Actualiza la pantalla.");
      const old = result.rows[0].data as StoredRecord;
      const input = isRecord(req.body?.record) ? req.body.record : {};
      const deleting = req.method === "DELETE";
      const fields: Record<string, string[]> = {
        markets: [
          "name",
          "region",
          "department",
          "province",
          "district",
          "warehouseId",
          "status",
        ],
        users: [
          "dni",
          "name",
          "role",
          "roleLabel",
          "marketId",
          "clientId",
          "status",
          "password",
        ],
        attendance: [
          "promoterId",
          "clientId",
          "marketId",
          "type",
          "date",
          "photo",
        ],
        movements: [
          "promoterId",
          "actorId",
          "actorName",
          "marketId",
          "quantity",
          "date",
          "itemId",
          "canjeProductId",
          "canjeProductLabel",
          "canjeComponents",
          "degustacionProductId",
          "degustacionProductLabel",
        ],
      };
      const next: StoredRecord = {
        ...old,
        ...Object.fromEntries(
          fields[name]
            .filter((key) => key in input)
            .map((key) => [key, input[key]]),
        ),
        id,
        updatedAt: new Date().toISOString(),
      };
      const required = (keys: string[]) => {
        if (keys.some((key) => !value(next, key).trim()))
          throw new Error("Completa todos los campos obligatorios.");
      };
      if (!deleting) {
        if (name === "markets") {
          required(["name", "department", "province", "district"]);
          if (value(next, "warehouseId")) {
            const warehouse = await db.query(
              "SELECT id FROM warehouses WHERE id=$1 AND status='ACTIVO' LIMIT 1",
              [next.warehouseId],
            );
            if (!warehouse.rows.length)
              throw new Error("El almacén seleccionado no existe o está inactivo.");
          }
        }
        if (name === "users") {
          const nextRole = value(next, "role");
          if (
            ![
              "PROMOTOR",
              "PROMOTOR ROTATIVO",
              "PROMOTOR PERMANENTE",
              "COORDINADOR",
              "SUPERVISOR",
              "ANALISTA",
              "TRADE",
              "ADMIN",
              "CLIENTE",
            ].includes(nextRole)
          )
            throw new Error("Rol no válido.");
          required(["name", "role", "status"]);
          if (!/^\d{8}$/.test(value(next, "dni")))
            throw new Error("El DNI debe tener 8 dígitos.");
          const duplicateDni = await db.query(
            "SELECT id FROM users WHERE dni=$1 AND id<>$2 LIMIT 1",
            [next.dni, id],
          );
          if (duplicateDni.rows.length)
            throw new Error("Ya existe otro usuario con este DNI.");
          if (value(input, "password") && value(input, "password").length < 3)
            throw new Error("La clave debe tener al menos 3 caracteres.");
          if (!value(input, "password")) delete next.password;

          const needsMarket = [
            "PROMOTOR",
            "PROMOTOR ROTATIVO",
            "PROMOTOR PERMANENTE",
            "COORDINADOR",
          ].includes(nextRole);
          if (needsMarket) {
            required(["marketId"]);
            const marketExists = await db.query(
              "SELECT id FROM markets WHERE id=$1 AND status='ACTIVO' LIMIT 1",
              [next.marketId],
            );
            if (!marketExists.rows.length)
              throw new Error("Selecciona un Mercado activo para este usuario.");
            delete next.clientId;
          } else if (nextRole === "CLIENTE") {
            required(["clientId"]);
            const clientExists = await db.query(
              "SELECT id FROM clients WHERE id=$1 AND status='ACTIVO' LIMIT 1",
              [next.clientId],
            );
            if (!clientExists.rows.length)
              throw new Error("Selecciona un Cliente activo para esta cuenta.");
            delete next.marketId;
          } else {
            delete next.clientId;
            delete next.marketId;
          }
        }
        if (name === "attendance" || name === "movements") {
          if (!Number.isFinite(new Date(value(next, "date")).getTime()))
            throw new Error("Fecha no válida.");
          required(["marketId"]);
          if (
            !(
              await db.query("SELECT id FROM markets WHERE id=$1", [
                next.marketId,
              ])
            ).rows.length
          )
            throw new Error("El mercado no existe.");
        }
        if (name === "attendance") {
          required(["promoterId", "clientId", "photo"]);
          if (!["ENTRADA", "SALIDA"].includes(value(next, "type")))
            throw new Error("Evento no válido.");
          if (
            !(
              await db.query(
                "SELECT id FROM clients WHERE id=$1 AND market_id=$2",
                [next.clientId, next.marketId],
              )
            ).rows.length
          )
            throw new Error("El cliente no pertenece al mercado.");
          const promoter = await db.query(
            "SELECT data FROM users WHERE id=$1",
            [next.promoterId],
          );
          if (!promoter.rows.length) throw new Error("El promotor no existe.");
          next.promoterRole = promoter.rows[0].data.role;
          next.promoterRoleLabel =
            promoter.rows[0].data.roleLabel || next.promoterRole;
        }
      }
      if (
        name === "users" &&
        (deleting || next.role !== old.role || next.status === "INACTIVO")
      ) {
        if (["ADMIN", "ANALISTA"].includes(value(old, "role"))) {
          const others = await db.query(
            "SELECT id FROM users WHERE id<>$1 AND status='ACTIVO' AND data->>'role' IN ('ADMIN','ANALISTA')",
            [id],
          );
          if (!others.rows.length)
            throw new Error(
              "Debes conservar al menos un administrador o analista activo.",
            );
        }
      }
      if (name === "users" && deleting) {
        const relatedChecks = [
          ["sales", "promoter_id"],
          ["attendance", "promoter_id"],
          ["inventory_movements", "actor_id"],
          ["trade_approvals", "promoter_id"],
          ["warehouse_movements", "actor_id"],
        ] as const;
        for (const [relatedTable, relatedColumn] of relatedChecks) {
          const related = await db.query(
            `SELECT 1 FROM ${relatedTable} WHERE ${relatedColumn}=$1 LIMIT 1`,
            [id],
          );
          if (related.rows.length)
            throw new Error(
              "El usuario tiene historial operativo. Cámbialo a INACTIVO en lugar de eliminarlo.",
            );
        }
      }
      if (name === "markets" && deleting) {
        for (const related of [
          "clients",
          "sales",
          "attendance",
          "inventory_movements",
        ]) {
          if (
            (
              await db.query(
                `SELECT 1 FROM ${related} WHERE market_id=$1 LIMIT 1`,
                [id],
              )
            ).rows.length
          )
            throw new Error(
              "El mercado tiene registros relacionados. Reasígnalos antes de eliminarlo.",
            );
        }
      }
      if (name === "attendance") {
        const originalType = value(old, "type");
        const originalPromoterId = value(old, "promoterId");
        const originalMarketId = value(old, "marketId");
        const originalDate = value(old, "date");
        if (originalType === "SALIDA" && originalPromoterId && originalMarketId && originalDate) {
          const closure = await db.query(
            `SELECT id,tasting_used,data,closure_date
               FROM session_closures
              WHERE promoter_id=$1
                AND market_id=$2
                AND ABS(EXTRACT(EPOCH FROM (closure_date - $3::timestamptz))) <= 43200
              ORDER BY ABS(EXTRACT(EPOCH FROM (closure_date - $3::timestamptz)))
              LIMIT 1
              FOR UPDATE`,
            [originalPromoterId, originalMarketId, originalDate],
          );
          const linkedClosure = closure.rows[0];
          if (linkedClosure) {
            const relationshipChanged =
              !deleting &&
              (
                value(next, "promoterId") !== originalPromoterId ||
                value(next, "marketId") !== originalMarketId ||
                value(next, "clientId") !== value(old, "clientId") ||
                value(next, "type") !== originalType ||
                value(next, "date") !== originalDate
              );
            if (relationshipChanged)
              throw new Error(
                "Esta Salida ya tiene un cierre asociado. Solo puedes reemplazar la evidencia; para cambiar Promotor, Cliente, Mercado, tipo o fecha, regulariza primero el cierre.",
              );

            if (deleting) {
              const tastingUsed = Math.max(0, Number(linkedClosure.tasting_used) || 0);
              const tastingMovement = await db.query(
                `SELECT 1
                   FROM inventory_movements
                  WHERE kind='DEGUSTACION'
                    AND market_id=$1
                    AND COALESCE(data->>'promoterId',data->>'actorId','')=$2
                    AND ABS(EXTRACT(EPOCH FROM (movement_date - $3::timestamptz))) <= 60
                  LIMIT 1`,
                [originalMarketId, originalPromoterId, linkedClosure.closure_date],
              );
              if (tastingUsed > 0 || tastingMovement.rows.length)
                throw new Error(
                  "Esta Salida tiene Degustación asociada. Elimina o regulariza primero la Degustación para restaurar correctamente el stock.",
                );
              await db.query(
                "DELETE FROM session_closures WHERE id=$1",
                [linkedClosure.id],
              );
            }
          }
        }
      }
      if (name === "movements") {
        if (!deleting && !String(next.kind).includes("DEGUSTACION")) {
          if (!value(next, "itemId") && !isRecord(next.canjeComponents))
            throw new Error("Selecciona un producto de canje.");
          if (
            isRecord(next.canjeComponents) &&
            Object.entries(next.canjeComponents).some(
              ([key, qty]) =>
                !["AVENA", "SPAGHETTI", "BATEA", "MANDIL"].includes(key) ||
                !Number.isInteger(qty) ||
                Number(qty) < 0,
            )
          )
            throw new Error("Composición de canje inválida.");
        }
        if (
          !deleting &&
          (!Number.isInteger(Number(next.quantity)) ||
            Number(next.quantity) <= 0)
        )
          throw new Error("La cantidad debe ser un entero mayor que cero.");
        const saleId = saleIdFromCanjeMovement(old);
        if (saleId)
          throw new Error(
            "Este canje está asociado a una venta. Edítalo desde Ventas para mantener evidencias y stock de Almacén.",
          );
        // inventory_movements es histórico/eventos. El saldo operativo no se
        // recalcula aquí: cualquier consumo/restauración real ocurre en
        // warehouse_movements mediante la venta o cierre de sesión.
      }
      if (deleting) {
        await db.query(`DELETE FROM ${table} WHERE id=$1`, [id]);
        await db.query(
          "INSERT INTO app_storage_tombstones (collection,record_id,deleted_at) VALUES ($1,$2,now()) ON CONFLICT (collection,record_id) DO UPDATE SET deleted_at=now()",
          [name, id],
        );
        if (name === "users")
          await db.query("DELETE FROM assignments WHERE promoter_id=$1", [id]);
      } else if (name === "users") {
        const passwordHash = value(next, "password")
          ? await hashPassword(value(next, "password"))
          : null;
        delete next.password;
        await db.query(
          "UPDATE users SET dni=$2,name=$3,role=$4,status=$5,password_hash=COALESCE($6,password_hash),data=$7,record_updated_at=$8,updated_at=now() WHERE id=$1",
          [
            id,
            next.dni,
            next.name,
            next.role,
            next.status,
            passwordHash,
            next,
            next.updatedAt,
          ],
        );
        if (
          ["PROMOTOR", "PROMOTOR ROTATIVO", "PROMOTOR PERMANENTE", "COORDINADOR"].includes(
            value(next, "role"),
          )
        ) {
          await db.query(
            "UPDATE assignments SET promoter_dni=$2,updated_at=now() WHERE promoter_id=$1",
            [id, next.dni],
          );
        } else {
          await db.query("DELETE FROM assignments WHERE promoter_id=$1", [id]);
        }
      } else if (name === "attendance") {
        await db.query(
          "UPDATE attendance SET promoter_id=$2,client_id=$3,market_id=$4,event_type=$5,event_date=$6,photo=$7,data=$8,record_updated_at=$9,updated_at=now() WHERE id=$1",
          [
            id,
            next.promoterId,
            next.clientId,
            next.marketId,
            next.type,
            next.date,
            next.photo,
            next,
            next.updatedAt,
          ],
        );
      } else if (name === "movements") {
        await db.query(
          "UPDATE inventory_movements SET market_id=$2,item_id=$3,quantity=$4,actor_id=$5,movement_date=$6,data=$7,record_updated_at=$8,updated_at=now() WHERE id=$1",
          [
            id,
            next.marketId,
            next.itemId || null,
            next.quantity,
            next.actorId,
            next.date,
            next,
            next.updatedAt,
          ],
        );
      } else await upsertRecord(db as unknown as QueryClient, name, next);
      await db.query("COMMIT");
      res.json({ snapshot: await readSnapshot() });
    } catch (error) {
      await db.query("ROLLBACK");
      req.log.error({ err: error }, "Administrative correction failed");
      res.status(409).json({
        message:
          error instanceof Error && !("code" in error)
            ? error.message
            : "No se pudo guardar. Verifica duplicados y registros relacionados.",
      });
    } finally {
      db.release();
    }
  },
);

router.post("/app-storage/admin/markets", async (req, res): Promise<void> => {
  if (!(await authorizedCatalogActor(req))) {
    res.status(403).json({ message: "Solo Analista y Admin pueden crear mercados." });
    return;
  }
  const input = req.body?.market;
  if (
    !isRecord(input) ||
    !value(input, "name") ||
    !value(input, "department") ||
    !value(input, "province") ||
    !value(input, "district")
  ) {
    res.status(400).json({
      message:
        "El mercado requiere nombre, departamento, provincia y distrito.",
    });
    return;
  }
  const market: StoredRecord = {
    id: value(input, "id") || `MKT-${randomUUID()}`,
    name: value(input, "name").toUpperCase(),
    region:
      value(input, "region").toUpperCase() ||
      value(input, "department").toUpperCase(),
    department: value(input, "department").toUpperCase(),
    province: value(input, "province").toUpperCase(),
    district: value(input, "district").toUpperCase(),
    warehouseId: value(input, "warehouseId") || undefined,
    status: "ACTIVO",
    updatedAt: new Date().toISOString(),
  };
  try {
    if (value(market, "warehouseId")) {
      const warehouse = await pool.query(
        "SELECT id FROM warehouses WHERE id=$1 AND status='ACTIVO' LIMIT 1",
        [market.warehouseId],
      );
      if (!warehouse.rows.length) {
        res.status(400).json({ message: "El almacén seleccionado no existe o está inactivo." });
        return;
      }
    }
    await upsertRecord(pool as unknown as QueryClient, "markets", market);
    res.status(201).json({ market, snapshot: await readSnapshot() });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create market");
    res.status(500).json({ message: "No se pudo crear el mercado." });
  }
});

router.post("/app-storage/admin/users", async (req, res): Promise<void> => {
  if (!(await authorizedCatalogActor(req))) {
    res.status(403).json({
      message: "Solo Analista y Admin pueden crear usuarios.",
    });
    return;
  }
  const input = req.body?.user;
  const dni = isRecord(input) ? value(input, "dni") : "";
  const name = isRecord(input) ? value(input, "name") : "";
  const role = isRecord(input) ? value(input, "role") : "";
  const password = isRecord(input) ? value(input, "password") : "";
  const validRoles = new Set([
    "PROMOTOR",
    "PROMOTOR ROTATIVO",
    "PROMOTOR PERMANENTE",
    "COORDINADOR",
    "SUPERVISOR",
    "ANALISTA",
    "TRADE",
    "ADMIN",
    "CLIENTE",
  ]);
  if (
    !isRecord(input) ||
    !/^\d{8}$/.test(dni) ||
    !name ||
    !validRoles.has(role) ||
    password.length < 3
  ) {
    res.status(400).json({
      message:
        "Completa DNI de 8 dígitos, nombre, rol y una clave de al menos 3 caracteres.",
    });
    return;
  }
  const needsMarket = [
    "PROMOTOR",
    "PROMOTOR ROTATIVO",
    "PROMOTOR PERMANENTE",
    "COORDINADOR",
  ].includes(role);
  if (needsMarket && !value(input, "marketId")) {
    res.status(400).json({ message: "Selecciona un Mercado activo para este usuario." });
    return;
  }
  if (role === "CLIENTE" && !value(input, "clientId")) {
    res.status(400).json({ message: "Selecciona el cliente vinculado." });
    return;
  }
  try {
    if (needsMarket) {
      const marketExists = await pool.query(
        "SELECT id FROM markets WHERE id=$1 AND status='ACTIVO' LIMIT 1",
        [value(input, "marketId")],
      );
      if (!marketExists.rows.length) {
        res.status(400).json({ message: "Selecciona un Mercado activo para este usuario." });
        return;
      }
    }
    if (role === "CLIENTE") {
      const clientExists = await pool.query(
        "SELECT id FROM clients WHERE id=$1 AND status='ACTIVO' LIMIT 1",
        [value(input, "clientId")],
      );
      if (!clientExists.rows.length) {
        res.status(400).json({ message: "Selecciona un Cliente activo para esta cuenta." });
        return;
      }
    }
    const existing = await pool.query("SELECT id FROM users WHERE dni=$1", [
      dni,
    ]);
    if (existing.rows.length) {
      res.status(409).json({ message: "Ya existe un usuario con este DNI." });
      return;
    }
    const userRecord: StoredRecord = {
      ...input,
      id: value(input, "id") || `USR-${randomUUID()}`,
      dni,
      name,
      role,
      roleLabel: value(input, "roleLabel") || role,
      status: "ACTIVO",
      updatedAt: new Date().toISOString(),
    };
    await upsertRecord(pool as unknown as QueryClient, "users", userRecord);
    res.status(201).json({
      user: publicUser(userRecord),
      snapshot: await readSnapshot(),
    });
  } catch (error) {
    req.log.error({ err: error }, "Unable to create user");
    res.status(500).json({ message: "No se pudo crear el usuario." });
  }
});

router.delete(
  "/app-storage/admin/markets/:id",
  async (req, res): Promise<void> => {
    if (!(await authorizedCatalogActor(req))) {
      res.status(403).json({ message: "Solo Analista y Admin pueden eliminar mercados." });
      return;
    }
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ message: "El mercado es obligatorio." });
      return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await lockInventoryLedger(client as unknown as QueryClient);
      const exists = await client.query("SELECT id FROM markets WHERE id=$1 FOR UPDATE", [id]);
      if (!exists.rows.length) {
        await client.query("ROLLBACK");
        res.status(404).json({ message: "El mercado no existe." });
        return;
      }
      for (const related of ["clients", "sales", "attendance", "inventory_movements"]) {
        const found = await client.query(
          `SELECT 1 FROM ${related} WHERE market_id=$1 LIMIT 1`,
          [id],
        );
        if (found.rows.length) {
          await client.query("ROLLBACK");
          res.status(409).json({
            message:
              "El mercado tiene registros relacionados. Reasígnalos antes de eliminarlo para no perder información.",
          });
          return;
        }
      }
      await client.query("DELETE FROM inventory WHERE market_id=$1", [id]);
      await client.query("DELETE FROM markets WHERE id=$1", [id]);
      await client.query(
        "INSERT INTO app_storage_tombstones (collection,record_id,deleted_at) VALUES ('markets',$1,now()) ON CONFLICT (collection,record_id) DO UPDATE SET deleted_at=now()",
        [id],
      );
      await client.query("COMMIT");
      res.json({ deleted: id, snapshot: await readSnapshot() });
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      req.log.error({ err: error }, "Unable to delete market");
      res.status(500).json({ message: "No se pudo eliminar el mercado." });
    } finally {
      client.release();
    }
  },
);

router.post("/app-storage/admin/clients", async (req, res): Promise<void> => {
  if (!(await authorizedCatalogActor(req))) {
    res.status(403).json({ message: "Solo Analista y Admin pueden administrar clientes." });
    return;
  }
  const input = req.body?.client;
  const category = isRecord(input)
    ? value(input, "category").toUpperCase()
    : "";
  if (
    !isRecord(input) ||
    !value(input, "name") ||
    !value(input, "marketId") ||
    !category
  ) {
    res
      .status(400)
      .json({ message: "El cliente requiere nombre, mercado y categoría." });
    return;
  }
  const id = value(input, "id") || randomUUID();
  const code = value(input, "code") || `CLI-${id.slice(0, 8).toUpperCase()}`;
  const clientRecord: StoredRecord = {
    id,
    code,
    name: value(input, "name").trim(),
    phone: value(input, "phone") || undefined,
    category,
    marketId: value(input, "marketId"),
    status:
      value(input, "status").toUpperCase() === "INACTIVO"
        ? "INACTIVO"
        : "ACTIVO",
    updatedAt: new Date().toISOString(),
  };
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    const marketExists = await db.query(
      "SELECT id FROM markets WHERE id=$1 AND status='ACTIVO' LIMIT 1",
      [clientRecord.marketId],
    );
    if (!marketExists.rows.length)
      throw new Error("Selecciona un Mercado activo.");

    const categoryExists = await db.query(
      "SELECT id FROM client_categories WHERE id=$1 AND status='ACTIVO' LIMIT 1",
      [category],
    );
    if (!categoryExists.rows.length)
      throw new Error("Selecciona una categoría activa del catálogo.");

    const duplicateCode = await db.query(
      "SELECT id FROM clients WHERE UPPER(code)=UPPER($1) AND id<>$2 LIMIT 1",
      [code, id],
    );
    if (duplicateCode.rows.length)
      throw new Error("Ya existe otro cliente con este código.");

    await upsertRecord(db as unknown as QueryClient, "clients", clientRecord);
    await db.query("COMMIT");
    res
      .status(201)
      .json({ client: clientRecord, snapshot: await readSnapshot() });
  } catch (error) {
    await db.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to save client");
    res.status(409).json({
      message: error instanceof Error ? error.message : "No se pudo guardar el cliente.",
    });
  } finally {
    db.release();
  }
});

async function authorizedCatalogActor(req: Request) {
  const credentials = await pool.query(
    "SELECT id,role,data,password_hash,status FROM users WHERE dni=$1 LIMIT 1",
    [req.get("x-admin-dni") || ""],
  );
  const actor = credentials.rows[0];
  const actorData = isRecord(actor?.data) ? actor.data : {};
  const actorRole = String(actor?.role || value(actorData, "role") || "");
  if (
    !actor ||
    actor.status !== "ACTIVO" ||
    !["ADMIN", "ANALISTA"].includes(actorRole) ||
    !actor.password_hash ||
    !(await verifyPassword(req.get("x-admin-key") || "", actor.password_hash))
  )
    return null;
  return {
    id: String(actor.id),
    role: actorRole,
    data: actorData,
  };
}

router.post(
  "/app-storage/admin/catalog/:kind",
  async (req, res): Promise<void> => {
    if (!(await authorizedCatalogActor(req))) {
      res
        .status(403)
        .json({ message: "Solo Analista y Admin pueden modificar catálogos." });
      return;
    }
    const kind = String(req.params.kind || "");
    const input = req.body?.record;
    if (!isRecord(input) || !["products", "categories"].includes(kind)) {
      res.status(400).json({ message: "Catálogo no válido." });
      return;
    }
    const updatedAt = new Date().toISOString();
    try {
      if (kind === "categories") {
        const id = value(input, "id")
          .toUpperCase()
          .replace(/[^A-Z0-9_-]/g, "_");
        const name = value(input, "name").toUpperCase();
        if (!id || !name)
          throw new Error("La categoría requiere código y nombre.");
        const duplicateName = await pool.query(
          "SELECT id FROM client_categories WHERE UPPER(name)=UPPER($1) AND id<>$2 LIMIT 1",
          [name, id],
        );
        if (duplicateName.rows.length)
          throw new Error("Ya existe otra categoría con ese nombre.");
        const record = {
          id,
          name,
          status: value(input, "status") === "INACTIVO" ? "INACTIVO" : "ACTIVO",
          updatedAt,
        };
        await upsertRecord(
          pool as unknown as QueryClient,
          "categories",
          record,
        );
      } else {
        const sku = value(input, "sku").toUpperCase();
        const product = value(input, "product");
        const brand = value(input, "brand").toUpperCase();
        const weightKg = numeric(input, "weightKg");
        const unitPrice = Math.max(0, numeric(input, "unitPrice"));
        const saleModes = Array.isArray(input.saleModes)
          ? input.saleModes.filter((mode) =>
              ["UNIDADES", "PLANCHAS"].includes(String(mode)),
            )
          : [];
        if (!sku || !product || !brand || weightKg <= 0 || !saleModes.length)
          throw new Error(
            "El producto requiere SKU, nombre, marca, peso y al menos un tipo de venta.",
          );
        if (
          saleModes.includes("PLANCHAS") &&
          Math.floor(numeric(input, "unitsPerPlancha") || 0) <= 0
        )
          throw new Error(
            "Los productos habilitados para Planchas requieren Unidades por plancha mayor a cero.",
          );
        const presentationValue = value(input, "presentation").toUpperCase();
        const presentation = ["CAJA", "BOLSA", "LATA"].includes(presentationValue)
          ? presentationValue
          : "BOLSA";
        const unitMeasure = Math.max(
          1,
          Math.floor(numeric(input, "unitMeasure") || numeric(input, "unitsPerPackage") || 1),
        );
        const unitsPerPlancha = Math.max(
          1,
          Math.floor(numeric(input, "unitsPerPlancha") || 1),
        );
        const record = {
          sku,
          product,
          brand,
          presentation,
          unitMeasure,
          weightKg,
          saleModes,
          unitsPerPlancha,
          unitsPerPackage: unitMeasure,
          unitPrice,
          totalPrice: numeric(input, "totalPrice") || unitPrice * unitMeasure,
          status: value(input, "status") === "INACTIVO" ? "INACTIVO" : "ACTIVO",
          updatedAt,
        };
        await upsertRecord(
          pool as unknown as QueryClient,
          "productPrices",
          record,
        );
      }
      res.json({ snapshot: await readSnapshot() });
    } catch (error) {
      res.status(400).json({
        message:
          error instanceof Error
            ? error.message
            : "No se pudo guardar el catálogo.",
      });
    }
  },
);

router.delete(
  "/app-storage/admin/catalog/:kind/:id",
  async (req, res): Promise<void> => {
    if (!(await authorizedCatalogActor(req))) {
      res
        .status(403)
        .json({ message: "Solo Analista y Admin pueden modificar catálogos." });
      return;
    }
    const kind = String(req.params.kind || "");
    const id = String(req.params.id || "").trim();
    if (!id || !["products", "categories"].includes(kind)) {
      res.status(400).json({ message: "Catálogo no válido." });
      return;
    }
    try {
      if (kind === "categories") {
        const used = await pool.query(
          "SELECT 1 FROM clients WHERE data->>'category'=$1 LIMIT 1",
          [id],
        );
        if (used.rows.length) {
          const current = await pool.query(
            "SELECT data FROM client_categories WHERE id=$1",
            [id],
          );
          const record = {
            ...(current.rows[0]?.data || {}),
            id,
            status: "INACTIVO",
            updatedAt: new Date().toISOString(),
          };
          await upsertRecord(
            pool as unknown as QueryClient,
            "categories",
            record,
          );
        } else
          await pool.query("DELETE FROM client_categories WHERE id=$1", [id]);
      } else {
        const used = await pool.query(
          `SELECT 1
             FROM sale_items
            WHERE sku=$1
            LIMIT 1`,
          [id],
        );
        const legacyUsed = used.rows.length
          ? used
          : await pool.query(
              `SELECT 1
                 FROM sales
                WHERE data->'unitPrices' ? $1
                   OR EXISTS (
                     SELECT 1
                       FROM jsonb_array_elements(COALESCE(data->'planchaLines','[]'::jsonb)) line
                      WHERE line->>'sku'=$1
                   )
                LIMIT 1`,
              [id],
            );
        if (legacyUsed.rows.length) {
          const current = await pool.query(
            "SELECT data FROM product_prices WHERE sku=$1",
            [id],
          );
          const record = {
            ...(current.rows[0]?.data || {}),
            sku: id,
            status: "INACTIVO",
            updatedAt: new Date().toISOString(),
          };
          await upsertRecord(
            pool as unknown as QueryClient,
            "productPrices",
            record,
          );
        } else
          await pool.query("DELETE FROM product_prices WHERE sku=$1", [id]);
      }
      res.json({ snapshot: await readSnapshot() });
    } catch (error) {
      req.log.error({ err: error }, "Unable to delete catalog record");
      res
        .status(500)
        .json({ message: "No se pudo retirar el registro del catálogo." });
    }
  },
);

router.delete(
  "/app-storage/admin/clients/:id",
  async (req, res): Promise<void> => {
    if (!(await authorizedCatalogActor(req))) {
      res.status(403).json({ message: "Solo Analista y Admin pueden eliminar clientes." });
      return;
    }
    const id = String(req.params.id || "").trim();
    if (!id) {
      res.status(400).json({ message: "El cliente es obligatorio." });
      return;
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const found = await db.query(
        "SELECT id FROM clients WHERE id=$1 FOR UPDATE",
        [id],
      );
      if (!found.rows.length) {
        await db.query("ROLLBACK");
        res.status(404).json({ message: "El cliente no existe." });
        return;
      }

      const directRelations = [
        ["sales", "client_id"],
        ["attendance", "client_id"],
        ["trade_approvals", "client_id"],
        ["session_closures", "client_id"],
      ] as const;
      for (const [table, column] of directRelations) {
        const related = await db.query(
          `SELECT 1 FROM ${table} WHERE ${column}=$1 LIMIT 1`,
          [id],
        );
        if (related.rows.length)
          throw new Error(
            "El cliente tiene historial operativo. Cámbialo a INACTIVO en lugar de eliminarlo.",
          );
      }

      const linkedUser = await db.query(
        "SELECT 1 FROM users WHERE data->>'clientId'=$1 LIMIT 1",
        [id],
      );
      if (linkedUser.rows.length)
        throw new Error(
          "El cliente está vinculado a una cuenta de usuario. Desvincúlala antes de eliminarlo.",
        );

      const linkedAssignment = await db.query(
        "SELECT 1 FROM assignments WHERE $1 = ANY(client_ids) LIMIT 1",
        [id],
      );
      if (linkedAssignment.rows.length)
        throw new Error(
          "El cliente está incluido en una asignación. Retíralo de Asignaciones antes de eliminarlo.",
        );

      await db.query(
        "INSERT INTO app_storage_tombstones (collection,record_id,deleted_at) VALUES ('clients',$1,now()) ON CONFLICT (collection,record_id) DO UPDATE SET deleted_at=now()",
        [id],
      );
      await db.query("DELETE FROM clients WHERE id=$1", [id]);
      await db.query("COMMIT");
      res.json({ deleted: id, snapshot: await readSnapshot() });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      req.log.error({ err: error }, "Unable to delete client");
      res.status(409).json({
        message: error instanceof Error ? error.message : "No se pudo eliminar el cliente.",
      });
    } finally {
      db.release();
    }
  },
);

// Administrative sales use the promoter as owner and retain the authenticated creator.
router.post("/app-storage/admin/sales", async (req, res): Promise<void> => {
  const actor = await authorizedTradeActor(req);
  if (!actor) {
    res.status(403).json({
      message: "Solo Analista y Admin pueden registrar ventas de promotores.",
    });
    return;
  }
  const input = req.body?.sale;
  if (!isRecord(input)) {
    res.status(400).json({ message: "Venta no válida." });
    return;
  }
  try {
    requireFinalClientForCanje(input);
  } catch (error) {
    res.status(400).json({
      message:
        error instanceof Error
          ? error.message
          : "Nombre Cliente Final es obligatorio cuando existe canje.",
    });
    return;
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    if (
      !(await lockAndValidateCatalogRevision(
        db as unknown as QueryClient,
        req.get("x-catalog-revision") || null,
      ))
    )
      throw new Error("Actualiza la aplicación antes de registrar la venta.");
    const id = value(input, "id");
    if (!id.startsWith("VTA-")) throw new Error("Código de venta no válido.");
    await db.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `sale:${id}`,
    ]);
    await lockInventoryLedger(db as unknown as QueryClient);
    const existing = await db.query("SELECT data FROM sales WHERE id=$1", [id]);
    if (existing.rows.length) {
      if (existing.rows[0].data.createdById !== actor.id)
        throw new Error("El código de venta ya existe.");
      await db.query("COMMIT");
      res.json({ sale: existing.rows[0].data, snapshot: await readSnapshot() });
      return;
    }
    const promoterResult = await db.query(
      "SELECT data,status FROM users WHERE id=$1 FOR UPDATE",
      [value(input, "promoterId")],
    );
    const promoter = promoterResult.rows[0];
    if (
      !promoter ||
      promoter.status !== "ACTIVO" ||
      !["PROMOTOR", "PROMOTOR PERMANENTE", "PROMOTOR ROTATIVO"].includes(
        promoter.data.role,
      )
    )
      throw new Error("Selecciona un promotor activo.");
    const assigned = await db.query(
      "SELECT market_ids,client_ids FROM assignments WHERE promoter_id=$1 OR (promoter_dni=$2 AND promoter_dni <> '') ORDER BY (promoter_id=$1) DESC LIMIT 1",
      [value(input, "promoterId"), promoter.data.dni || ""],
    );
    const assignment = assigned.rows[0];
    const allowedMarkets = assignment
      ? assignment.market_ids
      : promoter.data.marketId
        ? [promoter.data.marketId]
        : [];
    if (
      !Array.isArray(allowedMarkets) ||
      !allowedMarkets.includes(value(input, "marketId")) ||
      (assignment &&
        (!Array.isArray(assignment.client_ids) ||
          !assignment.client_ids.includes(value(input, "clientId"))))
    )
      throw new Error(
        "El mercado o cliente no está asignado al promotor seleccionado.",
      );
    const customer = await db.query(
      "SELECT id FROM clients WHERE id=$1 AND market_id=$2 AND status='ACTIVO'",
      [value(input, "clientId"), value(input, "marketId")],
    );
    const market = await db.query(
      "SELECT data FROM markets WHERE id=$1 AND status='ACTIVO'",
      [value(input, "marketId")],
    );
    if (!customer.rows.length || !market.rows.length)
      throw new Error("Selecciona un cliente activo del mercado elegido.");
    const date = new Date(value(input, "date"));
    const units = Number(input.units);
    const planchas = Number(input.planchas);
    const mode = value(input, "mode");
    const inputPlanchaLines = Array.isArray(input.planchaLines)
      ? input.planchaLines.filter(isRecord)
      : [];
    const miniOnlyPlancha =
      inputPlanchaLines.length > 0 &&
      inputPlanchaLines.every((line) => miniHalfPlanchaSkus.has(value(line, "sku")));
    const miniEligibleUnits = inputPlanchaLines.reduce(
      (sum, line) =>
        sum +
        (miniHalfPlanchaSkus.has(value(line, "sku"))
          ? Math.max(0, Math.floor(numeric(line, "units")))
          : 0),
      0,
    );
    const validMiniHalfPlancha =
      mode === "PLANCHAS" &&
      miniOnlyPlancha &&
      miniEligibleUnits === 24 &&
      units === 24 &&
      planchas === 0.5;
    const validMiniFullPlancha =
      mode === "PLANCHAS" &&
      miniOnlyPlancha &&
      miniEligibleUnits === 48 &&
      units === 48 &&
      planchas === 1;
    if (!Number.isFinite(date.getTime()) || date.getTime() > Date.now())
      throw new Error("La fecha de venta no puede estar vacía ni ser futura.");
    if (
      !Number.isInteger(units) ||
      units < 1 ||
      !["UNIDADES", "PLANCHAS"].includes(mode) ||
      (mode === "UNIDADES" && units > 5)
    )
      throw new Error("En unidades puedes registrar de 1 a 5.");
    const mix = isRecord(input.mix) ? input.mix : {};
    const prices = isRecord(input.unitPrices) ? input.unitPrices : {};
    if (
      !Object.keys(mix).length ||
      Object.entries(mix).some(
        ([, n]) => !Number.isInteger(Number(n)) || Number(n) < 0,
      ) ||
      Object.values(mix).reduce((sum: number, n) => sum + Number(n), 0) !==
        units
    )
      throw new Error("El mix debe sumar las unidades de la venta.");
    if (
      mode === "PLANCHAS" &&
      !validMiniHalfPlancha &&
      !validMiniFullPlancha &&
      (!Number.isInteger(planchas) ||
        planchas < 1 ||
        planchas > 80 ||
        units !== planchas * 6)
    )
      throw new Error(
        "La cantidad no corresponde a la plancha. En minis de 80/85 g se permiten 24 und (1/2 plancha) o 48 und (1 plancha).",
      );
    const amount =
      mode === "PLANCHAS"
        ? Object.entries(mix).reduce(
            (sum, [brand, n]) => sum + Number(n) * Number(prices[brand] || 0),
            0,
          )
        : units * Number(Object.values(prices)[0]);
    if (
      !(amount > 0) ||
      !Number.isFinite(amount) ||
      Math.abs(amount - Number(input.amountSoles)) > 0.01 ||
      (mode === "PLANCHAS" &&
        Object.entries(mix).some(
          ([brand, n]) => Number(n) > 0 && !(Number(prices[brand]) > 0),
        ))
    )
      throw new Error("Verifica los precios unitarios y el total.");
    const photoValid = (photo: string) => /^(https:\/\/|\/api\/)/.test(photo);
    const bonus = value(input, "bonus");
    if (
      !photoValid(value(input, "receiptPhoto")) ||
      (bonus && !photoValid(value(input, "exchangePhoto")))
    )
      throw new Error("Primero sube las fotografías de boleta y canje.");
    const count = Number(input.redemptionCount || 0);
    if (
      (bonus && (!Number.isInteger(count) || count < 1 || count > 3)) ||
      (!bonus && count !== 0) ||
      (mode === "UNIDADES" && count !== Math.floor(units / 2)) ||
      (count === 3 && !value(input, "comment"))
    )
      throw new Error("Número de canjes o justificación no válido.");
    const requestedSource = isRecord(input.redemptionItems)
      ? input.redemptionItems
      : {};
    const requested = Object.fromEntries(
      redemptionItemIds.map((item) => [
        item,
        Number(requestedSource[item] || 0),
      ]),
    );
    if (
      Object.values(requested).some((n) => !Number.isInteger(n) || n < 0) ||
      (!bonus && Object.values(requested).some((n) => n > 0)) ||
      (bonus && !Object.values(requested).some((n) => n > 0))
    )
      throw new Error("Los componentes del canje no son válidos.");
    if (
      mode === "UNIDADES" &&
      (requested.AVENA !== count ||
        requested.BATEA ||
        requested.MANDIL ||
        requested.SPAGHETTI)
    )
      throw new Error("En unidades corresponde una avena cada 2 unidades.");
    if (mode === "PLANCHAS") {
      const month = Number(
        new Intl.DateTimeFormat("en-US", {
          timeZone: "America/Lima",
          month: "numeric",
        }).format(date),
      );
      if (validMiniHalfPlancha) {
        if (
          !bonus ||
          count !== 1 ||
          requested.AVENA !== 2 ||
          requested.SPAGHETTI ||
          requested.MANDIL ||
          requested.BATEA
        )
          throw new Error(
            "Para 24 unidades de minis corresponde 2 Avena Clásica.",
          );
      } else {
        const eligible =
          planchas === 10 ||
          ([9, 10, 11, 12].includes(month) && [1, 4].includes(planchas));
        if (Boolean(bonus) !== eligible)
          throw new Error(
            "El canje no corresponde a las planchas y fecha elegidas.",
          );
        if (bonus) {
          const avena = planchas === 1 ? 3 : planchas === 4 ? 12 : 24;
          const spaghetti = planchas === 1 ? 1 : planchas === 4 ? 3 : 10;
          const accessory = requested.MANDIL || requested.BATEA;
          if (
            requested.AVENA !== avena * count ||
            requested.SPAGHETTI !== spaghetti * count ||
            (accessory && (planchas !== 10 || accessory !== count)) ||
            (requested.MANDIL && ![9, 10].includes(month)) ||
            (requested.BATEA && month !== 11)
          )
            throw new Error(
              "Los items del canje no corresponden a esta dinámica.",
            );
        }
      }
    }
    await applyWarehouseStockMovement(
      db as unknown as QueryClient,
      value(input, "marketId"),
      requested,
      "CANJE",
      String(actor.id),
      `SALE:${id}`,
    );
    const updatedAt = new Date().toISOString();
    const sale = {
      ...input,
      amountSoles: amount,
      date: date.toISOString(),
      updatedAt,
      promoterRole: promoter.data.role,
      promoterRoleLabel: promoter.data.roleLabel || promoter.data.role,
      createdById: actor.id,
      createdByRole: actor.role,
      administrative: true,
      status: "SINCRONIZADA",
    };
    await upsertRecord(db as unknown as QueryClient, "sales", sale);
    for (const item of redemptionItemIds) {
      if (!requested[item]) continue;
      await upsertRecord(db as unknown as QueryClient, "movements", {
        id: `CAN-${id}-${item}`,
        marketId: input.marketId,
        kind: "CANJE",
        itemId: item,
        quantity: requested[item],
        actorId: actor.id,
        actorName: actor.data.name,
        promoterId: input.promoterId,
        date: date.toISOString(),
        updatedAt,
        status: "SINCRONIZADA",
      });
    }
    await db.query("COMMIT");
    res.status(201).json({ sale, snapshot: await readSnapshot() });
  } catch (error) {
    await db.query("ROLLBACK");
    req.log.error({ err: error }, "Unable to create administrative sale");
    res.status(400).json({
      message:
        error instanceof Error ? error.message : "No se pudo guardar la venta.",
    });
  } finally {
    db.release();
  }
});

router.put("/app-storage/admin/sales/:id", async (req, res): Promise<void> => {
  const actor = await authorizedTradeActor(req);
  if (!actor) {
    res.status(403).json({
      message: "Solo Analista y Admin pueden editar ventas.",
    });
    return;
  }
  const id = String(req.params.id || "").trim();
  const input = req.body?.sale;
  const amountSoles = isRecord(input) ? Number(input.amountSoles) : Number.NaN;
  const saleDate = isRecord(input)
    ? new Date(value(input, "date"))
    : new Date(Number.NaN);
  if (
    !id ||
    !isRecord(input) ||
    !value(input, "clientId") ||
    !Number.isFinite(amountSoles) ||
    amountSoles <= 0 ||
    Number.isNaN(saleDate.getTime())
  ) {
    res.status(400).json({
      message:
        "La venta requiere cliente, fecha válida e importe mayor a cero.",
    });
    return;
  }
  try {
    requireFinalClientForCanje(input);
  } catch (error) {
    res.status(400).json({
      message:
        error instanceof Error
          ? error.message
          : "Nombre Cliente Final es obligatorio cuando existe canje.",
    });
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
      res.status(409).json({
        message:
          "La información cambió. Actualiza la aplicación antes de editar nuevamente.",
      });
      return;
    }
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `sale:${id}`,
    ]);
    const existing = (await client.query(
      "SELECT promoter_id,market_id,data FROM sales WHERE id=$1 FOR UPDATE",
      [id],
    )) as unknown as {
      rows: Array<{
        promoter_id: string;
        market_id: string;
        data: StoredRecord;
      }>;
    };
    if (!existing.rows[0]) {
      await client.query("ROLLBACK");
      res.status(404).json({ message: "La venta no existe." });
      return;
    }
    const currentSale = existing.rows[0];
    const saleMode = value(currentSale.data, "mode");
    const salePlanchas = Math.max(0, Math.floor(numeric(currentSale.data, "planchas")));
    const requestedAccessoryRaw = value(input, "planchaAccessory");
    const requestedAccessory =
      requestedAccessoryRaw === "MANDIL" ||
      requestedAccessoryRaw === "BATEA" ||
      requestedAccessoryRaw === "NINGUNO"
        ? requestedAccessoryRaw
        : saleMode === "PLANCHAS"
          ? value(currentSale.data, "planchaAccessory") || "NINGUNO"
          : "";
    const requestedMultiplier =
      saleMode === "PLANCHAS"
        ? Math.max(
            1,
            Math.min(
              4,
              Math.floor(
                numeric(input, "planchaMultiplier") ||
                  numeric(currentSale.data, "planchaMultiplier") ||
                  1,
              ),
            ),
          )
        : 1;
    if (saleMode === "PLANCHAS" && salePlanchas < 80 && requestedMultiplier !== 1) {
      await client.query("ROLLBACK");
      res.status(400).json({
        message: "El multiplicador solo puede ser mayor a x1 desde 80 planchas.",
      });
      return;
    }
    const movementPrefix = `CAN-${id}-`;
    const itemIds = ["AVENA", "SPAGHETTI", "BATEA", "MANDIL"];
    const requestedSource = isRecord(input.redemptionItems)
      ? input.redemptionItems
      : {};
    const requested = Object.fromEntries(
      ["AVENA", "SPAGHETTI", "BATEA", "MANDIL"].map((itemId) => [
        itemId,
        Math.max(0, Math.floor(Number(requestedSource[itemId]) || 0)),
      ]),
    );
    await restoreWarehouseStockMovements(client as unknown as QueryClient, `SALE:${id}`, currentSale.promoter_id);
    if (value(input, "bonus")) {
      await applyWarehouseStockMovement(
        client as unknown as QueryClient,
        currentSale.market_id,
        requested,
        "CANJE",
        currentSale.promoter_id,
        `SALE:${id}`,
      );
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
      redemptionCount: value(input, "bonus")
        ? Math.max(1, Math.floor(numeric(input, "redemptionCount")))
        : 0,
      redemptionItems: value(input, "bonus") ? requested : undefined,
      planchaAccessory:
        saleMode === "PLANCHAS" ? requestedAccessory : undefined,
      planchaMultiplier:
        saleMode === "PLANCHAS" ? requestedMultiplier : undefined,
      receiptPhoto: value(input, "receiptPhoto"),
      exchangePhoto: value(input, "bonus")
        ? value(input, "exchangePhoto") || undefined
        : undefined,
      status: "SINCRONIZADA",
      updatedAt,
    };
    await client.query(
      `UPDATE sales
       SET client_id=$2,amount_soles=$3,sale_date=$4,status='SINCRONIZADA',receipt_photo=$5,exchange_photo=$6,data=$7,record_updated_at=$8,updated_at=now()
       WHERE id=$1`,
      [
        id,
        sale.clientId,
        amountSoles,
        saleDate,
        sale.receiptPhoto || null,
        sale.exchangePhoto || null,
        sale,
        updatedAt,
      ],
    );
    await replaceSaleItems(client as unknown as QueryClient, id, sale, {
      allowLegacyWithoutSku: true,
    });
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
        actorName: "Promotor",
        promoterId: currentSale.promoter_id,
        date: updatedAt,
        status: "SINCRONIZADA",
      };
      await client.query(
        `INSERT INTO inventory_movements (id,market_id,kind,item_id,quantity,actor_id,movement_date,status,data,record_updated_at)
         VALUES ($1,$2,'CANJE',$3,$4,$5,$6,'SINCRONIZADA',$7,$8)`,
        [
          movement.id,
          movement.marketId,
          itemId,
          movement.quantity,
          movement.actorId,
          updatedAt,
          movement,
          updatedAt,
        ],
      );
    }
    await client.query("COMMIT");
    res.json({ sale, snapshot: await readSnapshot() });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    req.log.error({ err: error }, "Unable to update sale");
    res.status(500).json({
      message:
        error instanceof Error
          ? error.message
          : "No se pudo editar la venta.",
    });
  } finally {
    client.release();
  }
});

router.delete(
  "/app-storage/admin/sales/:id",
  async (req, res): Promise<void> => {
    const actor = await authorizedTradeActor(req);
    if (!actor) {
      res.status(403).json({
        message: "Solo Analista y Admin pueden eliminar ventas.",
      });
      return;
    }
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
        res.status(409).json({
          message:
            "La información cambió. Actualiza la aplicación antes de eliminar nuevamente.",
        });
        return;
      }
      await client.query(
        "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
        [`sale:${id}`],
      );
      await lockInventoryLedger(client as unknown as QueryClient);
      const saleResult = await client.query(
        "SELECT id FROM sales WHERE id=$1 FOR UPDATE",
        [id],
      );
      const saleExisted = Boolean(saleResult.rows[0]);
      const movementPrefix = `CAN-${id}-`;
      const movementResult = (await client.query(
        `SELECT market_id,item_id,quantity,data
       FROM inventory_movements
       WHERE kind='CANJE' AND left(id,length($1))=$1
       FOR UPDATE`,
        [movementPrefix],
      )) as unknown as {
        rows: Array<{
          market_id: string;
          item_id: string | null;
          quantity: number;
          data: StoredRecord;
        }>;
      };
      // inventory es histórico: no se recalcula ni restaura saldo legacy al borrar una venta.
            await restoreWarehouseStockMovements(client as unknown as QueryClient, `SALE:${id}`, "ADMIN");
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
      await client.query("DELETE FROM sale_items WHERE sale_id=$1", [id]);
      await client.query("DELETE FROM sales WHERE id=$1", [id]);
      await client.query("COMMIT");
      res.json({
        deleted: id,
        saleExisted,
        restoredCanjeMovements: movementResult.rows.length,
        snapshot: await readSnapshot(),
      });
    } catch (error) {
      await client.query("ROLLBACK");
      req.log.error({ err: error }, "Unable to delete sale");
      res.status(500).json({ message: "No se pudo eliminar la venta." });
    } finally {
      client.release();
    }
  },
);

router.get("/app-storage/admin/canjes", async (_req, res): Promise<void> => {
  try {
    const snapshot = await readSnapshot();
    res.json({ canjes: canjeSnapshot(snapshot) });
  } catch {
    res.status(500).json({ message: "No se pudieron leer los canjes." });
  }
});

router.post("/app-storage/admin/canjes", async (_req, res): Promise<void> => {
  res.status(409).json({
    message:
      "El stock ya no se asigna a promotores. Recarga el stock desde Almacén; los canjes se generan únicamente desde Ventas.",
  });
});

router.delete(
  "/app-storage/admin/canjes/:source/:id",
  async (_req, res): Promise<void> => {
    res.status(409).json({
      message:
        "Los canjes asociados a una venta se retiran editando la Venta. Esta ruta legado está deshabilitada para evitar borrar ventas o alterar stock fuera del flujo de Almacén.",
    });
  },
);

router.put(
  "/app-storage/admin/degustaciones/movement/:id",
  async (req, res): Promise<void> => {
    const actor = await authorizedWarehouseActor(req);
    if (!actor) {
      res.status(403).json({ message: "Solo Admin o Analista puede editar degustaciones." });
      return;
    }
    const id = String(req.params.id || "").trim();
    const input = isRecord(req.body?.record) ? req.body.record : {};
    const productId = value(input, "degustacionProductId");
    const quantity = Math.max(0, Math.trunc(Number(input.quantity) || 0));
    const maxQuantity =
      productId === "PANETON_900G" || productId === "PANETON"
        ? 2
        : productId === "PANETON_85G"
          ? 8
          : 0;
    if (!id || !maxQuantity || quantity < 1 || quantity > maxQuantity) {
      res.status(400).json({
        message: "Presentación o cantidad de degustación no válida.",
      });
      return;
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await lockInventoryLedger(db as unknown as QueryClient);
      const found = await db.query(
        "SELECT market_id,quantity,movement_date,data FROM inventory_movements WHERE id=$1 FOR UPDATE",
        [id],
      );
      const current = found.rows[0];
      if (!current || value(current.data as StoredRecord, "kind") !== "DEGUSTACION")
        throw new Error("La degustación no existe o no es operativa.");

      const currentData = isRecord(current.data) ? current.data : {};
      const promoterId =
        value(currentData, "promoterId") ||
        value(currentData, "actorId") ||
        actor.id;
      const marketId = String(current.market_id || "");
      const movementDate = new Date(String(current.movement_date)).toISOString();

      await restoreWarehouseStockMovements(
        db as unknown as QueryClient,
        `DEGUSTACION:${id}`,
        actor.id,
      );
      await applyWarehouseStockMovement(
        db as unknown as QueryClient,
        marketId,
        { [productId === "PANETON" ? "PANETON_900G" : productId]: quantity },
        "DEGUSTACION",
        promoterId,
        `DEGUSTACION:${id}`,
      );

      const updatedAt = new Date().toISOString();
      const nextData = {
        ...currentData,
        degustacionProductId: productId === "PANETON" ? "PANETON_900G" : productId,
        degustacionProductLabel:
          productId === "PANETON_85G" ? "Panetón 85 g" : "Panetón 900 g",
        quantity,
        updatedAt,
      };
      await db.query(
        `UPDATE inventory_movements
            SET quantity=$2,
                item_id=NULL,
                data=$3,
                record_updated_at=$4,
                updated_at=now()
          WHERE id=$1`,
        [id, quantity, nextData, updatedAt],
      );
      await recalculateDegustacionClosure(
        db as unknown as QueryClient,
        promoterId,
        marketId,
        movementDate,
      );
      await db.query("COMMIT");
      res.json({ record: nextData, snapshot: await readSnapshot() });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      req.log.error({ err: error }, "Unable to edit degustacion");
      res.status(409).json({
        message: error instanceof Error ? error.message : "No se pudo editar la degustación.",
      });
    } finally {
      db.release();
    }
  },
);

router.delete(
  "/app-storage/admin/degustaciones/:source/:id",
  async (req, res): Promise<void> => {
    const actor = await authorizedWarehouseActor(req);
    if (!actor) {
      res.status(403).json({ message: "Solo Admin o Analista puede eliminar degustaciones." });
      return;
    }
    const source = String(req.params.source || "");
    const id = String(req.params.id || "").trim();
    if (source !== "movement" || !id) {
      res.status(400).json({ message: "El origen de la degustación no es válido." });
      return;
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await lockInventoryLedger(db as unknown as QueryClient);
      const result = await db.query(
        "SELECT market_id,quantity,movement_date,data FROM inventory_movements WHERE id=$1 FOR UPDATE",
        [id],
      );
      const movement = result.rows[0];
      if (!movement) throw new Error("La degustación ya no existe.");
      const movementData = isRecord(movement.data) ? movement.data : {};
      if (value(movementData, "kind") !== "DEGUSTACION")
        throw new Error("El registro no corresponde a una degustación operativa.");

      const promoterId =
        value(movementData, "promoterId") ||
        value(movementData, "actorId") ||
        actor.id;
      const marketId = String(movement.market_id || "");
      const movementDate = new Date(String(movement.movement_date)).toISOString();

      await restoreWarehouseStockMovements(
        db as unknown as QueryClient,
        `DEGUSTACION:${id}`,
        actor.id,
      );
      await db.query("DELETE FROM inventory_movements WHERE id=$1", [id]);
      await recalculateDegustacionClosure(
        db as unknown as QueryClient,
        promoterId,
        marketId,
        movementDate,
      );
      await db.query("COMMIT");
      res.json({ deleted: id, source, snapshot: await readSnapshot() });
    } catch (error) {
      await db.query("ROLLBACK").catch(() => undefined);
      req.log.error({ err: error }, "Unable to delete degustacion");
      res.status(409).json({
        message: error instanceof Error ? error.message : "No se pudo eliminar la degustación.",
      });
    } finally {
      db.release();
    }
  },
);

router.post("/app-storage/admin/cleanup", async (_req, res): Promise<void> => {
  res.status(409).json({
    message:
      "Limpieza masiva deshabilitada para proteger la información de producción. Usa edición/eliminación individual con validación de relaciones.",
  });
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
    if (
      !row ||
      row.status !== "ACTIVO" ||
      !row.password_hash ||
      !(await verifyPassword(password, row.password_hash))
    ) {
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
