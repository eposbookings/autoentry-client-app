ALTER TABLE `employer_settings` ADD `accounting_default_wages_code` text DEFAULT 'WAGES' NOT NULL;
ALTER TABLE `employer_settings` ADD `accounting_control_code` text DEFAULT 'CTRL' NOT NULL;
ALTER TABLE `employer_settings` ADD `accounting_paye_code` text DEFAULT 'TAX' NOT NULL;
ALTER TABLE `employer_settings` ADD `accounting_nic_code` text DEFAULT 'NIC' NOT NULL;
ALTER TABLE `employer_settings` ADD `accounting_pension_code` text DEFAULT 'PENS' NOT NULL;
ALTER TABLE `employer_settings` ADD `accounting_other_deductions_code` text DEFAULT 'OTHER' NOT NULL;
ALTER TABLE `employer_settings` ADD `accounting_employer_nic_expense_code` text DEFAULT 'ERNIC' NOT NULL;
ALTER TABLE `employer_settings` ADD `accounting_employer_pension_expense_code` text DEFAULT 'ERPENS' NOT NULL;
