UPDATE `payroll_versions`
SET `created_at` = COALESCE(`restored_at`, `updated_at`)
WHERE `created_at` = 'CURRENT_TIMESTAMP';
