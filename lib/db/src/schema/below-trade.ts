import {
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const marketsTable = pgTable("markets", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  region: text("region"),
  department: text("department"),
  province: text("province"),
  district: text("district"),
  status: text("status").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
});

export const usersTable = pgTable("users", {
  id: text("id").primaryKey(),
  dni: text("dni").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull(),
  status: text("status").notNull(),
  passwordHash: text("password_hash"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
}, (table) => [uniqueIndex("users_dni_unique").on(table.dni)]);

export const clientsTable = pgTable("clients", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  name: text("name").notNull(),
  marketId: text("market_id").notNull(),
  status: text("status").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
});

export const salesTable = pgTable("sales", {
  id: text("id").primaryKey(),
  promoterId: text("promoter_id").notNull(),
  clientId: text("client_id").notNull(),
  marketId: text("market_id").notNull(),
  mode: text("mode").notNull(),
  units: integer("units").notNull().default(0),
  amountSoles: numeric("amount_soles", { precision: 12, scale: 2 }).notNull().default("0"),
  weightKg: numeric("weight_kg", { precision: 12, scale: 3 }),
  saleDate: timestamp("sale_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  receiptPhoto: text("receipt_photo"),
  exchangePhoto: text("exchange_photo"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
});

export const attendanceTable = pgTable("attendance", {
  id: text("id").primaryKey(),
  promoterId: text("promoter_id").notNull(),
  clientId: text("client_id").notNull(),
  marketId: text("market_id").notNull(),
  eventType: text("event_type").notNull(),
  eventDate: timestamp("event_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  photo: text("photo"),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
});

export const inventoryTable = pgTable("inventory", {
  marketId: text("market_id").primaryKey(),
  tastingStock: integer("tasting_stock").notNull().default(0),
  redemptionStock: jsonb("redemption_stock").$type<Record<string, number>>().notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
});

export const inventoryMovementsTable = pgTable("inventory_movements", {
  id: text("id").primaryKey(),
  marketId: text("market_id").notNull(),
  kind: text("kind").notNull(),
  itemId: text("item_id"),
  quantity: integer("quantity").notNull(),
  actorId: text("actor_id").notNull(),
  movementDate: timestamp("movement_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
});

export const assignmentsTable = pgTable("assignments", {
  promoterId: text("promoter_id").primaryKey(),
  promoterDni: text("promoter_dni"),
  marketIds: text("market_ids").array().notNull(),
  clientIds: text("client_ids").array().notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at").notNull(),
  ...timestamps,
});

export const sessionClosuresTable = pgTable("session_closures", {
  id: text("id").primaryKey(),
  promoterId: text("promoter_id").notNull(),
  marketId: text("market_id").notNull(),
  clientId: text("client_id"),
  tastingUsed: integer("tasting_used").notNull().default(0),
  leads: integer("leads").notNull().default(0),
  closureDate: timestamp("closure_date", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at"),
  ...timestamps,
});

export const productPricesTable = pgTable("product_prices", {
  sku: text("sku").primaryKey(),
  product: text("product").notNull(),
  unitsPerPackage: integer("units_per_package").notNull().default(0),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  totalPrice: numeric("total_price", { precision: 12, scale: 2 }).notNull(),
  data: jsonb("data").$type<Record<string, unknown>>().notNull(),
  recordUpdatedAt: text("record_updated_at").notNull(),
  ...timestamps,
});