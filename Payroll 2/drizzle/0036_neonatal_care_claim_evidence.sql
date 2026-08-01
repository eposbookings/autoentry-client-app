ALTER TABLE `leave_events` ADD `child_birth_date` text;
ALTER TABLE `leave_events` ADD `neonatal_care_start_date` text;
ALTER TABLE `leave_events` ADD `neonatal_care_end_date` text;
ALTER TABLE `leave_events` ADD `neonatal_tier` text;
ALTER TABLE `leave_events` ADD `relationship_declaration` integer DEFAULT false NOT NULL;
ALTER TABLE `leave_events` ADD `caring_responsibility_declaration` integer DEFAULT false NOT NULL;
