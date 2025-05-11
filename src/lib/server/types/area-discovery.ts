import type { JobStatus } from "$lib/types";

/**
 * Type definitions for the area discovery types used by the crawler
 * These types define the communication protocol between the crawler and the controlling app
 */

/**
 * Data structure for a discovered area (group or project)
 */
export interface DiscoveredAreaData {
  /** The type of area: 'group' or 'project' */
  type: 'group' | 'project';
  
  /** The name of the area */
  name: string;
  
  /** The GitLab ID of the area */
  gitlabId: string;
  
  /** The full path of the area (namespace/project or group/subgroup) */
  fullPath: string;
  
  /** Optional web URL to the area */
  webUrl?: string;
  
  /** Optional description of the area */
  description?: string | null;
  
  /** Optional parent path for projects */
  parentPath?: string | null;
  
  /** Token/account that discovered the area */
  discoveredBy: string;
}

/**
 * Base payload interface for all progress updates
 */
export interface ProgressUpdateBase {
  /** ID of the task being processed */
  taskId: string;
  
  /** Timestamp when the update was created (ISO string) */
  timestamp: string;
  
  /** Status of the task */
  status: string;
}

/**
 * Payload for area discovery updates
 */
export interface NewAreasDiscoveredPayload extends ProgressUpdateBase {
  /** Status is 'new_areas_discovered' */
  status: 'new_areas_discovered';
  
  /** Array of discovered areas */
  areas: DiscoveredAreaData[];
  
  /** Optional message */
  message?: string;
  
  /** Optional number of processed items */
  processedItems?: number;
  
  /** Optional total number of items */
  totalItems?: number;
  
  /** Optional current data type being processed */
  currentDataType?: string;
}

/**
 * Generic progress update payload
 */
export interface StandardProgressUpdatePayload extends ProgressUpdateBase {
  /** Status is one of started, processing, completed, failed, or paused */
  status: 'started' | 'processing' | 'completed' | 'failed' | 'paused';
  
  /** Optional number of processed items */
  processedItems?: number;
  
  /** Optional total number of items */
  totalItems?: number;
  
  /** Optional current data type being processed */
  currentDataType?: string;
  
  /** Optional message */
  message?: string;
  
  /** Optional error details */
  error?: string | Record<string, any>;
  
  /** Optional progress state for resuming */
  progress?: any;
}

/**
 * Union type for all progress update payloads
 */
export type ProgressUpdatePayload = NewAreasDiscoveredPayload | StandardProgressUpdatePayload;