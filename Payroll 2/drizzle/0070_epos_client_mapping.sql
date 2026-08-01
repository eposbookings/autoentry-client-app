CREATE TABLE `epos_client_mappings` (
  `client_id` text PRIMARY KEY NOT NULL,
  `practice_id` text NOT NULL,
  `employer_id` integer NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  FOREIGN KEY (`employer_id`) REFERENCES `employers`(`id`)
);
CREATE UNIQUE INDEX `epos_client_mappings_employer_id_unique` ON `epos_client_mappings` (`employer_id`);
