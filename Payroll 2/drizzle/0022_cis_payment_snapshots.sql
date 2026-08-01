ALTER TABLE `cis_payments` ADD `tax_year` text DEFAULT '2026/27' NOT NULL;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `deduction_rate` real DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `verification_number` text;
--> statement-breakpoint
UPDATE `cis_payments`
SET `tax_year` = CASE
  WHEN substr(`payment_date`, 6, 5) >= '04-06'
    THEN substr(`payment_date`, 1, 4) || '/' || printf('%02d', CAST(substr(`payment_date`, 1, 4) AS integer) + 1 - 2000)
  ELSE printf('%04d', CAST(substr(`payment_date`, 1, 4) AS integer) - 1) || '/' || substr(`payment_date`, 3, 2)
END,
`deduction_rate` = CASE
  WHEN `labour` > 0 THEN round((`deduction` / `labour`) * 100, 2)
  ELSE 0
END,
`verification_number` = (
  SELECT `verification_number`
  FROM `subcontractors`
  WHERE `subcontractors`.`id` = `cis_payments`.`subcontractor_id`
);
--> statement-breakpoint
CREATE INDEX `cis_payments_tax_year_month_idx` ON `cis_payments` (`tax_year`, `tax_month`);
