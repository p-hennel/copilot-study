import { AreaType, CrawlCommand, JobStatus, TokenProvider } from "$lib/types";
import { relations, sql } from "drizzle-orm";
import {
  blob, // Added blob for json
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex
} from "drizzle-orm/sqlite-core";
import { monotonicFactory } from "ulid";
import { account, user, session } from "./auth-schema"; // Added session for potential future use, account for authorizationId

const ulid = monotonicFactory();

export enum TokenType {
  bearer = "bearer"
}

export type NewJobType = {
  accountId: string;
  full_path?: string;
  command: CrawlCommand;
  from?: Date;
  spawned_from?: string;
};
export type UpdateJobType = {
  id?: string;
  status: JobStatus;
  startedAt?: Date | null;
  finishedAt?: Date | null;
};

export enum GitLabScopes {
  api = "api",
  readUser = "read_user",
  readApi = "read_api",
  readRepository = "read_repository",
  writeRepository = "write_repository",
  readRegistry = "read_registry",
  writeRegistry = "write_registry",
  sudo = "sudo",
  openid = "openid",
  profile = "profile",
  email = "email",
  createRunner = "create_runner",
  manageRunner = "manage_runner",
  k8sProxy = "k8s_proxy"
}

export const DefaultGitLabScopes = [
  GitLabScopes.readApi,
  GitLabScopes.readRegistry,
  GitLabScopes.readRepository,
  GitLabScopes.readUser,
  GitLabScopes.openid,
  GitLabScopes.email,
  GitLabScopes.profile
];

function toDBEnum<T extends Record<any, string>>(data: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(data) as [T[keyof T], ...T[keyof T][]];
}

export const tokenScopeJob = sqliteTable(
  "token_scope_job",
  {
    id: text("id").$defaultFn(ulid).primaryKey(), // New ULID primary key
    userId: text("user_id").notNull().references(() => user.id),
    provider: text("provider", { enum: toDBEnum(TokenProvider) })
      .notNull()
      .default(TokenProvider.gitlab),
    accountId: text("account_id").notNull().references(() => account.id),
    authorizationId: text("authorization_id").notNull().references(() => account.id),
    gitlabGraphQLUrl: text("gitlab_graphql_url").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" })
      .notNull()
      .default(sql`current_timestamp`),
    updated_at: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`current_timestamp`)
      .$onUpdate(() => sql`current_timestamp`),
    isComplete: integer("is_complete", { mode: "boolean" }).notNull().default(false),
    groupCursor: text("group_cursor"),
    projectCursor: text("project_cursor"),
    groupCount: integer("group_count").notNull().default(0),
    projectCount: integer("project_count").notNull().default(0),
    groupTotal: integer("group_total"),
    projectTotal: integer("project_total")
  },
  (table) => [
    index("tsj_user_id_idx").on(table.userId),
    index("tsj_provider_idx").on(table.provider),
    index("tsj_account_id_idx").on(table.accountId),
    index("tsj_authorization_id_idx").on(table.authorizationId),
    index("tsj_user_provider_idx").on(table.userId, table.provider) // Kept for potential queries
  ]
);

export const tokenScopeJobRelations = relations(tokenScopeJob, ({ one, many }) => ({
  user: one(user, {
    fields: [tokenScopeJob.userId],
    references: [user.id]
  }),
  account: one(account, { // Relation to the account table for accountId
    fields: [tokenScopeJob.accountId],
    references: [account.id]
  }),
  authorization: one(account, { // Relation to the account table for authorizationId
    fields: [tokenScopeJob.authorizationId],
    references: [account.id]
  }),
  areas: many(tokenScopeJobArea) // Renamed from forAreas to areas for clarity
}));

export const tokenScopeJobArea = sqliteTable(
  "token_scope_job_area",
  {
    token_scope_job_id: text("token_scope_job_id").notNull().references(() => tokenScopeJob.id, { onDelete: "cascade" }),
    full_path: text("full_path").notNull().references(() => area.full_path, { onDelete: "cascade" })
  },
  (table) => [primaryKey({ columns: [table.token_scope_job_id, table.full_path] })]
);

export const tokenScopeJobAreaRelations = relations(tokenScopeJobArea, ({ one }) => ({
  // fromUser removed
  area: one(area, { // Renamed from forArea to area
    fields: [tokenScopeJobArea.full_path],
    references: [area.full_path]
  }),
  tokenScopeJob: one(tokenScopeJob, { // Renamed from fromTokenScopeJob
    fields: [tokenScopeJobArea.token_scope_job_id],
    references: [tokenScopeJob.id]
  })
}));

export const area_authorization = sqliteTable(
  "area_authorization",
  {
    accountId: text()
      .notNull()
      .references(() => account.id),
    area_id: text()
      .notNull()
      .references(() => area.full_path)
  },
  (table) => [primaryKey({ columns: [table.accountId, table.area_id] })]
);
export const area_authorizationRelations = relations(area_authorization, ({ one }) => ({
  account: one(account),
  area: one(area)
}));

export const area = sqliteTable("area", {
  full_path: text().primaryKey(),
  gitlab_id: text().notNull().unique(),
  name: text(),
  type: text({ enum: toDBEnum(AreaType) }).notNull(),
  created_at: integer({ mode: "timestamp" })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`) // Use SQL default
});
export const areaRelations = relations(area, ({ many }) => ({
  usingAccounts: many(account),
  relatedJobs: many(job),
  fromTokenScopeJobs: many(tokenScopeJob)
}));

export const job = sqliteTable(
  "job",
  {
    id: text().notNull().$defaultFn(ulid).primaryKey(),
    created_at: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`), // Use SQL default
    started_at: integer({ mode: "timestamp" }),
    finished_at: integer({ mode: "timestamp" }),
    status: text({ enum: toDBEnum(JobStatus) })
      .notNull()
      .default(JobStatus.queued),
    command: text({ enum: toDBEnum(CrawlCommand) })
      .notNull()
      .default(CrawlCommand.authorizationScope),
    full_path: text(), //.references(() => area.full_path),
    branch: text(),
    from: integer({ mode: "timestamp" }).default(new Date(2022, 1, 1)),
    to: integer({ mode: "timestamp" }),
    accountId: text().notNull(), //.references(() => account.id),
    spawned_from: text(), //.references((): AnySQLiteColumn => job.id),
    // Added field to store resume state (e.g., cursors)
    resumeState: blob("resume_state", { mode: "json" }), // Stores JSON object for resume cursors
    progress: blob("progress", { mode: "json" })
  },
  (table) => [
    index("job_created_at_idx").on(table.created_at),
    index("job_status_idx").on(table.status),
    index("job_branch_idx").on(table.branch),
    index("job_from_idx").on(table.from),
    index("job_to_idx").on(table.to),
    index("job_full_path_branch_idx").on(table.full_path, table.branch),
    index("job_full_path_command_idx").on(table.full_path, table.command),
    index("job_full_path_status_idx").on(table.full_path, table.status),
    index("job_full_path_from_idx").on(table.full_path, table.from),
    index("job_full_path_to_idx").on(table.full_path, table.to),
    uniqueIndex("job_uq_full_path_branch_command").on(table.full_path, table.branch, table.command)
      .where(sql`
			${table.command} <> 'authorizationScope'
		`), // ${CrawlCommand.authorizationScope}
    uniqueIndex("job_uq_command_accountId").on(table.command, table.accountId).where(sql`
			${table.command} = 'authorizationScope' AND
			${table.full_path} IS NULL AND
			${table.branch} IS NULL
		`)
  ]
);

export type Area = typeof area.$inferInsert;

export const jobRelations = relations(job, ({ one, many }) => ({
  fromJob: one(job, {
    fields: [job.from],
    references: [job.id]
  }),
  spawnedJobs: many(job),
  forArea: one(area, {
    fields: [job.full_path],
    references: [area.full_path]
  }),
  usingAccount: one(account, {
    fields: [job.accountId],
    references: [account.id]
  })
}));

export type Job = typeof job.$inferSelect;
export type JobInsert = typeof job.$inferInsert;
