ALTER TABLE `employers` ADD `apprenticeship_levy` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `employers` ADD `apprenticeship_levy_allowance` real DEFAULT 15000 NOT NULL;
