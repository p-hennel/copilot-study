PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_area` (
	`full_path` text PRIMARY KEY NOT NULL,
	`gitlab_id` text NOT NULL,
	`name` text,
	`type` text NOT NULL,
	`created_at` integer DEFAULT '"2025-03-29T15:04:24.264Z"' NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_area`("full_path", "gitlab_id", "name", "type", "created_at") SELECT "full_path", "gitlab_id", "name", "type", "created_at" FROM `area`;--> statement-breakpoint
DROP TABLE `area`;--> statement-breakpoint
ALTER TABLE `__new_area` RENAME TO `area`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `area_gitlab_id_unique` ON `area` (`gitlab_id`);--> statement-breakpoint
CREATE TABLE `__new_job` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT '"2025-03-29T15:04:24.264Z"' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`command` text DEFAULT 'authorizationScope' NOT NULL,
	`full_path` text,
	`branch` text,
	`from` integer DEFAULT '"2022-01-31T23:00:00.000Z"',
	`to` integer,
	`accountId` text NOT NULL,
	`spawned_from` text,
	`resume_state` blob
);
--> statement-breakpoint
INSERT INTO `__new_job`("id", "created_at", "started_at", "finished_at", "status", "command", "full_path", "branch", "from", "to", "accountId", "spawned_from", "resume_state") SELECT "id", "created_at", "started_at", "finished_at", "status", "command", "full_path", "branch", "from", "to", "accountId", "spawned_from", "resume_state" FROM `job`;--> statement-breakpoint
DROP TABLE `job`;--> statement-breakpoint
ALTER TABLE `__new_job` RENAME TO `job`;--> statement-breakpoint
CREATE INDEX `job_created_at_idx` ON `job` (`created_at`);--> statement-breakpoint
CREATE INDEX `job_status_idx` ON `job` (`status`);--> statement-breakpoint
CREATE INDEX `job_branch_idx` ON `job` (`branch`);--> statement-breakpoint
CREATE INDEX `job_from_idx` ON `job` (`from`);--> statement-breakpoint
CREATE INDEX `job_to_idx` ON `job` (`to`);--> statement-breakpoint
CREATE INDEX `job_full_path_branch_idx` ON `job` (`full_path`,`branch`);--> statement-breakpoint
CREATE INDEX `job_full_path_command_idx` ON `job` (`full_path`,`command`);--> statement-breakpoint
CREATE INDEX `job_full_path_status_idx` ON `job` (`full_path`,`status`);--> statement-breakpoint
CREATE INDEX `job_full_path_from_idx` ON `job` (`full_path`,`from`);--> statement-breakpoint
CREATE INDEX `job_full_path_to_idx` ON `job` (`full_path`,`to`);--> statement-breakpoint
CREATE UNIQUE INDEX `job_uq_full_path_branch_command` ON `job` (`full_path`,`branch`,`command`) WHERE 
			"job"."command" <> 'authorizationScope'
		;--> statement-breakpoint
CREATE UNIQUE INDEX `job_uq_command_accountId` ON `job` (`command`,`accountId`) WHERE 
			"job"."command" = 'authorizationScope' AND
			"job"."full_path" IS NULL AND
			"job"."branch" IS NULL
		;--> statement-breakpoint
CREATE TABLE `__new_area_authorization` (
	`accountId` text NOT NULL,
	`area_id` text NOT NULL,
	PRIMARY KEY(`accountId`, `area_id`),
	FOREIGN KEY (`accountId`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `area`(`full_path`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_area_authorization`("accountId", "area_id") SELECT "accountId", "area_id" FROM `area_authorization`;--> statement-breakpoint
DROP TABLE `area_authorization`;--> statement-breakpoint
ALTER TABLE `__new_area_authorization` RENAME TO `area_authorization`;