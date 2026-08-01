UPDATE `pay_runs`
SET `pension_snapshot` = json_set(
  coalesce(`pension_snapshot`, '{}'),
  '$.schemaVersion', coalesce(json_extract(`pension_snapshot`, '$.schemaVersion'), 'payflow-pension-evidence-backfill-1'),
  '$.payrollId', coalesce(json_extract(`pension_snapshot`, '$.payrollId'), (SELECT `payroll_id` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
  '$.niNumber', coalesce(json_extract(`pension_snapshot`, '$.niNumber'), (SELECT `ni_number` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
  '$.dateOfBirth', coalesce(json_extract(`pension_snapshot`, '$.dateOfBirth'), (SELECT `date_of_birth` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
  '$.firstName', coalesce(json_extract(`pension_snapshot`, '$.firstName'), (SELECT `first_name` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
  '$.middleNames', coalesce(json_extract(`pension_snapshot`, '$.middleNames'), (SELECT `middle_names` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`)),
  '$.lastName', coalesce(json_extract(`pension_snapshot`, '$.lastName'), (SELECT `last_name` FROM `employees` WHERE `employees`.`id` = `pay_runs`.`employee_id`))
)
WHERE `status` = 'finalised'
  AND `pension_scheme_id` IS NOT NULL
  AND (
    json_extract(`pension_snapshot`, '$.payrollId') IS NULL
    OR json_extract(`pension_snapshot`, '$.firstName') IS NULL
    OR json_extract(`pension_snapshot`, '$.lastName') IS NULL
  );
