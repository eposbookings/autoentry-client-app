ALTER TABLE `recurring_pay_items` ADD `tax_year` text DEFAULT '2026/27' NOT NULL;
CREATE INDEX `recurring_pay_items_employer_year_employee_idx`
  ON `recurring_pay_items` (`employer_id`, `tax_year`, `employee_id`);
