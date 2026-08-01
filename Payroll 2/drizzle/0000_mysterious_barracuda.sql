CREATE TABLE `attachment_orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text NOT NULL,
	`issuing_authority` text,
	`reference` text,
	`protected_earnings` real DEFAULT 0 NOT NULL,
	`deduction_type` text DEFAULT 'fixed' NOT NULL,
	`deduction_value` real DEFAULT 0 NOT NULL,
	`admin_fee` real DEFAULT 1 NOT NULL,
	`balance` real,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `audit_log` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer,
	`actor` text NOT NULL,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text,
	`before` text,
	`after` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `cis_payments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`subcontractor_id` integer NOT NULL,
	`tax_month` integer NOT NULL,
	`payment_date` text NOT NULL,
	`labour` real DEFAULT 0 NOT NULL,
	`materials` real DEFAULT 0 NOT NULL,
	`vat` real DEFAULT 0 NOT NULL,
	`retention` real DEFAULT 0 NOT NULL,
	`deduction` real DEFAULT 0 NOT NULL,
	`net_payment` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`subcontractor_id`) REFERENCES `subcontractors`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `departments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`name` text NOT NULL,
	`nominal_code` text,
	`cost_centre` text,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`department_id` integer,
	`payroll_id` text NOT NULL,
	`works_number` text,
	`title` text,
	`first_name` text NOT NULL,
	`middle_names` text,
	`last_name` text NOT NULL,
	`date_of_birth` text,
	`gender` text,
	`address` text,
	`postcode` text,
	`email` text,
	`phone` text,
	`ni_number` text,
	`nationality` text,
	`passport_number` text,
	`marital_status` text,
	`job_title` text,
	`start_date` text,
	`leaving_date` text,
	`starter_declaration` text,
	`tax_code` text DEFAULT '1257L' NOT NULL,
	`week1_month1` integer DEFAULT false NOT NULL,
	`ni_category` text DEFAULT 'A' NOT NULL,
	`director` integer DEFAULT false NOT NULL,
	`director_start` text,
	`director_end` text,
	`alternative_director_nic` integer DEFAULT false NOT NULL,
	`no_secondary_nic` integer DEFAULT false NOT NULL,
	`student_loan_plan` text,
	`postgraduate_loan` integer DEFAULT false NOT NULL,
	`pay_basis` text DEFAULT 'period' NOT NULL,
	`annual_salary` real DEFAULT 0 NOT NULL,
	`hourly_rate` real DEFAULT 0 NOT NULL,
	`contracted_hours` real DEFAULT 0 NOT NULL,
	`annual_leave_days` real DEFAULT 28 NOT NULL,
	`payment_method` text DEFAULT 'credit-transfer' NOT NULL,
	`bank_name` text,
	`account_name` text,
	`sort_code` text,
	`account_number` text,
	`irregular_payment` integer DEFAULT false NOT NULL,
	`zero_pay_fps_exclusion` integer DEFAULT false NOT NULL,
	`employee_portal` integer DEFAULT false NOT NULL,
	`confidential` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `employers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`legal_name` text,
	`address` text,
	`postcode` text,
	`paye_reference` text,
	`accounts_office_reference` text,
	`company_number` text,
	`pay_frequency` text DEFAULT 'monthly' NOT NULL,
	`tax_year` text DEFAULT '2026/27' NOT NULL,
	`small_employers_relief` integer DEFAULT false NOT NULL,
	`employment_allowance` integer DEFAULT false NOT NULL,
	`cis_contractor` integer DEFAULT false NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL
);
--> statement-breakpoint
CREATE TABLE `expenses_benefits` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`tax_year` text NOT NULL,
	`category` text NOT NULL,
	`description` text,
	`cash_equivalent` real DEFAULT 0 NOT NULL,
	`payrolled` integer DEFAULT false NOT NULL,
	`class_1a_nic` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `leave_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`type` text NOT NULL,
	`subtype` text,
	`start_date` text NOT NULL,
	`end_date` text NOT NULL,
	`qualifying_days` integer DEFAULT 0 NOT NULL,
	`average_weekly_earnings` real DEFAULT 0 NOT NULL,
	`statutory_amount` real DEFAULT 0 NOT NULL,
	`recovered_amount` real DEFAULT 0 NOT NULL,
	`notes` text,
	`status` text DEFAULT 'calculated' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pay_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pay_run_id` integer NOT NULL,
	`type` text NOT NULL,
	`name` text NOT NULL,
	`quantity` real DEFAULT 1 NOT NULL,
	`rate` real DEFAULT 0 NOT NULL,
	`amount` real DEFAULT 0 NOT NULL,
	`taxable` integer DEFAULT true NOT NULL,
	`nicable` integer DEFAULT true NOT NULL,
	`pensionable` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`pay_run_id`) REFERENCES `pay_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pay_periods` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`tax_year` text NOT NULL,
	`period_number` integer NOT NULL,
	`frequency` text DEFAULT 'monthly' NOT NULL,
	`period_start` text,
	`period_end` text,
	`pay_date` text,
	`status` text DEFAULT 'open' NOT NULL,
	`finalised_at` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pay_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pay_period_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`gross_pay` real DEFAULT 0 NOT NULL,
	`taxable_pay` real DEFAULT 0 NOT NULL,
	`paye_tax` real DEFAULT 0 NOT NULL,
	`employee_nic` real DEFAULT 0 NOT NULL,
	`employer_nic` real DEFAULT 0 NOT NULL,
	`student_loan` real DEFAULT 0 NOT NULL,
	`postgraduate_loan` real DEFAULT 0 NOT NULL,
	`employee_pension` real DEFAULT 0 NOT NULL,
	`employer_pension` real DEFAULT 0 NOT NULL,
	`statutory_pay` real DEFAULT 0 NOT NULL,
	`other_deductions` real DEFAULT 0 NOT NULL,
	`net_pay` real DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`pay_period_id`) REFERENCES `pay_periods`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pension_memberships` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scheme_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`assessment_status` text DEFAULT 'eligible' NOT NULL,
	`membership_status` text DEFAULT 'active' NOT NULL,
	`enrolment_date` text,
	`postponement_end` text,
	`opt_out_date` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`scheme_id`) REFERENCES `pension_schemes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`employee_id`) REFERENCES `employees`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `pension_schemes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`provider` text NOT NULL,
	`scheme_name` text NOT NULL,
	`employer_reference` text,
	`employee_rate` real DEFAULT 5 NOT NULL,
	`employer_rate` real DEFAULT 3 NOT NULL,
	`earnings_basis` text DEFAULT 'qualifying' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `subcontractors` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`name` text NOT NULL,
	`trading_name` text,
	`type` text DEFAULT 'sole-trader' NOT NULL,
	`utr` text,
	`company_number` text,
	`ni_number` text,
	`verification_number` text,
	`deduction_rate` real DEFAULT 20 NOT NULL,
	`verified_at` text,
	`bank_details` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employer_id` integer NOT NULL,
	`pay_period_id` integer,
	`type` text NOT NULL,
	`due_date` text,
	`payload` text,
	`correlation_id` text,
	`ir_mark` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`submitted_at` text,
	`response` text,
	`created_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	`updated_at` text DEFAULT 'CURRENT_TIMESTAMP' NOT NULL,
	FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`pay_period_id`) REFERENCES `pay_periods`(`id`) ON UPDATE no action ON DELETE no action
);
