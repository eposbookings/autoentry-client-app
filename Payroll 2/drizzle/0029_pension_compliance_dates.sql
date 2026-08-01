ALTER TABLE `pension_schemes` ADD `automatic_enrolment_scheme` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `pension_schemes` ADD `certification_date` text;
--> statement-breakpoint
ALTER TABLE `pension_schemes` ADD `duties_start_date` text;
--> statement-breakpoint
ALTER TABLE `pension_schemes` ADD `next_reenrolment_date` text;
--> statement-breakpoint
ALTER TABLE `pension_schemes` ADD `declaration_due_date` text;
--> statement-breakpoint
ALTER TABLE `pension_schemes` ADD `declaration_status` text DEFAULT 'not-filed' NOT NULL;
--> statement-breakpoint
ALTER TABLE `pension_schemes` ADD `contribution_due_day` integer DEFAULT 22 NOT NULL;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `postponement_notice_date` text;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `employer_contribution_required` integer DEFAULT 1 NOT NULL;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `communication_due_date` text;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `last_communication_date` text;
