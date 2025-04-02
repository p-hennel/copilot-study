// logtapeAdapter.ts
import type { Logger as LogtapeLogger } from '@logtape/logtape';
import type { Logger as BetterAuthLogger, LogLevel as BetterAuthLogLevel } from 'better-auth';

/**
 * Creates a better‑auth compatible logger from an existing logtape logger.
 * 
 * @param ltLogger - A pre-configured logtape logger instance.
 * @returns A logger adapter that conforms to better‑auth's Logger interface.
 */
export function createLogtapeAdapter(ltLogger: LogtapeLogger, level: "info" | "warn" | "error" | "debug" | undefined = 'info'): BetterAuthLogger {
  return {
    // This property can be used to disable logging via better‑auth's options.
    disabled: false,
    // The logging level here is just a default placeholder.
    // The underlying logtape logger should already be configured with its own level.
    level,
    log: (level: BetterAuthLogLevel, message: string, ...args: any[]): void => {
      // Map 'success' (used in better‑auth) to 'info' since logtape doesn't have a 'success' level.
      const mappedLevel = level === 'success' ? 'info' : level;
      // Use the corresponding method from the provided logtape logger.
      const logMethod = (ltLogger as any)[mappedLevel];
      if (typeof logMethod === 'function') {
        logMethod.call(ltLogger, message, ...args);
      } else {
        // Fallback to info if the method is unavailable.
        ltLogger.info(message, ...args);
      }
    },
  };
}