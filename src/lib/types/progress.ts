/**
 * Enhanced progress tracking types for the crawler system
 * 
 * This file defines the standardized progress data structure that should be used
 * throughout the application for consistent progress tracking and reporting.
 */

export interface CrawlerProgressData {
  // Basic progress tracking
  processedItems?: number;
  totalItems?: number;
  currentDataType?: string; // What type of data is currently being processed
  
  // Detailed breakdown by item type
  itemsByType?: {
    groups?: number;
    projects?: number;
    issues?: number;
    mergeRequests?: number;
    commits?: number;
    pipelines?: number;
    branches?: number;
    tags?: number;
    users?: number;
    milestones?: number;
    labels?: number;
    [key: string]: number | undefined;
  };
  
  // Progress tracking metadata
  lastProcessedId?: string; // For resumability
  stage?: string; // Current stage of processing
  operationType?: 'discovery' | 'branch_crawling' | 'data_collection' | 'finalization';
  message?: string;
  lastUpdate?: string; // ISO timestamp
  
  // Timeline tracking for detailed progress history
  timeline?: ProgressTimelineEvent[];
  
  // Legacy fields for backward compatibility
  processed?: number; // Legacy alias for processedItems
  total?: number; // Legacy alias for totalItems
  groupCount?: number; // Legacy field for GROUP_PROJECT_DISCOVERY
  projectCount?: number; // Legacy field for GROUP_PROJECT_DISCOVERY
  groupTotal?: number; // Legacy field for GROUP_PROJECT_DISCOVERY totals
  projectTotal?: number; // Legacy field for GROUP_PROJECT_DISCOVERY totals
  
  // Error tracking
  error?: string;
  errorTimestamp?: string;
  
  // Credential status (for credential-related progress updates)
  credentialStatus?: {
    type?: string;
    severity?: string;
    errorType?: string;
    providerId?: string;
    instanceType?: string;
    message?: string;
    adminGuidance?: string[];
    timestamp?: string;
    lastUpdate?: string;
  };
  
  // Areas discovery (for discovery jobs)
  lastAreasDiscovery?: {
    timestamp: string;
    groupsCount: number;
    projectsCount: number;
    totalDiscovered: number;
  };
}

export interface ProgressTimelineEvent {
  timestamp: string;
  event: 'progress_update' | 'areas_discovered' | 'credential_status_change' | 'discovery_progress' | 'stage_change' | 'error' | 'completion';
  details: {
    [key: string]: any;
  };
}

/**
 * Helper function to safely extract progress data from a job record
 */
export function extractProgressData(progressBlob: unknown): CrawlerProgressData {
  if (!progressBlob) return {};
  
  if (typeof progressBlob === 'string') {
    try {
      return JSON.parse(progressBlob) as CrawlerProgressData;
    } catch {
      return {};
    }
  }
  
  return progressBlob as CrawlerProgressData;
}

/**
 * Helper function to merge progress data intelligently
 * This function accumulates counts instead of overwriting them
 */
export function mergeProgressData(
  existing: CrawlerProgressData,
  incoming: Partial<CrawlerProgressData>
): CrawlerProgressData {
  const merged: CrawlerProgressData = { ...existing };
  
  // Merge basic fields (take incoming if provided, otherwise keep existing)
  if (incoming.processedItems !== undefined) {
    merged.processedItems = Math.max(incoming.processedItems, existing.processedItems || 0);
  }
  if (incoming.totalItems !== undefined) {
    merged.totalItems = incoming.totalItems;
  }
  if (incoming.currentDataType !== undefined) {
    merged.currentDataType = incoming.currentDataType;
  }
  if (incoming.lastProcessedId !== undefined) {
    merged.lastProcessedId = incoming.lastProcessedId;
  }
  if (incoming.stage !== undefined) {
    merged.stage = incoming.stage;
  }
  if (incoming.operationType !== undefined) {
    merged.operationType = incoming.operationType;
  }
  if (incoming.message !== undefined) {
    merged.message = incoming.message;
  }
  if (incoming.lastUpdate !== undefined) {
    merged.lastUpdate = incoming.lastUpdate;
  }
  
  // Merge itemsByType (accumulate counts)
  if (incoming.itemsByType) {
    merged.itemsByType = { ...existing.itemsByType };
    Object.entries(incoming.itemsByType).forEach(([key, value]) => {
      if (value !== undefined) {
        merged.itemsByType![key] = (merged.itemsByType![key] || 0) + value;
      }
    });
  }
  
  // Merge timeline (append new events)
  if (incoming.timeline) {
    merged.timeline = [...(existing.timeline || []), ...incoming.timeline];
  }
  
  // Handle other nested objects
  if (incoming.credentialStatus) {
    merged.credentialStatus = { ...existing.credentialStatus, ...incoming.credentialStatus };
  }
  
  if (incoming.lastAreasDiscovery) {
    merged.lastAreasDiscovery = incoming.lastAreasDiscovery;
  }
  
  // Handle error information
  if (incoming.error !== undefined) {
    merged.error = incoming.error;
  }
  if (incoming.errorTimestamp !== undefined) {
    merged.errorTimestamp = incoming.errorTimestamp;
  }
  
  return merged;
}

/**
 * Helper function to create a timeline event
 */
export function createTimelineEvent(
  event: ProgressTimelineEvent['event'],
  details: Record<string, any>,
  timestamp?: string
): ProgressTimelineEvent {
  return {
    timestamp: timestamp || new Date().toISOString(),
    event,
    details
  };
}

/**
 * Helper function to calculate progress percentage
 */
export function calculateProgressPercentage(progress: CrawlerProgressData): number | null {
  const processed = progress.processedItems || progress.processed || 0;
  const total = progress.totalItems || progress.total;
  
  if (!total || total <= 0) return null;
  
  return Math.min(100, Math.round((processed / total) * 100));
}

/**
 * Helper function to get a human-readable progress summary
 */
export function getProgressSummary(progress: CrawlerProgressData): string {
  const processed = progress.processedItems || progress.processed || 0;
  const total = progress.totalItems || progress.total;
  const currentType = progress.currentDataType || progress.stage || 'items';
  
  if (total) {
    const percentage = calculateProgressPercentage(progress);
    return `${processed}/${total} ${currentType} (${percentage}%)`;
  } else {
    return `${processed} ${currentType} processed`;
  }
}