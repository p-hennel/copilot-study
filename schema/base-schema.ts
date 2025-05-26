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
import { account, user } from "./auth-schema"; 

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



export const jobArea = sqliteTable(
  "job_area",
  {
    jobId: text("jobId").notNull().references(() => job.id, { onDelete: "cascade" }),
    full_path: text("full_path").notNull().references(() => area.full_path, { onDelete: "cascade" })
  },
  (table) => [primaryKey({ columns: [table.jobId, table.full_path] })]
);

export const jobAreaRelations = relations(jobArea, ({ one }) => ({
  area: one(area, {
    fields: [jobArea.full_path],
    references: [area.full_path]
  }),
  job: one(job, {
    fields: [jobArea.jobId],
    references: [job.id]
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
    .default(sql`(unixepoch())`) 
});
export const areaRelations = relations(area, ({ many }) => ({
  usingAccounts: many(account),
  relatedJobs: many(job),
  jobAreas: many(jobArea)
}));

export const job = sqliteTable(
  "job",
  {
    id: text().notNull().$defaultFn(ulid).primaryKey(),
    created_at: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
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
    accountId: text().notNull().references(() => account.id),
    spawned_from: text(), //.references((): AnySQLiteColumn => job.id),
    // Added field to store resume state (e.g., cursors)
    resumeState: blob("resume_state", { mode: "json" }), // Stores JSON object for resume cursors
    progress: blob("progress", { mode: "json" }),
    userId: text("userId").references(() => user.id),
    provider: text("provider", { enum: toDBEnum(TokenProvider) }),
    gitlabGraphQLUrl: text("gitlabGraphQLUrl"),
    updated_at: integer("updatedAt", { mode: "timestamp" }).$onUpdateFn(() => sql`(unixepoch())`),
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
  }),
  user: one(user, {
    fields: [job.userId],
    references: [user.id]
  }),
  areas: many(jobArea)
}));

export type Job = typeof job.$inferSelect;
export type JobInsert = typeof job.$inferInsert;
