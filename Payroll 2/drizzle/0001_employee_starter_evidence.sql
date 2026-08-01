ALTER TABLE `employees` ADD `starter_evidence` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `p45_leaving_date` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `p45_previous_pay` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `employees` ADD `p45_previous_tax` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `employees` ADD `p60_tax_year` text;
