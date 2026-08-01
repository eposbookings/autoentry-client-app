ALTER TABLE `expenses_benefits` ADD `copied_from_benefit_id` integer;
--> statement-breakpoint
ALTER TABLE `expenses_benefits` ADD `copied_at` text;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `expenses_benefits_copied_source_unique`
ON `expenses_benefits` (`copied_from_benefit_id`);
