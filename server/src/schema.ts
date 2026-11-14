import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const stoves = sqliteTable("stoves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  location: text("location"),
  manualUrl: text("manual_url"),
  details: text("details"),
  factoryName: text("factory_name"),
  factoryPhone: text("factory_phone"),
  factoryEmail: text("factory_email"),
  troubleshootingUrl: text("troubleshooting_url"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const troubleshootingItems = sqliteTable("troubleshooting_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stoveId: integer("stove_id").notNull(),
  category: text("category").notNull(), // 'error_code' | 'symptom'
  codeLabel: text("code_label"),
  title: text("title").notNull(),
  cause: text("cause"),
  fix: text("fix").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const purchases = sqliteTable("purchases", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  brand: text("brand"),
  store: text("store"),
  bags: real("bags").notNull(),
  totalCostCents: integer("total_cost_cents"),
  lbsPerBag: real("lbs_per_bag"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const burnLogs = sqliteTable("burn_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stoveId: integer("stove_id"),
  date: text("date").notNull(),
  bags: real("bags").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const adjustments = sqliteTable("adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  date: text("date").notNull(),
  bagsDelta: real("bags_delta").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey(),
  manualBurnRate: real("manual_burn_rate"),
  burnWindowDays: integer("burn_window_days").notNull().default(30),
  lowStockDays: integer("low_stock_days").notNull().default(7),
  targetDate: text("target_date"),
  safetyBags: real("safety_bags").notNull().default(0),
});

export const maintenanceTasks = sqliteTable("maintenance_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stoveId: integer("stove_id").notNull(),
  title: text("title").notNull(),
  intervalDays: integer("interval_days"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const maintenanceLogs = sqliteTable("maintenance_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id").notNull(),
  date: text("date").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
