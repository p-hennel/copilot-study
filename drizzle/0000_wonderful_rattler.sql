CREATE TABLE IF NOT EXISTS `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `apikey` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text,
	`start` text,
	`prefix` text,
	`key` text NOT NULL,
	`user_id` text NOT NULL,
	`refill_interval` integer,
	`refill_amount` integer,
	`last_refill_at` integer,
	`enabled` integer,
	`rate_limit_enabled` integer,
	`rate_limit_time_window` integer,
	`rate_limit_max` integer,
	`request_count` integer,
	`remaining` integer,
	`last_request` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`permissions` text,
	`metadata` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `area` (
	`full_path` text PRIMARY KEY NOT NULL,
	`gitlab_id` text NOT NULL,
	`name` text,
	`type` text NOT NULL,
	`created_at` integer DEFAULT '"2025-07-22T17:30:29.165Z"' NOT NULL
);
--> statement-breakpoint
DROP INDEX IF EXISTS `area_gitlab_id_unique`;--> statement-breakpoint
DROP INDEX IF EXISTS `area_gitlab_id_type_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `area_gitlab_id_type_unique` ON `area` (`gitlab_id`,`type`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `area_authorization` (
	`accountId` text NOT NULL,
	`area_id` text NOT NULL,
	PRIMARY KEY(`accountId`, `area_id`),
	FOREIGN KEY (`accountId`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `area`(`full_path`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
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
DROP INDEX IF EXISTS `job_created_at_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_branch_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_from_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_to_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_full_path_branch_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_full_path_command_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_full_path_status_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_full_path_from_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_full_path_to_idx`;--> statement-breakpoint
DROP INDEX IF EXISTS `job_uq_full_path_branch_command`;--> statement-breakpoint
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
CREATE TABLE IF NOT EXISTS `job_area` (
	`jobId` text NOT NULL,
	`full_path` text NOT NULL,
	PRIMARY KEY(`jobId`, `full_path`),
	FOREIGN KEY (`jobId`) REFERENCES `job`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`full_path`) REFERENCES `area`(`full_path`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	`impersonated_by` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`role` text,
	`banned` integer,
	`ban_reason` text,
	`ban_expires` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
