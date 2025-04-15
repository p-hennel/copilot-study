// src/events/event-emitter.ts
import { getLogger } from '@logtape/logtape';
import { type CrawlerEventEmitter, type CrawlerEventUnion, type EventListener, EventType } from './event-types';

// Initialize logger
const logger = getLogger(["crawlib", "event-emitter"]);

/**
 * Simple event emitter implementation for the crawler
 */
export class GitLabCrawlerEventEmitter implements CrawlerEventEmitter {
  private listeners: Map<string, Set<EventListener>> = new Map();
  private allEventListeners: Set<EventListener> = new Set();

  /**
   * Register a listener for a specific event type
   */
  on(eventType: EventType | string, listener: EventListener): void {
    if (eventType === '*') {
      this.allEventListeners.add(listener);
      return;
    }

    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }

    this.listeners.get(eventType)!.add(listener);
    logger.debug(`Registered listener for event type: ${eventType}`);
  }

  /**
   * Remove a listener for a specific event type
   */
  off(eventType: EventType | string, listener: EventListener): void {
    if (eventType === '*') {
      this.allEventListeners.delete(listener);
      return;
    }

    if (this.listeners.has(eventType)) {
      this.listeners.get(eventType)!.delete(listener);
    }
  }

  /**
   * Emit an event to all registered listeners
   */
  emit(event: CrawlerEventUnion): void {
    // Add timestamp if not present
    if (!event.timestamp) {
      event.timestamp = new Date();
    }

    // Notify specific event listeners
    const listeners = this.listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event);
        } catch (error) {
          logger.error(`Error in event listener for ${event.type}:`, {error});
        }
      }
    }

    // Notify all-event listeners
    for (const listener of this.allEventListeners) {
      try {
        listener(event);
      } catch (error) {
        logger.error(`Error in global event listener for ${event.type}:`, {error});
      }
    }

    // Debug log
    logger.debug(`Emitted event: ${event.type}`);
  }

  /**
   * Get the count of listeners for a specific event type
   */
  listenerCount(eventType: EventType | string): number {
    if (eventType === '*') {
      return this.allEventListeners.size;
    }

    if (!this.listeners.has(eventType)) {
      return 0;
    }

    return this.listeners.get(eventType)!.size;
  }

  /**
   * Get all registered event types
   */
  eventTypes(): string[] {
    return Array.from(this.listeners.keys());
  }
}