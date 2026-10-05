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
const client = { id: "CLI-E2E", code: "E2E001", name: "CLIENTE E2E", category: "MIXTO", marketId: market.id, status: "ACTIVO" };
const categories = [
  { id: "MIXTO", name: "MIXTO", status: "ACTIVO", updatedAt: new Date().toISOString() },
];
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
        productPrices: products,
        categories,
      },
    }),
  });

  const login = await request("/app-storage/login", {
    method: "POST",
    body: JSON.stringify({ dni: promoter.dni, password: promoter.password }),
  });
  if (login.user?.id !== promoter.id) throw new Error("Login E2E did not return the promoter.");

  const adminHeaders = { "x-admin-dni": admin.dni, "x-admin-key": admin.password };

  const unauthorizedAssignment = await fetch(base + "/app-storage/assignments", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      assignment: {
        promoterId: promoter.id,
        marketIds: [market.id],
        clientIds: [client.id],
      },
    }),
  });
  if (unauthorizedAssignment.status !== 403)
    throw new Error("Unauthenticated assignment update was not rejected.");

  await request("/app-storage/assignments", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      assignment: {
        promoterId: promoter.id,
        marketIds: [market.id],
        clientIds: [client.id],
      },
    }),
  });


  await request("/app-storage/admin/catalog/categories", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      record: {
        id: "E2E-CAT-UNUSED",
        name: "E2E CATEGORIA SIN USO",
        status: "ACTIVO",
      },
    }),
  });
  await request("/app-storage/admin/catalog/categories/E2E-CAT-UNUSED", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const unusedCategory = await pool.query(
    "SELECT id FROM client_categories WHERE id='E2E-CAT-UNUSED'",
  );
  if (unusedCategory.rows.length)
    throw new Error("Unused category was not physically removed.");

  const duplicateCategoryName = await fetch(base + "/app-storage/admin/catalog/categories", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      record: {
        id: "E2E-CAT-DUP",
        name: "MIXTO",
        status: "ACTIVO",
      },
    }),
  });
  if (duplicateCategoryName.status !== 400)
    throw new Error("Duplicate category name was not rejected.");

  await request("/app-storage/admin/catalog/categories/MIXTO", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const usedCategory = await pool.query(
    "SELECT id,data FROM client_categories WHERE id='MIXTO'",
  );
  if (!usedCategory.rows.length || usedCategory.rows[0]?.data?.status !== "INACTIVO")
    throw new Error("Used category was deleted instead of being marked INACTIVO.");

  await request("/app-storage/admin/catalog/categories", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      record: {
        id: "MIXTO",
        name: "MIXTO",
        status: "ACTIVO",
      },
    }),
  });


  await request("/app-storage/admin/clients", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      client: {
        id: "CLI-E2E-TEMP",
        code: "E2ETEMP",
        name: "CLIENTE TEMPORAL",
        phone: "999888777",
        category: "MIXTO",
        marketId: market.id,
        status: "ACTIVO",
      },
    }),
  });
  await request("/app-storage/admin/clients", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      client: {
        id: "CLI-E2E-TEMP",
        code: "E2ETEMP2",
        name: "CLIENTE TEMPORAL EDITADO",
        phone: "999111222",
        category: "MIXTO",
        marketId: market.id,
        status: "ACTIVO",
      },
    }),
  });
  const editedClient = await pool.query(
    "SELECT code,name,data FROM clients WHERE id='CLI-E2E-TEMP'",
  );
  if (
    editedClient.rows[0]?.code !== "E2ETEMP2" ||
    editedClient.rows[0]?.name !== "CLIENTE TEMPORAL EDITADO"
  )
    throw new Error("Client edit did not persist.");

  const duplicateClientCode = await fetch(base + "/app-storage/admin/clients", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      client: {
        id: "CLI-E2E-TEMP-2",
        code: "E2ETEMP2",
        name: "CLIENTE DUPLICADO",
        category: "MIXTO",
        marketId: market.id,
        status: "ACTIVO",
      },
    }),
  });
  if (duplicateClientCode.status !== 409)
    throw new Error("Duplicate client code was not rejected.");

  await request("/app-storage/admin/clients/CLI-E2E-TEMP", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const deletedTempClient = await pool.query(
    "SELECT id FROM clients WHERE id='CLI-E2E-TEMP'",
  );
  if (deletedTempClient.rows.length)
    throw new Error("Unused client was not deleted.");


  await request("/app-storage/admin/users", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      user: {
        id: "USR-E2E-USER-EDIT",
        dni: "99999993",
        name: "E2E COORDINADOR",
        role: "COORDINADOR",
        roleLabel: "COORDINADOR",
        marketId: market.id,
        password: "E2E-user-2026",
        status: "ACTIVO",
      },
    }),
  });
  await request("/app-storage/assignments", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      assignment: {
        promoterId: "USR-E2E-USER-EDIT",
        promoterDni: "99999993",
        marketIds: [market.id],
        clientIds: [client.id],
        updatedAt: new Date().toISOString(),
      },
    }),
  });

  await request("/app-storage/admin/records/users/USR-E2E-USER-EDIT", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      record: {
        id: "USR-E2E-USER-EDIT",
        dni: "99999994",
        name: "E2E COORDINADOR",
        role: "COORDINADOR",
        roleLabel: "COORDINADOR",
        marketId: market.id,
        status: "ACTIVO",
        password: "",
      },
    }),
  });
  const updatedAssignmentDni = await pool.query(
    "SELECT promoter_dni FROM assignments WHERE promoter_id='USR-E2E-USER-EDIT'",
  );
  if (updatedAssignmentDni.rows[0]?.promoter_dni !== "99999994")
    throw new Error("User DNI edit did not update assignment promoter_dni.");

  const duplicateDniEdit = await fetch(
    base + "/app-storage/admin/records/users/USR-E2E-USER-EDIT",
    {
      method: "PUT",
      headers: { "content-type": "application/json", ...adminHeaders },
      body: JSON.stringify({
        record: {
          id: "USR-E2E-USER-EDIT",
          dni: admin.dni,
          name: "E2E COORDINADOR",
          role: "COORDINADOR",
          marketId: market.id,
          status: "ACTIVO",
        },
      }),
    },
  );
  if (duplicateDniEdit.status !== 409)
    throw new Error("Duplicate DNI edit was not rejected.");

  await request("/app-storage/admin/records/users/USR-E2E-USER-EDIT", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      record: {
        id: "USR-E2E-USER-EDIT",
        dni: "99999994",
        name: "E2E ANALISTA TEMP",
        role: "ANALISTA",
        roleLabel: "ANALISTA",
        status: "ACTIVO",
        password: "",
      },
    }),
  });
  const removedAssignment = await pool.query(
    "SELECT promoter_id FROM assignments WHERE promoter_id='USR-E2E-USER-EDIT'",
  );
  if (removedAssignment.rows.length)
    throw new Error("Assignment remained after user changed to non-zone role.");

  await request("/app-storage/admin/records/users/USR-E2E-USER-EDIT", {
    method: "DELETE",
    headers: adminHeaders,
  });

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

  const duplicateWarehouseResponse = await fetch(base + "/app-storage/warehouses", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      warehouse: {
        id: "ALM-E2E-DUP",
        name: "ALMACEN E2E",
        region: "LIMA",
        department: "LIMA",
        province: "LIMA",
        district: "LIMA",
        status: "ACTIVO",
      },
    }),
  });
  if (duplicateWarehouseResponse.status !== 409)
    throw new Error("Duplicate warehouse name was not rejected.");

  const deactivateLinkedWarehouse = await fetch(base + "/app-storage/warehouses", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      warehouse: {
        id: "ALM-E2E",
        name: "ALMACEN E2E",
        region: "LIMA",
        department: "LIMA",
        province: "LIMA",
        district: "LIMA",
        status: "INACTIVO",
      },
    }),
  });
  if (deactivateLinkedWarehouse.status !== 409)
    throw new Error("Linked warehouse deactivation was not blocked.");

  const deleteOperationalWarehouse = await fetch(base + "/app-storage/warehouses/ALM-E2E", {
    method: "DELETE",
    headers: adminHeaders,
  });
  if (deleteOperationalWarehouse.status !== 409)
    throw new Error("Operational warehouse deletion was not blocked.");

  await request("/app-storage/warehouses", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      warehouse: {
        id: "ALM-E2E-EMPTY",
        name: "ALMACEN E2E VACIO",
        region: "LIMA",
        department: "LIMA",
        province: "LIMA",
        district: "LIMA",
        status: "ACTIVO",
      },
    }),
  });
  await request("/app-storage/warehouses/ALM-E2E-EMPTY", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const deletedEmptyWarehouse = await pool.query(
    "SELECT id FROM warehouses WHERE id='ALM-E2E-EMPTY'",
  );
  if (deletedEmptyWarehouse.rows.length)
    throw new Error("Empty warehouse was not deleted.");


  await request("/app-storage/admin/markets", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      market: {
        id: "MKT-E2E-EDIT",
        name: "Mercado E2E Editable",
        region: "LIMA",
        department: "LIMA",
        province: "LIMA",
        district: "LIMA",
      },
    }),
  });
  await request("/app-storage/admin/records/markets/MKT-E2E-EDIT", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      record: {
        id: "MKT-E2E-EDIT",
        name: "MERCADO E2E EDITADO",
        region: "LIMA",
        department: "LIMA",
        province: "LIMA",
        district: "LIMA",
        warehouseId: "ALM-E2E",
        status: "ACTIVO",
      },
    }),
  });
  const editedMarketSnapshot = await request("/app-storage");
  const editedMarket = editedMarketSnapshot.snapshot.markets.find(
    (item) => item.id === "MKT-E2E-EDIT",
  );
  if (editedMarket?.warehouseId !== "ALM-E2E")
    throw new Error("Market edit did not persist warehouseId.");

  await pool.query(
    `INSERT INTO clients(id,code,name,market_id,status,data,record_updated_at)
     VALUES('CLI-E2E-MARKET-GUARD','CLI-E2E-GUARD','CLIENTE GUARD','MKT-E2E-EDIT','ACTIVO',
       '{"id":"CLI-E2E-MARKET-GUARD","code":"CLI-E2E-GUARD","name":"CLIENTE GUARD","marketId":"MKT-E2E-EDIT","status":"ACTIVO"}'::jsonb,now())`,
  );
  const guardedDelete = await fetch(base + "/app-storage/admin/markets/MKT-E2E-EDIT", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const guardedDeleteBody = await guardedDelete.json().catch(() => ({}));
  if (guardedDelete.status !== 409)
    throw new Error(
      `Market deletion with related records was not blocked: ${guardedDelete.status} ${JSON.stringify(guardedDeleteBody)}`,
    );
  const guardedClient = await pool.query(
    "SELECT id FROM clients WHERE id='CLI-E2E-MARKET-GUARD'",
  );
  if (!guardedClient.rows.length)
    throw new Error("Guarded market deletion removed related client data.");

  await request("/app-storage/admin/markets", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      market: {
        id: "MKT-E2E-OTHER",
        name: "MERCADO E2E OTRO",
        region: "LIMA",
        department: "LIMA",
        province: "LIMA",
        district: "LIMA",
      },
    }),
  });
  await request("/app-storage/admin/clients", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      client: {
        id: "CLI-E2E-OTHER",
        code: "E2EOTHER",
        name: "CLIENTE OTRO MERCADO",
        category: "MIXTO",
        marketId: "MKT-E2E-OTHER",
        status: "ACTIVO",
      },
    }),
  });

  const invalidCrossMarketAssignment = await fetch(base + "/app-storage/assignments", {
    method: "POST",
    headers: { "content-type": "application/json", ...adminHeaders },
    body: JSON.stringify({
      assignment: {
        promoterId: promoter.id,
        marketIds: [market.id],
        clientIds: ["CLI-E2E-OTHER"],
      },
    }),
  });
  if (invalidCrossMarketAssignment.status !== 409)
    throw new Error("Assignment accepted a client from a non-selected market.");

  await request("/app-storage/sync", {
    method: "POST",
    body: JSON.stringify({
      snapshot: {
        assignments: [{
          promoterId: promoter.id,
          promoterDni: promoter.dni,
          marketIds: ["MKT-E2E-OTHER"],
          clientIds: ["CLI-E2E-OTHER"],
          updatedAt: new Date(Date.now() + 999999).toISOString(),
        }],
      },
    }),
  });
  const assignmentAfterGenericSync = await pool.query(
    "SELECT market_ids,client_ids FROM assignments WHERE promoter_id=$1",
    [promoter.id],
  );
  if (
    assignmentAfterGenericSync.rows[0]?.market_ids?.[0] !== market.id ||
    assignmentAfterGenericSync.rows[0]?.client_ids?.[0] !== client.id
  )
    throw new Error("Generic sync was able to overwrite official assignments.");

  await request("/app-storage/assignments", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      assignment: {
        promoterId: promoter.id,
        marketIds: [],
        clientIds: [],
      },
    }),
  });
  const clearedAssignment = await pool.query(
    "SELECT market_ids,client_ids FROM assignments WHERE promoter_id=$1",
    [promoter.id],
  );
  if (
    clearedAssignment.rows[0]?.market_ids?.length ||
    clearedAssignment.rows[0]?.client_ids?.length
  )
    throw new Error("Assignment clear did not persist empty coverage.");
  const clearedPromoterUser = await pool.query(
    "SELECT data FROM users WHERE id=$1",
    [promoter.id],
  );
  if (clearedPromoterUser.rows[0]?.data?.marketId)
    throw new Error("Clearing assignment left stale user.marketId fallback.");

  await request("/app-storage/assignments", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      assignment: {
        promoterId: promoter.id,
        marketIds: [market.id],
        clientIds: [client.id],
      },
    }),
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
    bonus: "CANJE_AVENA_1", finalClientName: "CLIENTE FINAL E2E", redemptionCount: 1, redemptionItems: { AVENA: 1, BATEA: 0, MANDIL: 0, SPAGHETTI: 0 },
    receiptPhoto: "/api/e2e-unit.jpg", exchangePhoto: "/api/e2e-canje.jpg", date: now, updatedAt: now, status: "PENDIENTE",
  };
  const invalidCanjeSale = {
    ...unitSale,
    id: "VTA-E2E-CANJE-SIN-CLIENTE",
    finalClientName: "",
  };
  const invalidCanjeResponse = await fetch(base + "/app-storage/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ snapshot: { sales: [invalidCanjeSale] } }),
  });
  const invalidCanjeBody = await invalidCanjeResponse.json().catch(() => ({}));
  if (invalidCanjeResponse.ok)
    throw new Error("A canje sale without finalClientName was accepted.");
  if (!String(invalidCanjeBody.message || "").includes("Nombre Cliente Final"))
    throw new Error("Missing final client rejection did not return the expected message.");

  await request("/app-storage/sync", { method: "POST", body: JSON.stringify({ snapshot: { sales: [unitSale] } }) });

  const canjeEditSale = {
    ...unitSale,
    id: "VTA-E2E-CANJE-EDIT",
    updatedAt: new Date(Date.now() + 1000).toISOString(),
  };
  await request("/app-storage/sync", {
    method: "POST",
    body: JSON.stringify({ snapshot: { sales: [canjeEditSale] } }),
  });
  const canjeEditStockBefore = await pool.query(
    "SELECT stock FROM warehouses WHERE id='ALM-E2E'",
  );
  const canjeEditAvenaBefore = Number(canjeEditStockBefore.rows[0].stock.AVENA);

  const canjeRemovedSale = {
    ...canjeEditSale,
    bonus: "",
    finalClientName: "",
    redemptionCount: 0,
    redemptionItems: {},
    exchangePhoto: "",
    updatedAt: new Date(Date.now() + 2000).toISOString(),
  };
  await request("/app-storage/admin/sales/VTA-E2E-CANJE-EDIT", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({ sale: canjeRemovedSale }),
  });
  const canjeEditStockAfter = await pool.query(
    "SELECT stock FROM warehouses WHERE id='ALM-E2E'",
  );
  const canjeEditAvenaAfter = Number(canjeEditStockAfter.rows[0].stock.AVENA);
  if (canjeEditAvenaAfter !== canjeEditAvenaBefore + 1)
    throw new Error("Removing only the canje did not restore warehouse stock exactly once.");

  const canjeSaleStillExists = await pool.query(
    "SELECT id,data FROM sales WHERE id='VTA-E2E-CANJE-EDIT'",
  );
  if (!canjeSaleStillExists.rows.length)
    throw new Error("Removing a canje deleted the sale.");
  if (String(canjeSaleStillExists.rows[0]?.data?.bonus || ""))
    throw new Error("Canje remained attached after sale edit.");

  await request("/app-storage/admin/sales/VTA-E2E-CANJE-EDIT", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      sale: {
        ...canjeRemovedSale,
        updatedAt: new Date(Date.now() + 3000).toISOString(),
      },
    }),
  });
  const canjeEditStockRepeated = await pool.query(
    "SELECT stock FROM warehouses WHERE id='ALM-E2E'",
  );
  if (Number(canjeEditStockRepeated.rows[0].stock.AVENA) !== canjeEditAvenaAfter)
    throw new Error("Repeated canje removal restored warehouse stock more than once.");

  const legacyCanjeDelete = await fetch(
    base + "/app-storage/admin/canjes/sale/VTA-E2E-CANJE-EDIT",
    { method: "DELETE", headers: adminHeaders },
  );
  if (legacyCanjeDelete.status !== 409)
    throw new Error("Legacy canje deletion route is still active.");


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
  const invalidTradeCoverage = await fetch(base + "/app-storage/trade-approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "TRD-E2E-INVALID-COVERAGE",
      sale: {
        ...tradeSale,
        id: "VTA-E2E-TRADE-INVALID-COVERAGE",
        clientId: "CLI-E2E-OTHER",
      },
    }),
  });
  if (invalidTradeCoverage.status !== 409)
    throw new Error("Trade request accepted a client outside promoter coverage.");

  const rejectionRequest = await request("/app-storage/trade-approvals", {
    method: "POST",
    body: JSON.stringify({
      id: "TRD-E2E-REJECT",
      sale: {
        ...tradeSale,
        id: "VTA-E2E-TRADE-REJECT",
      },
    }),
  });
  if (rejectionRequest.approval?.status !== "PENDIENTE")
    throw new Error("Trade rejection test request was not pending.");
  await request("/app-storage/trade-approvals/TRD-E2E-REJECT/resolve", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({ decision: "RECHAZADA" }),
  });
  const rejectedSale = await pool.query(
    "SELECT id FROM sales WHERE id='VTA-E2E-TRADE-REJECT'",
  );
  if (rejectedSale.rows.length)
    throw new Error("Rejected Trade request created a sale.");

  const resolveRejectedAgain = await fetch(
    base + "/app-storage/trade-approvals/TRD-E2E-REJECT/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders },
      body: JSON.stringify({ decision: "APROBADA" }),
    },
  );
  if (resolveRejectedAgain.status !== 409)
    throw new Error("Resolved Trade request was allowed to resolve again.");

  const approval = await request("/app-storage/trade-approvals", {
    method: "POST",
    body: JSON.stringify({ id: "TRD-E2E", sale: tradeSale }),
  });
  if (approval.approval?.status !== "PENDIENTE") throw new Error("Trade request was not pending.");
  const duplicateTradeRequest = await fetch(base + "/app-storage/trade-approvals", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      id: "TRD-E2E-DUPLICATE-ID",
      sale: tradeSale,
    }),
  });
  if (duplicateTradeRequest.status !== 409)
    throw new Error("Duplicate Trade request for the same sale was not rejected.");
  await request("/app-storage/trade-approvals/TRD-E2E/resolve", {
    method: "POST", headers: adminHeaders, body: JSON.stringify({ decision: "APROBADA" }),
  });
  const resolveApprovedAgain = await fetch(
    base + "/app-storage/trade-approvals/TRD-E2E/resolve",
    {
      method: "POST",
      headers: { "content-type": "application/json", ...adminHeaders },
      body: JSON.stringify({ decision: "APROBADA" }),
    },
  );
  if (resolveApprovedAgain.status !== 409)
    throw new Error("Approved Trade request was allowed to resolve twice.");
  const approvedSaleCount = await pool.query(
    "SELECT COUNT(*)::int AS count FROM sales WHERE id='VTA-E2E-TRADE'",
  );
  if (Number(approvedSaleCount.rows[0]?.count) !== 1)
    throw new Error("Trade approval did not create exactly one sale.");

  await request("/app-storage/sync", {
    method: "POST",
    body: JSON.stringify({
      snapshot: {
        movements: [{
          id: "DEG-E2E",
          marketId: market.id,
          kind: "DEGUSTACION",
          degustacionProductId: "PANETON_85G",
          degustacionProductLabel: "Panetón 85 g",
          quantity: 1,
          actorId: promoter.id,
          promoterId: promoter.id,
          actorName: promoter.name,
          date: now,
          updatedAt: now,
          status: "PENDIENTE",
        }],
        closures: [{
          id: "CLOSE-E2E",
          promoterId: promoter.id,
          marketId: market.id,
          clientId: client.id,
          tastingUsed: 1,
          tasting900g: 0,
          tasting85g: 1,
          leads: 10,
          closureType: "MANUAL",
          date: now,
          updatedAt: now,
          status: "PENDIENTE",
        }],
      },
    }),
  });

  const tastingStockAfter85 = await pool.query(
    "SELECT stock FROM warehouses WHERE id='ALM-E2E'",
  );
  const stock85AfterCreate = Number(tastingStockAfter85.rows[0].stock.PANETON_85G);
  const stock900AfterCreate = Number(tastingStockAfter85.rows[0].stock.PANETON_900G);

  await request("/app-storage/admin/degustaciones/movement/DEG-E2E", {
    method: "PUT",
    headers: adminHeaders,
    body: JSON.stringify({
      record: {
        id: "DEG-E2E",
        degustacionProductId: "PANETON_900G",
        quantity: 2,
      },
    }),
  });

  const tastingStockAfterEdit = await pool.query(
    "SELECT stock FROM warehouses WHERE id='ALM-E2E'",
  );
  if (Number(tastingStockAfterEdit.rows[0].stock.PANETON_85G) !== stock85AfterCreate + 1)
    throw new Error("Editing degustacion did not restore previous 85g stock.");
  if (Number(tastingStockAfterEdit.rows[0].stock.PANETON_900G) !== stock900AfterCreate - 2)
    throw new Error("Editing degustacion did not consume new 900g stock.");

  const closureAfterTastingEdit = await pool.query(
    "SELECT tasting_used,leads,data FROM session_closures WHERE id='CLOSE-E2E'",
  );
  if (
    Number(closureAfterTastingEdit.rows[0]?.tasting_used) !== 2 ||
    Number(closureAfterTastingEdit.rows[0]?.leads) !== 160 ||
    Number(closureAfterTastingEdit.rows[0]?.data?.tasting900g) !== 2 ||
    Number(closureAfterTastingEdit.rows[0]?.data?.tasting85g) !== 0
  )
    throw new Error("Degustacion edit did not recalculate closure/contact totals.");

  await request("/app-storage/admin/degustaciones/movement/DEG-E2E", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const tastingStockAfterDelete = await pool.query(
    "SELECT stock FROM warehouses WHERE id='ALM-E2E'",
  );
  if (Number(tastingStockAfterDelete.rows[0].stock.PANETON_900G) !== stock900AfterCreate)
    throw new Error("Deleting degustacion did not restore 900g stock.");

  const closureAfterTastingDelete = await pool.query(
    "SELECT tasting_used,leads,data FROM session_closures WHERE id='CLOSE-E2E'",
  );
  if (
    Number(closureAfterTastingDelete.rows[0]?.tasting_used) !== 0 ||
    Number(closureAfterTastingDelete.rows[0]?.leads) !== 0 ||
    Number(closureAfterTastingDelete.rows[0]?.data?.tasting900g) !== 0 ||
    Number(closureAfterTastingDelete.rows[0]?.data?.tasting85g) !== 0
  )
    throw new Error("Deleting degustacion did not clear closure/contact totals.");


  await pool.query(
    "UPDATE sales SET data=jsonb_set(data,'{status}','\"PENDIENTE\"'::jsonb) WHERE id='VTA-E2E-PLANCHA'",
  );
  const deleteClientWithHistory = await fetch(
    base + "/app-storage/admin/clients/" + client.id,
    {
      method: "DELETE",
      headers: adminHeaders,
    },
  );
  const deleteClientWithHistoryBody = await deleteClientWithHistory.json().catch(() => ({}));
  if (deleteClientWithHistory.status !== 409)
    throw new Error(
      `Client with history deletion was not blocked: ${deleteClientWithHistory.status} ${JSON.stringify(deleteClientWithHistoryBody)}`,
    );
  const clientStillExists = await pool.query("SELECT id FROM clients WHERE id=$1", [client.id]);
  if (!clientStillExists.rows.length)
    throw new Error("Client with historical records was deleted.");

  const deletePromoterWithHistory = await fetch(
    base + "/app-storage/admin/records/users/" + promoter.id,
    {
      method: "DELETE",
      headers: adminHeaders,
    },
  );
  const deletePromoterWithHistoryBody = await deletePromoterWithHistory.json().catch(() => ({}));
  if (deletePromoterWithHistory.status !== 409)
    throw new Error(
      `Promoter with history deletion was not blocked: ${deletePromoterWithHistory.status} ${JSON.stringify(deletePromoterWithHistoryBody)}`,
    );
  const promoterStillExists = await pool.query("SELECT id FROM users WHERE id=$1", [promoter.id]);
  if (!promoterStillExists.rows.length)
    throw new Error("Promoter with historical records was deleted.");

  const snapshot = await request("/app-storage");
  const repairedStatusSale = snapshot.snapshot.sales.find(
    (sale) => sale.id === "VTA-E2E-PLANCHA",
  );
  if (repairedStatusSale?.status !== "SINCRONIZADA")
    throw new Error(
      `Snapshot exposed stale JSON status instead of PostgreSQL status: ${repairedStatusSale?.status}`,
    );
  for (const id of ["VTA-E2E-UNIT", "VTA-E2E-PLANCHA", "VTA-E2E-TRADE"]) {
    if (!snapshot.snapshot.sales.some((sale) => sale.id === id)) throw new Error(`Sale ${id} missing from dashboard snapshot.`);
  }

  const itemRows = await pool.query("SELECT sale_id,sku,quantity FROM sale_items WHERE sale_id LIKE 'VTA-E2E-%' ORDER BY sale_id,line_no");
  if (itemRows.rows.length !== 4) throw new Error(`Expected 4 normalized sale_items rows, found ${itemRows.rows.length}.`);

  await request("/app-storage/admin/catalog/products", {
    method: "POST",
    headers: adminHeaders,
    body: JSON.stringify({
      record: {
        sku: "E2E-UNUSED-SKU",
        product: "PRODUCTO E2E SIN USO",
        brand: "E2E",
        presentation: "BOLSA",
        unitMeasure: 1,
        weightKg: 0.1,
        saleModes: ["UNIDADES"],
        unitsPerPlancha: 1,
        unitPrice: 1,
        totalPrice: 1,
        status: "ACTIVO",
      },
    }),
  });
  await request("/app-storage/admin/catalog/products/E2E-UNUSED-SKU", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const unusedSku = await pool.query(
    "SELECT sku FROM product_prices WHERE sku='E2E-UNUSED-SKU'",
  );
  if (unusedSku.rows.length)
    throw new Error("Unused SKU was not physically removed.");

  await request("/app-storage/admin/catalog/products/E2E-PLANCHA", {
    method: "DELETE",
    headers: adminHeaders,
  });
  const usedSku = await pool.query(
    "SELECT sku,data FROM product_prices WHERE sku='E2E-PLANCHA'",
  );
  if (!usedSku.rows.length || usedSku.rows[0]?.data?.status !== "INACTIVO")
    throw new Error("Used SKU was deleted instead of being marked INACTIVO.");

  const legacySale = {
    id: "VTA-E2E-LEGACY", promoterId: promoter.id, clientId: client.id, marketId: market.id,
    mode: "PLANCHAS", planchas: 80, units: 480, amountSoles: 5760,
    mix: { "PANETON LEGACY": 480 },
    bonus: "144 Avena + 100 Spaghetti",
    finalClientName: "CLIENTE FINAL HISTORICO E2E",
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
