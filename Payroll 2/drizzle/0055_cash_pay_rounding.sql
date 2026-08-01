CREATE TABLE `employee_pay_rounding` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `employee_id` integer NOT NULL,
  `unit` real DEFAULT 1 NOT NULL,
  `carry` real DEFAULT 0 NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`),
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_pay_rounding_employer_employee_unique` ON `employee_pay_rounding` (`employer_id`,`employee_id`);
--> statement-breakpoint
CREATE TABLE `pay_rounding_entries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employee_pay_rounding_id` integer NOT NULL,
  `pay_run_id` integer NOT NULL,
  `unrounded_net` real NOT NULL,
  `opening_carry` real NOT NULL,
  `rounded_net` real NOT NULL,
  `closing_carry` real NOT NULL,
  `adjustment` real NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employee_pay_rounding_id`) REFERENCES `employee_pay_rounding`(`id`),
  FOREIGN KEY (`pay_run_id`) REFERENCES `pay_runs`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pay_rounding_entries_setting_run_unique` ON `pay_rounding_entries` (`employee_pay_rounding_id`,`pay_run_id`);
