// src/events/event-types.ts
import { Job, JobType } from "../types/job-types";

/**
 * Event types emitted by the crawler
 */
export enum EventType {
  JOB_COMPLETED = "job_completed",
  JOB_FAILED = "job_failed",
  JOB_STARTED = "job_started",
  RESOURCE_DISCOVERED = "resource_discovered",
  PROGRESS_UPDATE = "progress_update",
  PAGE_COMPLETED = "page_completed",
  CRAWLER_STARTED = "crawler_started",
  CRAWLER_STOPPED = "crawler_stopped",
  CRAWLER_PAUSED = "crawler_paused",
  CRAWLER_RESUMED = "crawler_resumed",
  ERROR = "error"
}

/**
 * Base event interface
 */
export interface CrawlerEvent {
  type: EventType;
  timestamp: Date;
}

/**
 * Job related event
 */
export interface JobEvent extends CrawlerEvent {
  job: Job;
}

/**
 * Job completed event
 */
export interface JobCompletedEvent extends JobEvent {
  type: EventType.JOB_COMPLETED;
  result: any;
  duration: number; // milliseconds
  discoveredJobs?: Job[];
}

/**
 * Job failed event
 */
export interface JobFailedEvent extends JobEvent {
  type: EventType.JOB_FAILED;
  error: string;
  attempts: number;
  willRetry: boolean;
}

/**
 * Job started event
 */
export interface JobStartedEvent extends JobEvent {
  type: EventType.JOB_STARTED;
}

/**
 * Resource discovered event
 */
export interface ResourceDiscoveredEvent extends CrawlerEvent {
  type: EventType.RESOURCE_DISCOVERED;
  resourceType: string;
  resourceId: string | number;
  resourcePath?: string;
  parentResourceId?: string | number;
  parentResourceType?: string;
}

/**
 * Progress update event
 */
export interface ProgressUpdateEvent extends CrawlerEvent {
  type: EventType.PROGRESS_UPDATE;
  jobType: JobType;
  total: number;
  completed: number;
  failed: number;
  pending: number;
  running: number;
}

/**
 * Page completed event (for pagination)
 */
export interface PageCompletedEvent extends CrawlerEvent {
  type: EventType.PAGE_COMPLETED;
  resourceType: string;
  resourceId: string | number;
  page: number;
  hasNextPage: boolean;
  nextCursor?: string;
  itemCount: number;
}

/**
 * Crawler lifecycle events
 */
export interface CrawlerLifecycleEvent extends CrawlerEvent {
  type:
    | EventType.CRAWLER_STARTED
    | EventType.CRAWLER_STOPPED
    | EventType.CRAWLER_PAUSED
    | EventType.CRAWLER_RESUMED;
}

/**
 * Error event
 */
export interface ErrorEvent extends CrawlerEvent {
  type: EventType.ERROR;
  error: string;
  context?: any;
}

/**
 * Union type of all event types
 */
export type CrawlerEventUnion =
  | JobCompletedEvent
  | JobFailedEvent
  | JobStartedEvent
  | ResourceDiscoveredEvent
  | ProgressUpdateEvent
  | PageCompletedEvent
  | CrawlerLifecycleEvent
  | ErrorEvent;

/**
 * Event listener type
 */
export type EventListener = (event: CrawlerEventUnion) => void;

/**
 * Event emitter interface
 */
export interface CrawlerEventEmitter {
  on(eventType: EventType | string, listener: EventListener): void;
  off(eventType: EventType | string, listener: EventListener): void;
  emit(event: CrawlerEventUnion): void;
}

/**
 * Pagination cursor data
 */
export interface PaginationCursor {
  resourceType: string;
  resourceId: string | number;
  nextPage: number;
  nextCursor?: string;
  hasNextPage: boolean;
  lastUpdated: Date;
}
