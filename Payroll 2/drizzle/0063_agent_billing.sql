CREATE TABLE `agent_profiles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `firm_name` text NOT NULL,
  `contact_name` text NOT NULL,
  `email` text NOT NULL,
  `phone` text,
  `address` text,
  `postcode` text,
  `agent_reference` text,
  `vat_registration_number` text,
  `default_vat_rate` real DEFAULT 20 NOT NULL,
  `payment_terms_days` integer DEFAULT 14 NOT NULL,
  `invoice_prefix` text DEFAULT 'PAY' NOT NULL,
  `next_invoice_number` integer DEFAULT 1 NOT NULL,
  `bank_payment_details` text,
  `payslip_footer` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_profiles_employer_unique` ON `agent_profiles` (`employer_id`);
--> statement-breakpoint
CREATE TABLE `agent_charges` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `charge_code` text NOT NULL,
  `description` text NOT NULL,
  `billing_basis` text DEFAULT 'fixed' NOT NULL,
  `unit_rate` real DEFAULT 0 NOT NULL,
  `vat_rate` real DEFAULT 20 NOT NULL,
  `effective_from` text,
  `effective_to` text,
  `status` text DEFAULT 'active' NOT NULL,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_charges_employer_code_unique` ON `agent_charges` (`employer_id`,`charge_code`);
--> statement-breakpoint
CREATE TABLE `agent_invoices` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL,
  `invoice_number` text NOT NULL,
  `invoice_date` text NOT NULL,
  `period_start` text NOT NULL,
  `period_end` text NOT NULL,
  `due_date` text NOT NULL,
  `status` text DEFAULT 'draft' NOT NULL,
  `payslip_count` integer DEFAULT 0 NOT NULL,
  `payroll_period_count` integer DEFAULT 0 NOT NULL,
  `employee_count` integer DEFAULT 0 NOT NULL,
  `submission_count` integer DEFAULT 0 NOT NULL,
  `net_amount` real DEFAULT 0 NOT NULL,
  `vat_amount` real DEFAULT 0 NOT NULL,
  `gross_amount` real DEFAULT 0 NOT NULL,
  `line_items` text DEFAULT '[]' NOT NULL,
  `source_evidence` text DEFAULT '{}' NOT NULL,
  `source_checksum` text NOT NULL,
  `issued_at` text,
  `voided_at` text,
  `void_reason` text,
  `created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  `updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_invoices_employer_number_unique` ON `agent_invoices` (`employer_id`,`invoice_number`);
