import {
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

const recordUpdatedAt = () => timestamp("record_updated_at", { withTimezone: true });

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
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
    ...timestamps,
  },
  (table) => [
    primaryKey({ columns: [table.collection, table.recordId] }),
  ],
);

export const warehousesTable = pgTable(
  "warehouses",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    location: text("location"),
    status: text("status").notNull().default("ACTIVO"),
    marketIds: text("market_ids").array().notNull(),
    stock: jsonb("stock").$type<Record<string, number>>().notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("idx_warehouses_name").on(table.name)],
);

export const marketsTable = pgTable("markets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  region: text("region"),
  department: text("department"),
  province: text("province"),
  district: text("district"),
  status: text("status").notNull(),
  warehouseId: text("warehouse_id").references(() => warehousesTable.id, {
    onDelete: "set null",
  }),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const usersTable = pgTable(
  "users",
  {
    id: text("id").primaryKey(),
    dni: text("dni").notNull(),
    name: text("name").notNull(),
    role: text("role").notNull(),
    status: text("status").notNull(),
    passwordHash: text("password_hash"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    recordUpdatedAt: recordUpdatedAt(),
    ...timestamps,
  },
  (table) => [uniqueIndex("users_dni_unique").on(table.dni)],
);

export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  marketId: text("market_id")
    .notNull()
    .references(() => marketsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const productPricesTable = pgTable("product_prices", {
  sku: text("sku").primaryKey(),
  product: text("product").notNull(),
  unitsPerPackage: numeric("units_per_package").notNull().default("0"),
  unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
  totalPrice: numeric("total_price", { precision: 14, scale: 2 }).notNull().default("0"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const salesTable = pgTable("sales", {
  id: text("id").primaryKey(),
  promoterId: text("promoter_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "restrict" }),
  marketId: text("market_id")
    .notNull()
    .references(() => marketsTable.id, { onDelete: "restrict" }),
  mode: text("mode").notNull(),
  units: numeric("units").notNull().default("0"),
  amountSoles: numeric("amount_soles", { precision: 14, scale: 2 }).notNull().default("0"),
  weightKg: numeric("weight_kg", { precision: 14, scale: 3 }),
  saleDate: timestamp("sale_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  receiptPhoto: text("receipt_photo"),
  exchangePhoto: text("exchange_photo"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const saleItemsTable = pgTable(
  "sale_items",
  {
    saleId: text("sale_id")
      .notNull()
      .references(() => salesTable.id, { onDelete: "cascade" }),
    lineNo: integer("line_no").notNull(),
    productSku: text("product_sku").references(() => productPricesTable.sku, {
      onDelete: "set null",
      onUpdate: "cascade",
    }),
    productName: text("product_name").notNull(),
    brand: text("brand"),
    presentation: text("presentation"),
    units: numeric("units").notNull().default("0"),
    unitPrice: numeric("unit_price", { precision: 14, scale: 2 }).notNull().default("0"),
    amountSoles: numeric("amount_soles", { precision: 14, scale: 2 }).notNull().default("0"),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    ...timestamps,
  },
  (table) => [primaryKey({ columns: [table.saleId, table.lineNo] })],
);

export const tradeApprovalsTable = pgTable("trade_approvals", {
  id: text("id").primaryKey(),
  promoterId: text("promoter_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "restrict" }),
  marketId: text("market_id")
    .notNull()
    .references(() => marketsTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("PENDIENTE"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  resolvedBy: text("resolved_by"),
  resolutionComment: text("resolution_comment"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

export const attendanceTable = pgTable("attendance", {
  id: text("id").primaryKey(),
  promoterId: text("promoter_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  clientId: text("client_id")
    .notNull()
    .references(() => clientsTable.id, { onDelete: "restrict" }),
  marketId: text("market_id")
    .notNull()
    .references(() => marketsTable.id, { onDelete: "restrict" }),
  eventType: text("event_type").notNull(),
  eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  photo: text("photo"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const warehouseMovementsTable = pgTable("warehouse_movements", {
  id: text("id").primaryKey(),
  warehouseId: text("warehouse_id")
    .notNull()
    .references(() => warehousesTable.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(),
  itemId: text("item_id").notNull(),
  quantity: numeric("quantity").notNull().default("0"),
  actorId: text("actor_id").notNull(),
  movementDate: timestamp("movement_date", { withTimezone: true }).notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const inventoryTable = pgTable("inventory", {
  marketId: text("market_id").primaryKey(),
  tastingStock: numeric("tasting_stock").notNull().default("0"),
  redemptionStock: jsonb("redemption_stock").$type<Record<string, number>>().notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const inventoryMovementsTable = pgTable("inventory_movements", {
  id: text("id").primaryKey(),
  marketId: text("market_id").notNull(),
  kind: text("kind").notNull(),
  itemId: text("item_id"),
  quantity: numeric("quantity").notNull().default("0"),
  actorId: text("actor_id").notNull(),
  movementDate: timestamp("movement_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const assignmentsTable = pgTable("assignments", {
  promoterId: text("promoter_id")
    .primaryKey()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  promoterDni: text("promoter_dni"),
  marketIds: text("market_ids").array().notNull(),
  clientIds: text("client_ids").array().notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const sessionClosuresTable = pgTable("session_closures", {
  id: text("id").primaryKey(),
  promoterId: text("promoter_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "restrict" }),
  marketId: text("market_id")
    .notNull()
    .references(() => marketsTable.id, { onDelete: "restrict" }),
  clientId: text("client_id").references(() => clientsTable.id, {
    onDelete: "restrict",
  }),
  tastingUsed: numeric("tasting_used").notNull().default("0"),
  leads: numeric("leads").notNull().default("0"),
  closureDate: timestamp("closure_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});

export const clientCategoriesTable = pgTable("client_categories", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  status: text("status").notNull().default("ACTIVO"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: recordUpdatedAt(),
  ...timestamps,
});
