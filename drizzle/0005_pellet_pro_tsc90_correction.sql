ALTER TABLE stoves ADD COLUMN details TEXT;
--> statement-breakpoint
UPDATE stoves SET name = 'Pellet Pro TSC90', manual_url = 'https://manualmachine.com/pelpro/tsc90/22377855-user-manual/', details = 'Cast iron pellet stove, 90-pound hopper' WHERE name = 'Pellet Pro (PelPro)' OR manual_url = 'https://downloads.hearthnhome.com/installManuals/8390-900_PP130-C_Owners.pdf';
