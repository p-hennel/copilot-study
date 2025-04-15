// src/registry/cursor-registry.ts
import { getLogger } from '@logtape/logtape';
import { type CrawlerEventEmitter, EventType, type PaginationCursor } from '../events/event-types';
import { JobType } from '../types/job-types';

// Initialize logger
const logger = getLogger(["crawlib", "cursor-registry"]);
/**
 * Registry for tracking pagination cursors and resource discovery
 */
export class CursorRegistry {
  private cursors: Map<string, PaginationCursor> = new Map();
  private discoveredResources: Map<string, Set<string | number>> = new Map();
  private eventEmitter: CrawlerEventEmitter;

  constructor(eventEmitter: CrawlerEventEmitter) {
    this.eventEmitter = eventEmitter;
  }

  /**
   * Create a composite key for a resource
   */
  private getResourceKey(resourceType: string, resourceId: string | number): string {
    return `${resourceType}:${resourceId}`;
  }

  /**
   * Register a pagination cursor
   */
  registerCursor(
    resourceType: string,
    resourceId: string | number,
    page: number,
    hasNextPage: boolean,
    nextCursor?: string
  ): PaginationCursor {
    const key = this.getResourceKey(resourceType, resourceId);
    
    const cursor: PaginationCursor = {
      resourceType,
      resourceId,
      nextPage: page + 1,
      nextCursor,
      hasNextPage,
      lastUpdated: new Date()
    };
    
    this.cursors.set(key, cursor);
    
    // Emit page completed event
    this.eventEmitter.emit({
      type: EventType.PAGE_COMPLETED,
      timestamp: new Date(),
      resourceType,
      resourceId,
      page,
      hasNextPage,
      nextCursor,
      itemCount: 0  // This will be set by the caller if needed
    });
    
    return cursor;
  }

  /**
   * Get a pagination cursor
   */
  getCursor(resourceType: string, resourceId: string | number): PaginationCursor | undefined {
    const key = this.getResourceKey(resourceType, resourceId);
    return this.cursors.get(key);
  }

  /**
   * Check if a resource has more pages
   */
  hasMorePages(resourceType: string, resourceId: string | number): boolean {
    const cursor = this.getCursor(resourceType, resourceId);
    return !!cursor && cursor.hasNextPage;
  }

  /**
   * Get next page number for a resource
   */
  getNextPage(resourceType: string, resourceId: string | number): number {
    const cursor = this.getCursor(resourceType, resourceId);
    return cursor ? cursor.nextPage : 1;
  }

  /**
   * Get next cursor for a resource
   */
  getNextCursor(resourceType: string, resourceId: string | number): string | undefined {
    const cursor = this.getCursor(resourceType, resourceId);
    return cursor ? cursor.nextCursor : undefined;
  }

  /**
   * Mark resource as discovered
   */
  markResourceDiscovered(resourceType: string, resourceId: string | number, parentInfo?: {
    parentResourceType: string;
    parentResourceId: string | number;
    resourcePath?: string;
  }): void {
    if (!this.discoveredResources.has(resourceType)) {
      this.discoveredResources.set(resourceType, new Set());
    }
    
    const resourceSet = this.discoveredResources.get(resourceType)!;
    
    // Only emit event if this is a new discovery
    if (!resourceSet.has(resourceId)) {
      resourceSet.add(resourceId);
      
      // Emit resource discovered event
      this.eventEmitter.emit({
        type: EventType.RESOURCE_DISCOVERED,
        timestamp: new Date(),
        resourceType,
        resourceId,
        resourcePath: parentInfo?.resourcePath,
        parentResourceId: parentInfo?.parentResourceId,
        parentResourceType: parentInfo?.parentResourceType
      });
    }
  }

  /**
   * Check if a resource has been discovered
   */
  isResourceDiscovered(resourceType: string, resourceId: string | number): boolean {
    if (!this.discoveredResources.has(resourceType)) {
      return false;
    }
    
    return this.discoveredResources.get(resourceType)!.has(resourceId);
  }

  /**
   * Get all discovered resources of a specific type
   */
  getDiscoveredResources(resourceType: string): (string | number)[] {
    if (!this.discoveredResources.has(resourceType)) {
      return [];
    }
    
    return Array.from(this.discoveredResources.get(resourceType)!);
  }

  /**
   * Get all pagination cursors
   */
  getAllCursors(): PaginationCursor[] {
    return Array.from(this.cursors.values());
  }

  /**
   * Get pagination cursors for a specific resource type
   */
  getCursorsByType(resourceType: string): PaginationCursor[] {
    return this.getAllCursors().filter(cursor => cursor.resourceType === resourceType);
  }

  /**
   * Get pending cursors (resources with more pages)
   */
  getPendingCursors(): PaginationCursor[] {
    return this.getAllCursors().filter(cursor => cursor.hasNextPage);
  }

  /**
   * Get cursor counts by job type
   */
  getCursorCounts(): Record<string, { total: number; pending: number }> {
    const counts: Record<string, { total: number; pending: number }> = {};
    
    // Initialize counts for all job types
    Object.values(JobType).forEach(type => {
      counts[type] = { total: 0, pending: 0 };
    });
    
    // Count cursors by resource type
    this.getAllCursors().forEach(cursor => {
      const type = cursor.resourceType;
      
      if (!counts[type]) {
        counts[type] = { total: 0, pending: 0 };
      }
      
      counts[type].total++;
      
      if (cursor.hasNextPage) {
        counts[type].pending++;
      }
    });
    
    return counts;
  }

  /**
   * Export cursor state
   */
  exportState(): {
    cursors: PaginationCursor[];
    discoveredResources: Record<string, (string | number)[]>;
  } {
    const discoveredResourcesExport: Record<string, (string | number)[]> = {};
    
    this.discoveredResources.forEach((resources, type) => {
      discoveredResourcesExport[type] = Array.from(resources);
    });
    
    return {
      cursors: this.getAllCursors(),
      discoveredResources: discoveredResourcesExport
    };
  }

  /**
   * Import cursor state
   */
  importState(state: {
    cursors: PaginationCursor[];
    discoveredResources: Record<string, (string | number)[]>;
  }): void {
    // Import cursors
    state.cursors.forEach(cursor => {
      const key = this.getResourceKey(cursor.resourceType, cursor.resourceId);
      this.cursors.set(key, cursor);
    });
    
    // Import discovered resources
    Object.entries(state.discoveredResources).forEach(([type, resources]) => {
      const resourceSet = new Set<string | number>(resources);
      this.discoveredResources.set(type, resourceSet);
    });
    
    logger.info(`Imported state: ${state.cursors.length} cursors, ${Object.keys(state.discoveredResources).length} resource types`);
  }
}