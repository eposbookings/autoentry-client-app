CREATE TABLE `attachment_order_deductions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `attachment_order_id` integer NOT NULL,
  `pay_run_id` integer NOT NULL,
  `deduction` real DEFAULT 0 NOT NULL,
  `admin_fee` real DEFAULT 0 NOT NULL,
  `balance_after` real,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`attachment_order_id`) REFERENCES `attachment_orders`(`id`),
  FOREIGN KEY (`pay_run_id`) REFERENCES `pay_runs`(`id`)
);
