ALTER TABLE `pay_runs` ADD `pension_snapshot` text;
--> statement-breakpoint
UPDATE `pay_runs`
SET `pension_snapshot` = CASE
  WHEN `pension_scheme_id` IS NULL THEN NULL
  ELSE json_object(
    'schemaVersion', 'payflow-pension-evidence-backfill-1',
    'schemeId', `pension_scheme_id`,
    'provider', (SELECT `provider` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'schemeName', (SELECT `scheme_name` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'employerReference', (SELECT `employer_reference` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'earningsBasis', (SELECT `earnings_basis` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'taxRelief', (SELECT `tax_relief` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'employeeRate', (SELECT `employee_rate` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'employerRate', (SELECT `employer_rate` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'contributionDueDay', (SELECT `contribution_due_day` FROM `pension_schemes` WHERE `pension_schemes`.`id` = `pay_runs`.`pension_scheme_id`),
    'payrollId', coalesce(json_extract(`rti_snapshot`, '$.payrollId'), (SELECT `payroll_id` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
    'niNumber', coalesce(json_extract(`rti_snapshot`, '$.niNumber'), (SELECT `ni_number` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
    'dateOfBirth', coalesce(json_extract(`rti_snapshot`, '$.dateOfBirth'), (SELECT `date_of_birth` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
    'firstName', coalesce(json_extract(`rti_snapshot`, '$.firstName'), (SELECT `first_name` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
    'middleNames', coalesce(json_extract(`rti_snapshot`, '$.middleNames'), (SELECT `middle_names` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
    'lastName', coalesce(json_extract(`rti_snapshot`, '$.lastName'), (SELECT `last_name` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`))
  )
END
WHERE `status` = 'finalised';
