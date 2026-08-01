CREATE TABLE `hmrc_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`tax_year` text NOT NULL,
	`tax_month` integer NOT NULL,
	`payment_date` text NOT NULL,
	`kind` text DEFAULT 'payment' NOT NULL,
	`amount` real NOT NULL,
	`reference` text NOT NULL,
	`method` text DEFAULT 'bank-transfer' NOT NULL,
	`notes` text,
	`status` text DEFAULT 'recorded' NOT NULL,
	`voided_at` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hmrc_payments_employer_period_idx` ON `hmrc_payments` (`employer_id`,`tax_year`,`tax_month`);
--> statement-breakpoint
CREATE UNIQUE INDEX `hmrc_payments_employer_reference_idx` ON `hmrc_payments` (`employer_id`,`reference`);
