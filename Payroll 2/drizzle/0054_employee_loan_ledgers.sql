CREATE TABLE `employee_loans` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `employee_id` integer NOT NULL,
  `type` text NOT NULL,
  `reference` text NOT NULL,
  `original_amount` real NOT NULL,
  `balance` real NOT NULL,
  `regular_deduction` real NOT NULL,
  `start_date` text NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`),
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_loans_employer_reference_unique` ON `employee_loans` (`employer_id`,`reference`);
--> statement-breakpoint
CREATE TABLE `employee_loan_deductions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employee_loan_id` integer NOT NULL,
  `pay_run_id` integer NOT NULL,
  `amount` real NOT NULL,
  `balance_before` real NOT NULL,
  `balance_after` real NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employee_loan_id`) REFERENCES `employee_loans`(`id`),
  FOREIGN KEY (`pay_run_id`) REFERENCES `pay_runs`(`id`)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `employee_loan_deductions_loan_run_unique` ON `employee_loan_deductions` (`employee_loan_id`,`pay_run_id`);
