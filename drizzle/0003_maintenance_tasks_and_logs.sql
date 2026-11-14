CREATE TABLE maintenance_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stove_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  interval_days INTEGER,
  notes TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (stove_id) REFERENCES stoves(id)
);
--> statement-breakpoint
CREATE TABLE maintenance_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (task_id) REFERENCES maintenance_tasks(id)
);
