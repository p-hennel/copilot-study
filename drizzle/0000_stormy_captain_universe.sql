CREATE TABLE `area` (
	`full_path` text PRIMARY KEY NOT NULL,
	`gitlab_id` text NOT NULL,
	`name` text,
	`type` text NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `area_gitlab_id_unique` ON `area` (`gitlab_id`);--> statement-breakpoint
CREATE TABLE `area_authorization` (
	`accountId` text NOT NULL,
	`area_id` text NOT NULL,
	PRIMARY KEY(`accountId`, `area_id`),
	FOREIGN KEY (`accountId`) REFERENCES `account`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`area_id`) REFERENCES `area`(`full_path`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `job` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
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
	`resume_state` blob,
	`progress` blob
);
--> statement-breakpoint
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
CREATE TABLE `token_scope_job` (
	`userId` text NOT NULL,
	`provider` text DEFAULT 'gitlab-onprem' NOT NULL,
	`accountId` text NOT NULL,
	`createdAt` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`updated_at` integer DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
	`isComplete` integer DEFAULT false NOT NULL,
	`groupCursor` text,
	`projectCursor` text,
	`groupCount` integer DEFAULT 0 NOT NULL,
	`projectCount` integer DEFAULT 0 NOT NULL,
	`groupTotal` integer,
	`projectTotal` integer,
	PRIMARY KEY(`userId`, `provider`)
);
--> statement-breakpoint
CREATE INDEX `tsj_uid` ON `token_scope_job` (`userId`);--> statement-breakpoint
CREATE INDEX `tsj_provider` ON `token_scope_job` (`provider`);--> statement-breakpoint
CREATE INDEX `tsj_aid` ON `token_scope_job` (`accountId`);--> statement-breakpoint
CREATE INDEX `tsj_uid_provider` ON `token_scope_job` (`userId`,`provider`);--> statement-breakpoint
CREATE INDEX `tsj_provider_path` ON `token_scope_job` (`provider`);--> statement-breakpoint
CREATE TABLE `token_scope_job_area` (
	`userId` text NOT NULL,
	`provider` text DEFAULT 'gitlab-onprem' NOT NULL,
	`full_path` text NOT NULL,
	PRIMARY KEY(`userId`, `provider`, `full_path`)
);
--> statement-breakpoint
CREATE TABLE `account` (
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
CREATE TABLE `apikey` (
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
CREATE TABLE `jwks` (
	`id` text PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
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
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `user` (
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
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer,
	`updated_at` integer
);
