ALTER TABLE `attachment_orders` ADD `ordinary_debt_balance` real;
ALTER TABLE `attachment_orders` ADD `maintenance_daily_rate` real NOT NULL DEFAULT 0;
ALTER TABLE `attachment_order_deductions` ADD `ordinary_deduction` real NOT NULL DEFAULT 0;
ALTER TABLE `attachment_order_deductions` ADD `maintenance_deduction` real NOT NULL DEFAULT 0;
ALTER TABLE `attachment_order_deductions` ADD `ordinary_balance_after` real;
