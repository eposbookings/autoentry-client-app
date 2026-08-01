ALTER TABLE `payroll_opening_balances`
  ADD COLUMN `nic_category_breakdown` text DEFAULT '[]' NOT NULL;
