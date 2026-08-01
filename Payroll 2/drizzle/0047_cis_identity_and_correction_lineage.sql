ALTER TABLE `cis_payments` ADD `subcontractor_name` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `subcontractor_type` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `subcontractor_utr` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `subcontractor_ni_number` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `subcontractor_company_number` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `subcontractor_partner_utr` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `replaces_payment_id` integer REFERENCES `cis_payments`(`id`);
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `void_reason` text;
--> statement-breakpoint
UPDATE `cis_payments`
SET `subcontractor_name` = (SELECT `name` FROM `subcontractors` WHERE `subcontractors`.`id` = `cis_payments`.`subcontractor_id`),
    `subcontractor_type` = (SELECT `type` FROM `subcontractors` WHERE `subcontractors`.`id` = `cis_payments`.`subcontractor_id`),
    `subcontractor_utr` = (SELECT `utr` FROM `subcontractors` WHERE `subcontractors`.`id` = `cis_payments`.`subcontractor_id`),
    `subcontractor_ni_number` = (SELECT `ni_number` FROM `subcontractors` WHERE `subcontractors`.`id` = `cis_payments`.`subcontractor_id`),
    `subcontractor_company_number` = (SELECT `company_number` FROM `subcontractors` WHERE `subcontractors`.`id` = `cis_payments`.`subcontractor_id`),
    `subcontractor_partner_utr` = (SELECT `partner_utr` FROM `subcontractors` WHERE `subcontractors`.`id` = `cis_payments`.`subcontractor_id`);
--> statement-breakpoint
CREATE INDEX `cis_payments_replaces_payment_idx` ON `cis_payments` (`replaces_payment_id`);
