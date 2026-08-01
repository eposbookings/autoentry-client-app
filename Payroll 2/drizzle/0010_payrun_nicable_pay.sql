ALTER TABLE `pay_runs` ADD `nicable_pay` real DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `pay_runs` SET `nicable_pay` = `taxable_pay` WHERE `nicable_pay` = 0 AND `taxable_pay` <> 0;
