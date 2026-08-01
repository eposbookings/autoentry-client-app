CREATE UNIQUE INDEX IF NOT EXISTS `pay_periods_employer_tax_year_period_unique`
ON `pay_periods` (`employer_id`, `tax_year`, `period_number`);
