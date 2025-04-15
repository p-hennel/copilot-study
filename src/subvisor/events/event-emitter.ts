// src/events/event-emitter.ts
import { EventEmitter as NodeEventEmitter } from "events";
import { getLogger } from "@logtape/logtape";

/**
 * Enhanced EventEmitter with logging capabilities
 */
export class EventEmitter extends NodeEventEmitter {
  protected logger = getLogger(["event-emitter"]);

  /**
   * Override emit to add logging
   */
  emit(eventName: string | symbol, ...args: any[]): boolean {
    // Log the event emission
    if (typeof eventName === "string") {
      // Fix: Properly structure the second argument as a Record<string, unknown>
      this.logger.debug(`Event emitted: ${eventName}`, { args: args });
    }

    return super.emit(eventName, ...args);
  }

  /**
   * Override on to add logging
   */
  on(eventName: string | symbol, listener: (...args: any[]) => void): this {
    // Log when a listener is added
    if (typeof eventName === "string") {
      // Fix: Properly structure the second argument as a Record<string, unknown>
      this.logger.info(`Listener added for event: ${eventName}`, {
        listener: listener.name || "anonymous"
      });
    }

    return super.on(eventName, listener);
  }

  /**
   * Override once to add logging
   */
  once(eventName: string | symbol, listener: (...args: any[]) => void): this {
    // Log when a one-time listener is added
    if (typeof eventName === "string") {
      // Fix: Properly structure the second argument as a Record<string, unknown>
      this.logger.info(`One-time listener added for event: ${eventName}`, {
        listener: listener.name || "anonymous"
      });
    }

    return super.once(eventName, listener);
  }

  /**
   * Override removeListener to add logging
   */
  removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    // Log when a listener is removed
    if (typeof eventName === "string") {
      // Fix: Properly structure the second argument as a Record<string, unknown>
      this.logger.info(`Listener removed for event: ${eventName}`, {
        listener: listener.name || "anonymous"
      });
    }

    return super.removeListener(eventName, listener);
  }
}
