ALTER TABLE `leave_events` ADD `average_weekly_earnings_source` text DEFAULT 'manual' NOT NULL;
ALTER TABLE `leave_events` ADD `relevant_period_start` text;
ALTER TABLE `leave_events` ADD `relevant_period_end` text;
ALTER TABLE `leave_events` ADD `relevant_pay_total` real DEFAULT 0 NOT NULL;
