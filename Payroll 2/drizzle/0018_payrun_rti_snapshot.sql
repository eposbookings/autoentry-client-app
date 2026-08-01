ALTER TABLE `pay_runs` ADD `rti_snapshot` text;
UPDATE `pay_runs`
SET `rti_snapshot` = (
  SELECT json_object(
    'payrollId', `employees`.`payroll_id`,
    'taxCode', `employees`.`tax_code`,
    'week1Month1', `employees`.`week1_month1`,
    'niCategory', `employees`.`ni_category`,
    'niNumber', `employees`.`ni_number`,
    'startDate', `employees`.`start_date`,
    'leavingDate', `employees`.`leaving_date`,
    'reportedPayFrequency', `employees`.`reported_pay_frequency`,
    'contractedHours', `employees`.`contracted_hours`,
    'irregularPayment', `employees`.`irregular_payment`,
    'zeroPayFpsExclusion', `employees`.`zero_pay_fps_exclusion`,
    'workplacePostcode', `employees`.`workplace_postcode`,
    'previousPayrollId', `employees`.`previous_payroll_id`,
    'paymentToBody', `employees`.`payment_to_body`,
    'trivialCommutation', `employees`.`trivial_commutation`,
    'flexibleDrawdown', `employees`.`flexible_drawdown`
  )
  FROM `employees`
  WHERE `employees`.`id` = `pay_runs`.`employee_id`
)
WHERE `rti_snapshot` IS NULL;
