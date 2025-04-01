import { relations, sql } from "drizzle-orm"
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
  blob // Added blob for json
} from "drizzle-orm/sqlite-core"
import { monotonicFactory } from "ulid"
import { AreaType, CrawlCommand, JobStatus, TokenProvider } from "../../utils"
import { account, user } from "./auth-schema"

const ulid = monotonicFactory()

export enum TokenType {
  bearer = "bearer"
}

export type NewJobType = {
  accountId: string
  full_path?: string
  command: CrawlCommand
  from?: Date
  spawned_from?: string
}
export type UpdateJobType = {
  id?: string
  status: JobStatus
  startedAt?: Date | null
  finishedAt?: Date | null
}

export enum Scopes {
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

export const DefaultScopes = [Scopes.readApi, Scopes.openid, Scopes.email]

function toDBEnum<T extends Record<any, string>>(data: T): [T[keyof T], ...T[keyof T][]] {
  return Object.values(data) as [T[keyof T], ...T[keyof T][]]
}

export const tokenScopeJob = sqliteTable(
  "token_scope_job",
  {
    userId: text().notNull(),
    provider: text({ enum: toDBEnum(TokenProvider) })
      .notNull()
      .default(TokenProvider.gitlab),
    accountId: text().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`), // Use SQL default
    updated_at: integer({ mode: "timestamp" })
      .notNull()
      .default(sql`(CURRENT_TIMESTAMP)`)
      .$onUpdate(() => sql`(CURRENT_TIMESTAMP)`), // Use SQL default
    isComplete: integer({ mode: "boolean" }).notNull().default(false),
    groupCursor: text(),
    projectCursor: text(),
    groupCount: integer().notNull().default(0),
    projectCount: integer().notNull().default(0),
    groupTotal: integer(),
    projectTotal: integer()
  },
  (table) => [
    index("tsj_uid").on(table.userId),
    index("tsj_provider").on(table.provider),
    index("tsj_aid").on(table.accountId),
    index("tsj_uid_provider").on(table.userId, table.provider),
    index("tsj_provider_path").on(table.provider),
    primaryKey({ columns: [table.userId, table.provider] })
  ]
)
export const tokenScopeJobRelations = relations(tokenScopeJob, ({ one, many }) => ({
  fromUser: one(user, {
    fields: [tokenScopeJob.userId],
    references: [user.id]
  }),
  forAreas: many(area)
}))

export const tokenScopeJobArea = sqliteTable(
  "token_scope_job_area",
  {
    userId: text().notNull(),
    provider: text({ enum: toDBEnum(TokenProvider) })
      .notNull()
      .default(TokenProvider.gitlab),
    full_path: text().notNull()
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider, table.full_path] })]
)

export const tokenScopeJobAreaRelations = relations(tokenScopeJobArea, ({ one }) => ({
  fromUser: one(user, {
    fields: [tokenScopeJobArea.userId],
    references: [user.id]
  }),
  forArea: one(area, {
    fields: [tokenScopeJobArea.full_path],
    references: [area.full_path]
  }),
  fromTokenScopeJob: one(tokenScopeJob, {
    fields: [tokenScopeJobArea.userId, tokenScopeJobArea.provider],
    references: [tokenScopeJob.userId, tokenScopeJob.provider]
  })
}))

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
)
export const area_authorizationRelations = relations(area_authorization, ({ one }) => ({
  account: one(account),
  area: one(area)
}))

export const area = sqliteTable("area", {
  full_path: text().primaryKey(),
  gitlab_id: text().notNull().unique(),
  name: text(),
  type: text({ enum: toDBEnum(AreaType) }).notNull(),
  created_at: integer({ mode: "timestamp" })
    .notNull()
    .default(sql`(CURRENT_TIMESTAMP)`) // Use SQL default
})
export const areaRelations = relations(area, ({ many }) => ({
  usingAccounts: many(account),
  relatedJobs: many(job),
  fromTokenScopeJobs: many(tokenScopeJob)
}))

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
    uniqueIndex("job_uq_full_path_branch_command").on(table.full_path, table.branch, table.command).where(sql`
			${table.command} <> 'authorizationScope'
		`), // ${CrawlCommand.authorizationScope}
    uniqueIndex("job_uq_command_accountId").on(table.command, table.accountId).where(sql`
			${table.command} = 'authorizationScope' AND
			${table.full_path} IS NULL AND
			${table.branch} IS NULL
		`)
  ]
)

export type Area = typeof area.$inferInsert

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
}))

export type Job = typeof job.$inferSelect
export type JobInsert = typeof job.$inferInsert
