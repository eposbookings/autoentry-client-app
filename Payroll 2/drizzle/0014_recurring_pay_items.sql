CREATE TABLE `recurring_pay_items` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `employee_id` integer NOT NULL,
  `type` text NOT NULL,
  `name` text NOT NULL,
  `amount` real DEFAULT 0 NOT NULL,
  `taxable` integer DEFAULT true NOT NULL,
  `nicable` integer DEFAULT true NOT NULL,
  `pensionable` integer DEFAULT true NOT NULL,
  `start_period` integer NOT NULL,
  `end_period` integer NOT NULL,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action,
  FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `recurring_pay_items_employer_employee_idx` ON `recurring_pay_items` (`employer_id`,`employee_id`);
--> statement-breakpoint
ALTER TABLE `pay_items` ADD `recurring_item_id` integer REFERENCES `recurring_pay_items`(`id`);
