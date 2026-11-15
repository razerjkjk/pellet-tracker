import { index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/** Accounts. Passwords are stored only as argon2id hashes (Bun.password).
 *  Every row in the data tables below belongs to one account via `userId`;
 *  rows with `userId` NULL are the seeded factory catalog templates, which
 *  are copied into each new account at signup and never shown to anyone. */
export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** Lowercased on signup; unique. */
    email: text("email").notNull(),
    /** First name, shown in the header once signed in. */
    name: text("name").notNull(),
    /** Dance-off board opt-in. Off by default; nothing about the account
     *  shows on the board until the user turns it on themselves. */
    danceOffOptIn: integer("dance_off_opt_in", { mode: "boolean" }).notNull().default(false),
    passwordHash: text("password_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
  },
  (t) => [uniqueIndex("users_email_idx").on(t.email)],
);

/** Cookie sessions. Only a SHA-256 hash of the token is stored; the raw
 *  token lives only in the user's HttpOnly cookie. */
export const sessions = sqliteTable(
  "sessions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    tokenHash: text("token_hash").notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
  },
  (t) => [
    uniqueIndex("sessions_token_hash_idx").on(t.tokenHash),
    index("sessions_user_id_idx").on(t.userId),
  ],
);

export const stoves = sqliteTable("stoves", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
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
  userId: integer("user_id"),
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
  userId: integer("user_id"),
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
  userId: integer("user_id"),
  stoveId: integer("stove_id"),
  date: text("date").notNull(),
  bags: real("bags").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const adjustments = sqliteTable("adjustments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  date: text("date").notNull(),
  bagsDelta: real("bags_delta").notNull(),
  reason: text("reason"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const settings = sqliteTable("settings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  manualBurnRate: real("manual_burn_rate"),
  burnWindowDays: integer("burn_window_days").notNull().default(30),
  lowStockDays: integer("low_stock_days").notNull().default(7),
  targetDate: text("target_date"),
  safetyBags: real("safety_bags").notNull().default(0),
  /** Heating season end, month-day ("04-15"). Drives the race to spring. */
  seasonEnd: text("season_end").notNull().default("04-15"),
});

export const maintenanceTasks = sqliteTable("maintenance_tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  stoveId: integer("stove_id").notNull(),
  title: text("title").notNull(),
  intervalDays: integer("interval_days"),
  notes: text("notes"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

export const maintenanceLogs = sqliteTable("maintenance_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id"),
  taskId: integer("task_id").notNull(),
  date: text("date").notNull(),
  note: text("note"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});
