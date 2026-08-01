ALTER TABLE `employees` ADD `reported_pay_frequency` text DEFAULT 'monthly' NOT NULL;
ALTER TABLE `employees` ADD `workplace_postcode` text;
ALTER TABLE `employees` ADD `previous_payroll_id` text;
ALTER TABLE `employees` ADD `payment_to_body` integer DEFAULT false NOT NULL;
ALTER TABLE `employees` ADD `trivial_commutation` integer DEFAULT false NOT NULL;
ALTER TABLE `employees` ADD `flexible_drawdown` integer DEFAULT false NOT NULL;
