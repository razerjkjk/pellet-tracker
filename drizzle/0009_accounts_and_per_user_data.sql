CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX users_email_idx ON users(email);
--> statement-breakpoint
CREATE TABLE sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX sessions_token_hash_idx ON sessions(token_hash);
--> statement-breakpoint
CREATE INDEX sessions_user_id_idx ON sessions(user_id);
--> statement-breakpoint
ALTER TABLE stoves ADD COLUMN user_id INTEGER;
--> statement-breakpoint
ALTER TABLE troubleshooting_items ADD COLUMN user_id INTEGER;
--> statement-breakpoint
ALTER TABLE purchases ADD COLUMN user_id INTEGER;
--> statement-breakpoint
ALTER TABLE burn_logs ADD COLUMN user_id INTEGER;
--> statement-breakpoint
ALTER TABLE adjustments ADD COLUMN user_id INTEGER;
--> statement-breakpoint
ALTER TABLE maintenance_tasks ADD COLUMN user_id INTEGER;
--> statement-breakpoint
ALTER TABLE maintenance_logs ADD COLUMN user_id INTEGER;
--> statement-breakpoint
CREATE INDEX stoves_user_id_idx ON stoves(user_id);
--> statement-breakpoint
CREATE INDEX troubleshooting_items_user_id_idx ON troubleshooting_items(user_id);
--> statement-breakpoint
CREATE INDEX purchases_user_id_idx ON purchases(user_id);
--> statement-breakpoint
CREATE INDEX burn_logs_user_id_idx ON burn_logs(user_id);
--> statement-breakpoint
CREATE INDEX adjustments_user_id_idx ON adjustments(user_id);
--> statement-breakpoint
CREATE INDEX maintenance_tasks_user_id_idx ON maintenance_tasks(user_id);
--> statement-breakpoint
CREATE INDEX maintenance_logs_user_id_idx ON maintenance_logs(user_id);
--> statement-breakpoint
CREATE TABLE settings_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  manual_burn_rate REAL,
  burn_window_days INTEGER NOT NULL DEFAULT 30,
  low_stock_days INTEGER NOT NULL DEFAULT 7,
  target_date TEXT,
  safety_bags REAL NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO settings_new (id, user_id, manual_burn_rate, burn_window_days, low_stock_days, target_date, safety_bags)
SELECT id, NULL, manual_burn_rate, burn_window_days, low_stock_days, target_date, safety_bags FROM settings;
--> statement-breakpoint
DROP TABLE settings;
--> statement-breakpoint
ALTER TABLE settings_new RENAME TO settings;
--> statement-breakpoint
CREATE INDEX settings_user_id_idx ON settings(user_id);
