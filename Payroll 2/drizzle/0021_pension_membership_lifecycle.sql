ALTER TABLE `pay_runs` ADD `pension_scheme_id` integer REFERENCES pension_schemes(id);
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `enrolment_information_date` text;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `opt_out_notice_date` text;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `opt_out_notice_valid` integer DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `ceased_date` text;
--> statement-breakpoint
ALTER TABLE `pension_memberships` ADD `last_reenrolment_date` text;
--> statement-breakpoint
CREATE TABLE `pension_membership_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `employer_id` integer NOT NULL REFERENCES employers(id),
  `membership_id` integer NOT NULL REFERENCES pension_memberships(id),
  `employee_id` integer NOT NULL REFERENCES employees(id),
  `scheme_id` integer NOT NULL REFERENCES pension_schemes(id),
  `event_type` text NOT NULL,
  `effective_date` text NOT NULL,
  `previous_status` text,
  `new_status` text NOT NULL,
  `details` text,
  `created_by` text DEFAULT 'Payroll administrator' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
UPDATE `pay_runs`
SET `pension_scheme_id` = (
  SELECT ps.id FROM pension_schemes ps
  JOIN pension_memberships pm ON pm.scheme_id = ps.id
  WHERE pm.employee_id = pay_runs.employee_id
  ORDER BY CASE WHEN ps.status = 'active' THEN 0 ELSE 1 END, ps.id DESC
  LIMIT 1
)
WHERE employee_pension <> 0 OR employer_pension <> 0;
