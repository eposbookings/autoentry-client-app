CREATE TABLE `employee_change_requests` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL REFERENCES `employers`(`id`),
  `employee_id` integer NOT NULL REFERENCES `employees`(`id`),
  `request_type` text NOT NULL,
  `proposed_changes` text NOT NULL,
  `previous_values` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `employee_note` text,
  `reviewed_by` integer REFERENCES `admin_users`(`id`),
  `reviewed_at` text,
  `review_note` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `employee_change_requests_employer_status_idx` ON `employee_change_requests` (`employer_id`,`status`);
CREATE INDEX `employee_change_requests_employee_idx` ON `employee_change_requests` (`employee_id`);
