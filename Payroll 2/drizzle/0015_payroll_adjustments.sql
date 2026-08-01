CREATE TABLE `payroll_adjustments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `employee_id` integer NOT NULL,
  `pay_period_id` integer NOT NULL,
  `type` text NOT NULL,
  `amount` real NOT NULL,
  `reason` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_by` text NOT NULL,
  `reversed_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`pay_period_id`) REFERENCES `pay_periods`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `payroll_adjustments_employer_period_employee_idx` ON `payroll_adjustments` (`employer_id`,`pay_period_id`,`employee_id`);
