CREATE TABLE `employer_calendar_days` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `tax_year` text NOT NULL,
  `date` text NOT NULL,
  `name` text NOT NULL,
  `type` text DEFAULT 'national-holiday' NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employer_calendar_days_employer_date_type_unique` ON `employer_calendar_days` (`employer_id`,`date`,`type`);
--> statement-breakpoint
ALTER TABLE `leave_events` ADD `excluded_calendar_dates` text DEFAULT '[]' NOT NULL;
