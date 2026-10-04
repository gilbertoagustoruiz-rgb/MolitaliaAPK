import { sql } from "drizzle-orm";
import {
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
};

const recordUpdatedAt = timestamp("record_updated_at", { withTimezone: true });

export const appMetadataTable = pgTable("app_metadata", {
  key: text("key").primaryKey(),
  value: text("value"),
  ...timestamps,
});

export const appStorageTombstonesTable = pgTable(
  "app_storage_tombstones",
  {
    collection: text("collection").notNull(),
    recordId: text("record_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...timestamps,
  },
  (table) => [
    primaryKey({
      columns: [table.collection, table.recordId],
      name: "app_storage_tombstones_pkey",
    }),
  ],
);

export const marketsTable = pgTable("markets", {
  id: text("id").primaryKey(),
  name: text("name").notNull().default(""),
  region: text("region"),
  department: text("department"),
  province: text("province"),
  district: text("district"),
  status: text("status").notNull().default("ACTIVO"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  recordUpdatedAt,
  ...timestamps,
});

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    dni: text("dni").notNull(),
    name: text("name").notNull().default(""),
    role: text("role").notNull().default("PROMOTOR"),
    status: text("status").notNull().default("ACTIVO"),
    passwordHash: text("password_hash"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    recordUpdatedAt,
    ...timestamps,
  },
  (table) => [uniqueIndex("users_dni_unique").on(table.dni)],
);

export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  code: text("code").notNull().default(""),
  name: text("name").notNull().default(""),
  marketId: text("market_id").notNull().default(""),
  status: text("status").notNull().default("ACTIVO"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  recordUpdatedAt,
  ...timestamps,
});

export const salesTable = pgTable(
  "sales",
  {
    id: text("id").primaryKey(),
    promoterId: text("promoter_id").notNull().default(""),
    clientId: text("client_id").notNull().default(""),
    marketId: text("market_id").notNull().default(""),
    mode: text("mode").notNull().default(""),
    units: numeric("units").notNull().default("0"),
    amountSoles: numeric("amount_soles", { precision: 14, scale: 2 })
      .notNull()
      .default("0"),
    weightKg: numeric("weight_kg", { precision: 14, scale: 3 }),
    saleDate: timestamp("sale_date", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("SINCRONIZADA"),
    receiptPhoto: text("receipt_photo"),
    exchangePhoto: text("exchange_photo"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    recordUpdatedAt,
    ...timestamps,
  },
  (table) => [index("idx_sales_date").on(table.saleDate)],
);

export const tradeApprovalsTable = pgTable(
  "trade_approvals",
  {
    id: text("id").primaryKey(),
    promoterId: text("promoter_id").notNull().default(""),
    clientId: text("client_id").notNull().default(""),
    marketId: text("market_id").notNull().default(""),
    status: text("status").notNull().default("PENDIENTE"),
    requestedAt: timestamp("requested_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedBy: text("resolved_by"),
    resolutionComment: text("resolution_comment"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    index("idx_trade_approvals_status_requested").on(
      table.status,
      table.requestedAt,
    ),
  ],
);

export const attendanceTable = pgTable(
  "attendance",
  {
    id: text("id").primaryKey(),
    promoterId: text("promoter_id").notNull().default(""),
    clientId: text("client_id").notNull().default(""),
    marketId: text("market_id").notNull().default(""),
    eventType: text("event_type").notNull().default(""),
    eventDate: timestamp("event_date", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("SINCRONIZADA"),
    photo: text("photo"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    recordUpdatedAt,
    ...timestamps,
  },
  (table) => [index("idx_attendance_date").on(table.eventDate)],
);

export const warehousesTable = pgTable(
  "warehouses",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull().default(""),
    location: text("location"),
    status: text("status").notNull().default("ACTIVO"),
    marketIds: text("market_ids").array().notNull().default([]),
    stock: jsonb("stock").$type<Record<string, number>>().notNull().default({}),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("idx_warehouses_name").on(sql`upper(${table.name})`),
  ],
);

export const warehouseMovementsTable = pgTable(
  "warehouse_movements",
  {
    id: text("id").primaryKey(),
    warehouseId: text("warehouse_id")
      .notNull()
      .references(() => warehousesTable.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("RECARGA"),
    itemId: text("item_id").notNull(),
    quantity: numeric("quantity").notNull().default("0"),
    actorId: text("actor_id").notNull().default(""),
    movementDate: timestamp("movement_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("idx_warehouse_movements_warehouse_date").on(
      table.warehouseId,
      table.movementDate,
    ),
  ],
);

// LEGACY/HISTÓRICO: se conserva para lectura y trazabilidad.
// El stock operativo actual vive únicamente en warehouses.stock + warehouse_movements.
export const inventoryTable = pgTable("inventory", {
  marketId: text("market_id").primaryKey(),
  tastingStock: numeric("tasting_stock").notNull().default("0"),
  redemptionStock: jsonb("redemption_stock")
    .$type<Record<string, number>>()
    .notNull()
    .default({}),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  recordUpdatedAt,
  ...timestamps,
});

// Historial de eventos/canjes/degustaciones. No es fuente de saldo operativo.
export const inventoryMovementsTable = pgTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    marketId: text("market_id").notNull().default(""),
    kind: text("kind").notNull().default(""),
    itemId: text("item_id"),
    quantity: numeric("quantity").notNull().default("0"),
    actorId: text("actor_id").notNull().default(""),
    movementDate: timestamp("movement_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("SINCRONIZADA"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    recordUpdatedAt,
    ...timestamps,
  },
  (table) => [index("idx_movements_date").on(table.movementDate)],
);

export const assignmentsTable = pgTable("assignments", {
  promoterId: text("promoter_id").primaryKey(),
  promoterDni: text("promoter_dni"),
  marketIds: text("market_ids").array().notNull().default([]),
  clientIds: text("client_ids").array().notNull().default([]),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  recordUpdatedAt: timestamp("record_updated_at", { withTimezone: true }),
  ...timestamps,
});

export const sessionClosuresTable = pgTable(
  "session_closures",
  {
    id: text("id").primaryKey(),
    promoterId: text("promoter_id").notNull().default(""),
    marketId: text("market_id").notNull().default(""),
    clientId: text("client_id"),
    tastingUsed: numeric("tasting_used").notNull().default("0"),
    leads: numeric("leads").notNull().default("0"),
    closureDate: timestamp("closure_date", { withTimezone: true })
      .notNull()
      .defaultNow(),
    status: text("status").notNull().default("SINCRONIZADA"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    recordUpdatedAt,
    ...timestamps,
  },
  (table) => [index("idx_closures_date").on(table.closureDate)],
);

export const productPricesTable = pgTable("product_prices", {
  sku: text("sku").primaryKey(),
  product: text("product").notNull().default(""),
  unitsPerPackage: numeric("units_per_package").notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  totalPrice: numeric("total_price", { precision: 14, scale: 2 })
    .notNull()
    .default("0"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  recordUpdatedAt,
  ...timestamps,
});

export const clientCategoriesTable = pgTable("client_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  status: text("status").notNull().default("ACTIVO"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
  recordUpdatedAt,
  ...timestamps,
});
