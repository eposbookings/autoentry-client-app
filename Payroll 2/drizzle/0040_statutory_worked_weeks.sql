ALTER TABLE `leave_events` ADD `statutory_worked_weeks` text;
--> statement-breakpoint
ALTER TABLE `leave_events` ADD `statutory_paid_day_offset` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `leave_events`
SET `statutory_paid_day_offset` = MAX(0, CAST(julianday(`start_date`) - julianday(COALESCE(`statutory_pay_period_start`, `start_date`)) AS integer))
WHERE `subtype` IN ('maternity', 'adoption');
