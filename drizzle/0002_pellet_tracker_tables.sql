DROP TABLE IF EXISTS entries;
--> statement-breakpoint
CREATE TABLE stoves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  location TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  brand TEXT,
  store TEXT,
  bags REAL NOT NULL,
  total_cost_cents INTEGER,
  lbs_per_bag REAL,
  notes TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE burn_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stove_id INTEGER,
  date TEXT NOT NULL,
  bags REAL NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (stove_id) REFERENCES stoves(id)
);
--> statement-breakpoint
CREATE TABLE adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  bags_delta REAL NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE TABLE settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  manual_burn_rate REAL,
  burn_window_days INTEGER NOT NULL DEFAULT 30,
  low_stock_days INTEGER NOT NULL DEFAULT 7,
  target_date TEXT,
  safety_bags REAL NOT NULL DEFAULT 0
);
--> statement-breakpoint
INSERT INTO settings (id, manual_burn_rate, burn_window_days, low_stock_days, target_date, safety_bags) VALUES (1, NULL, 30, 7, NULL, 0);
