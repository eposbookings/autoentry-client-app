CREATE TABLE `hmrc_notices` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`employee_id` integer,
	`type` text NOT NULL,
	`notice_identifier` text NOT NULL,
	`tax_year` text NOT NULL,
	`issued_date` text NOT NULL,
	`effective_date` text NOT NULL,
	`tax_code` text,
	`week1_month1` integer DEFAULT false NOT NULL,
	`loan_action` text,
	`student_loan_plan` text,
	`postgraduate_loan` integer DEFAULT false NOT NULL,
	`ni_number` text,
	`message` text,
	`source` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'new' NOT NULL,
	`applied_at` text,
	`ignored_at` text,
	`payload` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `hmrc_notices_employer_status_idx` ON `hmrc_notices` (`employer_id`,`status`);
--> statement-breakpoint
CREATE UNIQUE INDEX `hmrc_notices_employer_identifier_idx` ON `hmrc_notices` (`employer_id`,`notice_identifier`);
