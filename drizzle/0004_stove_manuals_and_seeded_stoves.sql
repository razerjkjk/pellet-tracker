ALTER TABLE stoves ADD COLUMN manual_url TEXT;
--> statement-breakpoint
INSERT INTO stoves (name, location, manual_url, created_at) VALUES
  ('Pellet Pro (PelPro)', NULL, 'https://downloads.hearthnhome.com/installManuals/8390-900_PP130-C_Owners.pdf', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('Pellet King (King)', NULL, 'https://manuals.stove-parts-unlimited.com/pellet/king/king-kp60-owners-manual-owners-manual.pdf', CAST(strftime('%s','now') AS INTEGER) * 1000);
--> statement-breakpoint
INSERT INTO maintenance_tasks (stove_id, title, interval_days, notes, created_at)
SELECT id, 'Regular clean — burn pot, ash pan, burn grate', 3, 'Regular clean reminder. Change the interval if this stove needs it more or less often.', CAST(strftime('%s','now') AS INTEGER) * 1000 FROM stoves WHERE name IN ('Pellet Pro (PelPro)', 'Pellet King (King)');
--> statement-breakpoint
INSERT INTO maintenance_tasks (stove_id, title, interval_days, notes, created_at)
SELECT id, 'Deep clean — heat exchanger and venting', 30, 'Thorough cleaning including the heat exchanger and venting.', CAST(strftime('%s','now') AS INTEGER) * 1000 FROM stoves WHERE name IN ('Pellet Pro (PelPro)', 'Pellet King (King)');
--> statement-breakpoint
INSERT INTO maintenance_tasks (stove_id, title, interval_days, notes, created_at)
SELECT id, 'Annual servicing', 365, 'Annual professional service.', CAST(strftime('%s','now') AS INTEGER) * 1000 FROM stoves WHERE name IN ('Pellet Pro (PelPro)', 'Pellet King (King)');
