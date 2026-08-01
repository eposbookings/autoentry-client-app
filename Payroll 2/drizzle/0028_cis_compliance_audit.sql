ALTER TABLE `employers` ADD `cis_utr` text;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD `partner_utr` text;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD `address` text;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD `postcode` text;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD `email` text;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD `phone` text;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD `verification_method` text;
--> statement-breakpoint
ALTER TABLE `subcontractors` ADD `verification_response` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `invoice_number` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `payment_recipient` text;
--> statement-breakpoint
ALTER TABLE `cis_payments` ADD `materials_evidence` text;
