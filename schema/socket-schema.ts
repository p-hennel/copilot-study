import { sqliteTable, text, integer, blob, index } from 'drizzle-orm/sqlite-core';
import { relations, sql } from 'drizzle-orm';
import { monotonicFactory } from 'ulid';
import { job } from './base-schema';

const ulid = monotonicFactory();

/**
 * Socket connection tracking table
 * Tracks active WebSocket connections from crawlers
 */
export const socketConnection = sqliteTable('socket_connection', {
  id: text().notNull().$defaultFn(ulid).primaryKey(),
  crawler_id: text('crawler_id'),
  connected_at: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  last_heartbeat: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  is_active: integer({ mode: 'boolean' }).notNull().default(true),
  active_jobs: blob('active_jobs', { mode: 'json' }).$type<string[]>().default([]),
  system_status: text({ enum: ['idle', 'discovering', 'crawling', 'error'] }).notNull().default('idle'),
  metadata: blob('metadata', { mode: 'json' })
}, (table) => [
  index('socket_connection_active_idx').on(table.is_active),
  index('socket_connection_heartbeat_idx').on(table.last_heartbeat)
]);

/**
 * Job queue for managing job assignments between web app and crawlers
 */
export const jobQueue = sqliteTable('job_queue', {
  id: text().notNull().$defaultFn(ulid).primaryKey(),
  web_app_job_id: text('web_app_job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  priority: integer().notNull().default(1),
  scheduled_at: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  attempts: integer().notNull().default(0),
  max_attempts: integer().notNull().default(3),
  data: blob('data', { mode: 'json' }).notNull(),
  status: text({ enum: ['pending', 'processing', 'completed', 'failed'] }).notNull().default('pending'),
  error: text(),
  last_attempt_at: integer({ mode: 'timestamp' })
}, (table) => [
  index('job_queue_status_idx').on(table.status),
  index('job_queue_priority_idx').on(table.priority),
  index('job_queue_scheduled_idx').on(table.scheduled_at)
]);

/**
 * Job assignment mapping between web app jobs and crawler jobs
 */
export const jobAssignmentMapping = sqliteTable('job_assignment_mapping', {
  id: text().notNull().$defaultFn(ulid).primaryKey(),
  web_app_job_id: text('web_app_job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  crawler_job_id: text('crawler_job_id').notNull(),
  account_id: text('account_id').notNull(),
  user_id: text('user_id'),
  created_at: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  assigned_at: integer({ mode: 'timestamp' }),
  completed_at: integer({ mode: 'timestamp' }),
  status: text({ enum: ['pending', 'assigned', 'running', 'completed', 'failed', 'cancelled'] }).notNull().default('pending'),
  metadata: blob('metadata', { mode: 'json' })
}, (table) => [
  index('job_mapping_web_app_idx').on(table.web_app_job_id),
  index('job_mapping_crawler_idx').on(table.crawler_job_id),
  index('job_mapping_status_idx').on(table.status)
]);

/**
 * Job error logging table for tracking and debugging job failures
 */
export const jobErrorLog = sqliteTable('job_error_log', {
  id: text().notNull().$defaultFn(ulid).primaryKey(),
  job_id: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  timestamp: integer({ mode: 'timestamp' }).notNull().default(sql`(unixepoch())`),
  error_type: text('error_type').notNull(),
  error_message: text('error_message').notNull(),
  stack_trace: text('stack_trace'),
  context: blob('context', { mode: 'json' }),
  retry_count: integer('retry_count').notNull().default(0),
  is_recoverable: integer({ mode: 'boolean' }).notNull().default(true),
  resolution: text()
}, (table) => [
  index('job_error_job_idx').on(table.job_id),
  index('job_error_timestamp_idx').on(table.timestamp)
]);

// Relations
export const jobQueueRelations = relations(jobQueue, ({ one }) => ({
  webAppJob: one(job, {
    fields: [jobQueue.web_app_job_id],
    references: [job.id]
  })
}));

export const jobAssignmentMappingRelations = relations(jobAssignmentMapping, ({ one }) => ({
  webAppJob: one(job, {
    fields: [jobAssignmentMapping.web_app_job_id],
    references: [job.id]
  })
}));

export const jobErrorLogRelations = relations(jobErrorLog, ({ one }) => ({
  job: one(job, {
    fields: [jobErrorLog.job_id],
    references: [job.id]
  })
}));

// Type exports
export type SocketConnection = typeof socketConnection.$inferSelect;
export type SocketConnectionInsert = typeof socketConnection.$inferInsert;

export type JobQueue = typeof jobQueue.$inferSelect;
export type JobQueueInsert = typeof jobQueue.$inferInsert;

export type JobAssignmentMapping = typeof jobAssignmentMapping.$inferSelect;
export type JobAssignmentMappingInsert = typeof jobAssignmentMapping.$inferInsert;

export type JobErrorLog = typeof jobErrorLog.$inferSelect;
export type JobErrorLogInsert = typeof jobErrorLog.$inferInsert;