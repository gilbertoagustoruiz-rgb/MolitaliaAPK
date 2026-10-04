import { spawn } from "node:child_process";
import pg from "pg";

const { Pool } = pg;
const port = Number(process.env.E2E_PORT || 8099);
const base = `http://127.0.0.1:${port}/api`;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for E2E.");

const server = spawn(process.execPath, ["--enable-source-maps", "./dist/index.mjs"], {
  cwd: new URL("..", import.meta.url),
  env: { ...process.env, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (chunk) => process.stdout.write(chunk));
server.stderr.on("data", (chunk) => process.stderr.write(chunk));

const pool = new Pool({ connectionString: databaseUrl });

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${options.method || "GET"} ${path} -> ${response.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(base + "/healthz");
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("API did not become healthy.");
}

const admin = { id: "USR-E2E-ADMIN", dni: "99999991", name: "E2E Admin", role: "ADMIN", status: "ACTIVO", password: "E2E-admin-2026" };
const promoter = { id: "USR-E2E-PROM", dni: "99999992", name: "E2E Promotor", role: "PROMOTOR PERMANENTE", status: "ACTIVO", password: "E2E-prom-2026" };
const market = { id: "MKT-E2E", name: "MERCADO E2E", region: "LIMA", department: "LIMA", province: "LIMA", district: "LIMA", status: "ACTIVO", warehouseId: "ALM-E2E" };
const client = { id: "CLI-E2E", code: "E2E001", name: "CLIENTE E2E", marketId: market.id, status: "ACTIVO" };
const products = [
  { sku: "E2E-UNIT", product: "PANETON E2E UNIDAD", brand: "TODINNO", presentation: "BOLSA", unitsPerPackage: 1, unitsPerPlancha: 6, unitPrice: 10, totalPrice: 10, status: "ACTIVO", updatedAt: new Date().toISOString() },
  { sku: "E2E-PLANCHA", product: "PANETON E2E PLANCHA", brand: "COSTA", presentation: "CAJA", unitsPerPackage: 1, unitsPerPlancha: 6, unitPrice: 12, totalPrice: 12, status: "ACTIVO", updatedAt: new Date().toISOString() },
];

try {
  await waitForHealth();

  await request("/app-storage/sync", {
    method: "POST",
    body: JSON.stringify({
      snapshot: {
        markets: [market],
        users: [admin, promoter],
        clients: [client],
        assignments: [{ promoterId: promoter.id, promoterDni: promoter.dni, marketIds: [market.id], clientIds: [client.id], updatedAt: new Date().toISOString() }],
        productPrices: products,
      },
    }),
  });

  const login = await request("/app-storage/login", {
    method: "POST",
    body: JSON.stringify({ dni: promoter.dni, password: promoter.password }),
  });
  if (login.user?.id !== promoter.id) throw new Error("Login E2E did not return the promoter.");

  const adminHeaders = { "x-admin-dni": admin.dni, "x-admin-key": admin.password };
  await request("/app-storage/warehouses", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ warehouse: { id: "ALM-E2E", name: "ALMACEN E2E", region: "LIMA", department: "LIMA", province: "LIMA", district: "LIMA", status: "ACTIVO" } }),
  });
  await request("/app-storage/warehouses/ALM-E2E/recharge", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ initial: true, quantities: { PANETON_900G: 10, PANETON_85G: 10, AVENA: 1000, BATEA: 20, MANDIL: 20, SPAGHETTI: 1000 } }),
  });

  const now = new Date().toISOString();
  await request("/app-storage/sync", {
    method: "POST",
    body: JSON.stringify({ snapshot: { attendance: [{ id: "ATT-E2E-IN", promoterId: promoter.id, promoterDni: promoter.dni, clientId: client.id, marketId: market.id, type: "ENTRADA", photo: "/api/e2e.jpg", date: now, status: "PENDIENTE" }] } }),
  });

  const unitSale = {
    id: "VTA-E2E-UNIT", promoterId: promoter.id, clientId: client.id, marketId: market.id,
    mode: "UNIDADES", units: 2, amountSoles: 20, weightKg: 1.8,
    unitPrices: { "E2E-UNIT": 10 }, presentation: "BOLSA", mix: { TODINNO: 2 },
    bonus: "CANJE_AVENA_1", redemptionCount: 1, redemptionItems: { AVENA: 1, BATEA: 0, MANDIL: 0, SPAGHETTI: 0 },
    receiptPhoto: "/api/e2e-unit.jpg", exchangePhoto: "/api/e2e-canje.jpg", date: now, updatedAt: now, status: "PENDIENTE",
  };
  await request("/app-storage/sync", { method: "POST", body: JSON.stringify({ snapshot: { sales: [unitSale] } }) });

  const planchaSale = {
    id: "VTA-E2E-PLANCHA", promoterId: promoter.id, clientId: client.id, marketId: market.id,
    mode: "PLANCHAS", planchas: 1, units: 6, amountSoles: 72,
    unitPrices: { "E2E-PLANCHA": 12 },
    planchaLines: [{ sku: "E2E-PLANCHA", product: "PANETON E2E PLANCHA", units: 6, unitPrice: 12, presentation: "CAJA" }],
    mix: { "PANETON E2E PLANCHA": 6 }, receiptPhoto: "/api/e2e-plancha.jpg", date: now, updatedAt: now, status: "PENDIENTE",
  };
  await request("/app-storage/sync", { method: "POST", body: JSON.stringify({ snapshot: { sales: [planchaSale] } }) });

  const tradeSale = {
    ...planchaSale, id: "VTA-E2E-TRADE", planchas: 81, units: 486, amountSoles: 5832,
    planchaLines: [{ sku: "E2E-PLANCHA", product: "PANETON E2E PLANCHA", units: 486, unitPrice: 12, presentation: "CAJA" }],
    mix: { "PANETON E2E PLANCHA": 486 },
  };
  const approval = await request("/app-storage/trade-approvals", {
    method: "POST",
    body: JSON.stringify({ id: "TRD-E2E", sale: tradeSale }),
  });
  if (approval.approval?.status !== "PENDIENTE") throw new Error("Trade request was not pending.");
  await request("/app-storage/trade-approvals/TRD-E2E/resolve", {
    method: "POST", headers: adminHeaders, body: JSON.stringify({ decision: "APROBADA" }),
  });

  await request("/app-storage/sync", {
    method: "POST",
    body: JSON.stringify({ snapshot: { movements: [{
      id: "DEG-E2E", marketId: market.id, kind: "DEGUSTACION", degustacionProductId: "PANETON_85G",
      quantity: 1, actorId: promoter.id, promoterId: promoter.id, date: now, updatedAt: now, status: "PENDIENTE",
    }] } }),
  });

  const snapshot = await request("/app-storage");
  for (const id of ["VTA-E2E-UNIT", "VTA-E2E-PLANCHA", "VTA-E2E-TRADE"]) {
    if (!snapshot.snapshot.sales.some((sale) => sale.id === id)) throw new Error(`Sale ${id} missing from dashboard snapshot.`);
  }

  const itemRows = await pool.query("SELECT sale_id,sku,quantity FROM sale_items WHERE sale_id LIKE 'VTA-E2E-%' ORDER BY sale_id,line_no");
  if (itemRows.rows.length !== 3) throw new Error(`Expected 3 normalized sale_items rows, found ${itemRows.rows.length}.`);

  const legacySale = {
    id: "VTA-E2E-LEGACY", promoterId: promoter.id, clientId: client.id, marketId: market.id,
    mode: "PLANCHAS", planchas: 80, units: 480, amountSoles: 5760,
    mix: { "PANETON LEGACY": 480 },
    bonus: "144 Avena + 100 Spaghetti",
    redemptionCount: 1,
    redemptionItems: { AVENA: 144, BATEA: 0, MANDIL: 0, SPAGHETTI: 100 },
    receiptPhoto: "/api/e2e-legacy.jpg", exchangePhoto: "/api/e2e-legacy-canje.jpg",
    date: now, updatedAt: now, status: "SINCRONIZADA",
  };
  await pool.query(
    `INSERT INTO sales(id,promoter_id,client_id,market_id,mode,units,amount_soles,sale_date,status,receipt_photo,exchange_photo,data,record_updated_at)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [legacySale.id, legacySale.promoterId, legacySale.clientId, legacySale.marketId, legacySale.mode, legacySale.units,
     legacySale.amountSoles, legacySale.date, legacySale.status, legacySale.receiptPhoto, legacySale.exchangePhoto,
     legacySale, legacySale.updatedAt],
  );
  await request("/app-storage/admin/sales/VTA-E2E-LEGACY", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      sale: {
        ...legacySale,
        bonus: "288 Avena + 200 Spaghetti",
        redemptionItems: { AVENA: 288, BATEA: 0, MANDIL: 0, SPAGHETTI: 200 },
        planchaAccessory: "NINGUNO",
        planchaMultiplier: 2,
      },
    }),
  });
  const legacyAfter = await pool.query("SELECT data FROM sales WHERE id='VTA-E2E-LEGACY'");
  if (Number(legacyAfter.rows[0]?.data?.planchaMultiplier) !== 2)
    throw new Error("Legacy sale edit did not persist multiplier x2.");

  const beforeDelete = await pool.query("SELECT stock FROM warehouses WHERE id='ALM-E2E'");
  const beforeAvena = Number(beforeDelete.rows[0].stock.AVENA);
  await request("/app-storage/admin/sales/VTA-E2E-UNIT", { method: "DELETE", headers: adminHeaders });
  const afterDelete = await pool.query("SELECT stock FROM warehouses WHERE id='ALM-E2E'");
  const afterAvena = Number(afterDelete.rows[0].stock.AVENA);
  if (afterAvena !== beforeAvena + 1) throw new Error("Deleting the sale did not restore canje stock exactly once.");
  const remainingItems = await pool.query("SELECT 1 FROM sale_items WHERE sale_id='VTA-E2E-UNIT'");
  if (remainingItems.rows.length) throw new Error("sale_items was not removed with the deleted sale.");

  console.log("E2E CORE OK: login -> attendance -> units -> plancha -> Trade -> degustacion -> warehouse -> dashboard -> delete/restore");
} finally {
  await pool.end().catch(() => undefined);
  server.kill("SIGTERM");
}
