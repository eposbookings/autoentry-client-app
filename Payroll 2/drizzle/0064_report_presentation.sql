ALTER TABLE `employer_settings` ADD `report_accent_colour` text DEFAULT '#087b79' NOT NULL;
--> statement-breakpoint
ALTER TABLE `employer_settings` ADD `report_header_text` text;
--> statement-breakpoint
ALTER TABLE `employer_settings` ADD `report_footer_text` text;
--> statement-breakpoint
ALTER TABLE `employer_settings` ADD `report_stationery_mode` text DEFAULT 'standard' NOT NULL;
