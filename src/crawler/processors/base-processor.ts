import { Gitlab } from "@gitbeaker/node";
import { getLogger } from "@logtape/logtape";
import { throttle } from "lodash";
import { type CrawlerEventEmitter, EventType } from "../events/event-types";
import { CursorRegistry } from "../registry/cursor-registry";
import { saveJsonFile, saveJsonlFile } from "../utils/filesystem";

// Initialize logger
const logger = getLogger(["crawlib", "processors", "base"]);

/**
 * Base processor config interface
 */
export interface BaseProcessorConfig {
  /**
   * GitLab instance URL
   */
  gitlabUrl: string;

  /**
   * Output directory for data
   */
  outputDir: string;

  /**
   * Event emitter for progress events
   */
  eventEmitter: CrawlerEventEmitter;

  /**
   * Cursor registry for tracking pagination
   */
  cursorRegistry: CursorRegistry;

  /**
   * Resource-specific throttled request functions
   */
  resourceThrottles?: Map<string, <T>(fn: () => Promise<T>) => Promise<T>>;
}

/**
 * Base class for job processors that provides common functionality
 */
export abstract class BaseProcessor {
  /**
   * GitLab instance URL
   */
  protected gitlabUrl: string;

  /**
   * Output directory for data
   */
  protected outputDir: string;

  /**
   * Event emitter for progress events
   */
  protected eventEmitter: CrawlerEventEmitter;

  /**
   * Cursor registry for tracking pagination
   */
  protected cursorRegistry: CursorRegistry;

  /**
   * Resource-specific throttled request functions
   */
  protected resourceThrottles: Map<string, <T>(fn: () => Promise<T>) => Promise<T>>;

  /**
   * Constructor
   *
   * @param config - Processor configuration
   */
  constructor(config: BaseProcessorConfig) {
    this.gitlabUrl = config.gitlabUrl;
    this.outputDir = config.outputDir;
    this.eventEmitter = config.eventEmitter;
    this.cursorRegistry = config.cursorRegistry;
    this.resourceThrottles = config.resourceThrottles || new Map();
  }

  /**
   * Get a throttled request function for a resource type
   *
   * @param resourceType - Resource type
   * @returns Throttled request function
   */
  protected getThrottledRequest(resourceType: string): <T>(fn: () => Promise<T>) => Promise<T> {
    // Use resource-specific throttle if available
    if (this.resourceThrottles.has(resourceType)) {
      return this.resourceThrottles.get(resourceType)!;
    }

    // Otherwise use a default throttle
    return throttle(
      async <T>(fn: () => Promise<T>): Promise<T> => {
        try {
          return await fn();
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);

          // Handle rate limiting errors
          if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
            logger.warn(`Rate limit hit, pausing for 60 seconds...`);
            await Bun.sleep(60000); // Consider making sleep duration configurable
            return fn();
          }

          throw error;
        }
      },
      1000 // Default: 1 request per second
    );
  }

  /**
   * Save data to a JSONL file
   *
   * @param fileName - File path relative to output directory
   * @param data - Data to save
   */
  protected async saveData(fileName: string, data: any[]): Promise<void> {
    const filePath = `${this.outputDir}/${fileName}`;
    await saveJsonlFile(filePath, data);
  }

  /**
   * Save a single object to a JSON file
   *
   * @param fileName - File path relative to output directory
   * @param data - Data to save
   */
  protected async saveSingleObject(fileName: string, data: any): Promise<void> {
    const filePath = `${this.outputDir}/${fileName}`;
    await saveJsonFile(filePath, data);
  }

  /**
   * Helper to create a retry-aware fetch function with error handling
   *
   * @param resourceType - Resource type for logging/throttling
   * @param apiClient - GitLab API client instance
   * @returns A function that wraps API calls with retry and error handling
   */
  protected createFetchFn<T, Args extends any[]>(
    resourceType: string,
    apiClient: InstanceType<typeof Gitlab>,
    apiFn: (client: InstanceType<typeof Gitlab>, ...args: Args) => Promise<T>
  ): (...args: Args) => Promise<T> {
    // Get throttled request function for this resource type
    const throttledRequest = this.getThrottledRequest(resourceType);

    return async (...args: Args): Promise<T> => {
      try {
        // Apply throttling to the API call
        return await throttledRequest(() => apiFn(apiClient, ...args));
      } catch (error) {
        // Enhanced error handling with specific GitLab error detection
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Special handling for common GitLab errors
        if (errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found")) {
          logger.warn(`Resource not found in ${resourceType}: ${errorMessage}`);
          throw new Error(`Resource not found: ${errorMessage}`);
        }

        if (errorMessage.includes("403") || errorMessage.toLowerCase().includes("forbidden")) {
          logger.warn(`Permission denied for ${resourceType}: ${errorMessage}`);
          throw new Error(`Permission denied: ${errorMessage}`);
        }

        if (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit")) {
          logger.warn(`Rate limit hit for ${resourceType}: ${errorMessage}`);
          // The throttle mechanism should handle this, but we'll throw anyway
          throw new Error(`Rate limit exceeded: ${errorMessage}`);
        }

        // Unknown errors
        logger.error(`Error fetching ${resourceType}: ${errorMessage}`);
        throw error;
      }
    };
  }

  /**
   * Helper to fetch paginated data with cursor tracking and improved error handling
   *
   * @param resourceType - Resource type identifier
   * @param resourceId - Resource ID
   * @param fetchFn - Function to fetch data
   * @param apiClient - The API client instance to use
   * @param options - Pagination options
   * @returns Fetched items
   */
  protected async fetchPaginatedData<T>(
    resourceType: string,
    resourceId: string | number,
    fetchFn: (
      apiClient: InstanceType<typeof Gitlab>,
      options: { page: number; per_page: number }
    ) => Promise<T[]>,
    apiClient: InstanceType<typeof Gitlab>,
    options: {
      itemsPerPage?: number;
      maxPages?: number;
    } = {}
  ): Promise<T[]> {
    const { itemsPerPage = 100, maxPages } = options;

    // Get next page from cursor registry
    const nextPage = this.cursorRegistry.getNextPage(resourceType, resourceId);

    // Respect max pages limit if set
    if (maxPages !== undefined && nextPage > maxPages) {
      logger.debug(`Reached max pages limit (${maxPages}) for ${resourceType} ${resourceId}`);
      this.cursorRegistry.registerCursor(resourceType, resourceId, nextPage, false);
      return [];
    }

    logger.debug(`Fetching ${resourceType} for ${resourceId}, page ${nextPage}...`);

    // Get throttled request function for this resource type
    const throttledRequest = this.getThrottledRequest(resourceType);

    try {
      const items = await throttledRequest(() =>
        fetchFn(apiClient, { page: nextPage, per_page: itemsPerPage })
      );

      // Update cursor in registry
      const hasNextPage = items.length === itemsPerPage;
      this.cursorRegistry.registerCursor(resourceType, resourceId, nextPage, hasNextPage);

      // Emit page completed event with item count
      this.eventEmitter.emit({
        type: EventType.PAGE_COMPLETED,
        timestamp: new Date(),
        resourceType,
        resourceId,
        page: nextPage,
        hasNextPage,
        itemCount: items.length
      });

      return items;
    } catch (error) {
      // Handle specific errors and provide better recovery options
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (errorMessage.includes("404") || errorMessage.toLowerCase().includes("not found")) {
        // For 404 errors, mark as completed without data
        logger.warn(`Resource ${resourceType}/${resourceId} not found, marking as completed`);
        this.cursorRegistry.registerCursor(resourceType, resourceId, nextPage, false);
        return [];
      }

      // For other errors, let the caller handle it
      throw error;
    }
  }
}
