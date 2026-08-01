ALTER TABLE `expenses_benefits` ADD `p11d_section` text;
--> statement-breakpoint
ALTER TABLE `expenses_benefits` ADD `nic_treatment` text NOT NULL DEFAULT 'class-1a';
--> statement-breakpoint
UPDATE `expenses_benefits` SET `p11d_section` = CASE
  WHEN `category` = 'Living accommodation' THEN 'D'
  WHEN `category` = 'Company car' THEN 'F'
  WHEN `category` = 'Company van' THEN 'G'
  WHEN `category` = 'Beneficial loan' THEN 'H'
  WHEN `category` = 'Private medical insurance' THEN 'I'
  ELSE 'M'
END
WHERE `p11d_section` IS NULL;
