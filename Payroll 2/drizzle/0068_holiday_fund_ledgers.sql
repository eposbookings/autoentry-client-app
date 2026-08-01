CREATE TABLE `holiday_fund_settings` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `employee_id` integer NOT NULL,
  `scheme_type` text NOT NULL,
  `worker_type` text NOT NULL,
  `accrual_rate` real DEFAULT 0 NOT NULL,
  `opening_balance` real DEFAULT 0 NOT NULL,
  `current_balance` real DEFAULT 0 NOT NULL,
  `contract_confirmed` integer DEFAULT false NOT NULL,
  `start_date` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_fund_settings_employer_employee_unique` ON `holiday_fund_settings` (`employer_id`,`employee_id`);
--> statement-breakpoint
CREATE TABLE `holiday_fund_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `employee_id` integer NOT NULL,
  `holiday_fund_setting_id` integer NOT NULL,
  `pay_run_id` integer,
  `pay_period_id` integer NOT NULL,
  `tax_year` text NOT NULL,
  `period_number` integer NOT NULL,
  `scheme_type` text NOT NULL,
  `worker_type` text NOT NULL,
  `contract_confirmed` integer DEFAULT false NOT NULL,
  `accrual_rate` real DEFAULT 0 NOT NULL,
  `manual_added` real DEFAULT 0 NOT NULL,
  `requested_paid` real DEFAULT 0 NOT NULL,
  `reference_pay_override` real,
  `accrual_base` real DEFAULT 0 NOT NULL,
  `added_amount` real DEFAULT 0 NOT NULL,
  `paid_amount` real DEFAULT 0 NOT NULL,
  `balance_before` real DEFAULT 0 NOT NULL,
  `balance_after` real DEFAULT 0 NOT NULL,
  `taxable_pay` real DEFAULT 0 NOT NULL,
  `nicable_pay` real DEFAULT 0 NOT NULL,
  `post_tax_deduction` real DEFAULT 0 NOT NULL,
  `source_checksum` text,
  `status` text DEFAULT 'draft' NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`holiday_fund_setting_id`) REFERENCES `holiday_fund_settings`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pay_run_id`) REFERENCES `pay_runs`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pay_period_id`) REFERENCES `pay_periods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_fund_entries_setting_period_unique` ON `holiday_fund_entries` (`holiday_fund_setting_id`,`pay_period_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `holiday_fund_entries_setting_run_unique` ON `holiday_fund_entries` (`holiday_fund_setting_id`,`pay_run_id`);
--> statement-breakpoint
CREATE INDEX `holiday_fund_entries_employer_period_idx` ON `holiday_fund_entries` (`employer_id`,`tax_year`,`period_number`);
