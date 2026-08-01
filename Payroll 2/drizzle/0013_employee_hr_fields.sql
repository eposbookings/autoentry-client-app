ALTER TABLE `employees` ADD `portal_can_edit_bank` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `employees` ADD `manager_name` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `emergency_contact_name` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `emergency_contact_phone` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `emergency_contact_relationship` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `medical_information` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `hr_notes` text;
--> statement-breakpoint
ALTER TABLE `employees` ADD `hr_notes_confidential` integer DEFAULT true NOT NULL;
