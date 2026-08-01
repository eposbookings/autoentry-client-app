CREATE TABLE `payroll_versions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `label` text NOT NULL,
  `notes` text,
  `backup_payload` text NOT NULL,
  `backup_checksum` text NOT NULL,
  `schema_version` integer NOT NULL,
  `record_count` integer NOT NULL,
  `employee_count` integer NOT NULL,
  `pay_period_count` integer NOT NULL,
  `finalised_period_count` integer NOT NULL,
  `created_by` text NOT NULL,
  `restored_at` text,
  `restored_by` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payroll_versions_employer_created_idx` ON `payroll_versions` (`employer_id`,`created_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `payroll_versions_employer_checksum_unique` ON `payroll_versions` (`employer_id`,`backup_checksum`);
