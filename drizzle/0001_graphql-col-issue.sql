-- Custom SQL migration file, put your code below! --
DROP TABLE IF EXISTS "job";
CREATE TABLE IF NOT EXISTS `job` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT '"2025-07-22T17:30:29.165Z"' NOT NULL,
	`started_at` integer,
	`finished_at` integer,
	`status` text DEFAULT 'queued' NOT NULL,
	`command` text DEFAULT 'authorizationScope' NOT NULL,
	`full_path` text,
	`branch` text,
	`from` integer DEFAULT (unixepoch('2022-02-01')),
	`to` integer,
	`accountId` text NOT NULL,
	`spawned_from` text,
	`resume_state` blob,
	`progress` blob,
	`userId` text,
	`provider` text,
	`gitlabGraphQLUrl` text,
	`updatedAt` integer,
	FOREIGN KEY (`accountId`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_created_at_idx` ON `job` (`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_status_idx` ON `job` (`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_branch_idx` ON `job` (`branch`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_from_idx` ON `job` (`from`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_to_idx` ON `job` (`to`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_full_path_branch_idx` ON `job` (`full_path`,`branch`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_full_path_command_idx` ON `job` (`full_path`,`command`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_full_path_status_idx` ON `job` (`full_path`,`status`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_full_path_from_idx` ON `job` (`full_path`,`from`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `job_full_path_to_idx` ON `job` (`full_path`,`to`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `job_uq_full_path_branch_command` ON `job` (`full_path`,`branch`,`command`) WHERE 
			"job"."command" <> 'authorizationScope'
		;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `job_uq_command_accountId` ON `job` (`command`,`accountId`) WHERE 
			"job"."command" = 'authorizationScope' AND
			"job"."full_path" IS NULL AND
			"job"."branch" IS NULL
		;--> statement-breakpoint