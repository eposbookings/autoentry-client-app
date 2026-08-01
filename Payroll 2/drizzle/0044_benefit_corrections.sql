ALTER TABLE `expenses_benefits` ADD `void_reason` text;
--> statement-breakpoint
ALTER TABLE `expenses_benefits` ADD `voided_at` text;
--> statement-breakpoint
ALTER TABLE `expenses_benefits` ADD `replaces_benefit_id` integer;
