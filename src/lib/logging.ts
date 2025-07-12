
import {
  compareLogLevel,
  configure,
  getAnsiColorFormatter,
  getConsoleSink,
  getLogger, // Centralized logger import
  getTextFormatter,
  withFilter,
  type LogRecord
} from "@logtape/logtape";
// Re-export getLogger so other modules can use it via this central logging module
export { getLogger };
import { getOpenTelemetrySink } from "@logtape/otel";
import { getRotatingFileSink } from "@logtape/file";
import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import { mkdir } from "node:fs/promises";


/**
 * Formats log records with optional property expansion for structured logging.
 * @param formatterFactory - Factory for the base formatter (text or color)
 * @param formatterFactoryOptions - Options for the formatter
 * @param allParams - Whether to include all properties in the output
 * @param spacer - String to separate message and properties
 * @returns A function that formats a LogRecord
 */
export const complexFormatter = (
  formatterFactory: (options?: object) => (record: any) => string,
  formatterFactoryOptions: any = {},
  allParams = true,
  spacer = "\n"
) => {
  formatterFactoryOptions = {
    timestamp: "date-time",
    value: (v: any) => (typeof v === "object" ? Bun.inspect(v) : v),
    ...formatterFactoryOptions
  };

  const formatter = formatterFactory(formatterFactoryOptions);
  return (record: LogRecord) => {
    if (!allParams || !record.properties || Object.keys(record.properties).length <= 0) {
      return formatter(record);
    }

    const props = record.properties;
    for (const prop in props) {
      if (record.rawMessage.includes(`{${prop}}`)) {
        delete props[prop];
      }
    }

    let message: unknown[] = Object.assign([], record.message);

    if (Object.keys(props).length > 0) {
      if (message.length <= 0) message = [`${record.rawMessage}${spacer}`];
      else if (message.length % 2 !== 0) message.push(`${message.pop()}${spacer}`);
      else message.push(spacer, spacer);
      message.push(props);
    }

    return formatter({
      ...record,
      message
    } as LogRecord);
  };
};


/**
 * Determines the log level from environment variables.
 * Supports LOG_LEVEL and DEBUG env vars.
 */
function getLogLevelFromEnv(): "info" | "debug" | "warning" | "error" | "fatal" | undefined {
  const envKeys = Object.keys(Bun.env);
  if (envKeys.includes("LOG_LEVEL")) {
    const val = Bun.env["LOG_LEVEL"];
    if (val && val.length > 0) {
      const possibleValues = ["info", "debug", "warning", "error", "fatal"];
      if (possibleValues.includes(val.toLowerCase()))
        return val as "info" | "debug" | "warning" | "error" | "fatal";
    }
    return undefined;
  }
  if (envKeys.includes("DEBUG")) {
    const val = Bun.env["DEBUG"];
    return val &&
      (val.toLowerCase() === "true" || val.toLowerCase() === "yes" || val.toLowerCase() === "1")
      ? "debug"
      : undefined;
  }
  return undefined;
}


/**
 * Configures the logging system for the application.
 * Sets up console, file, and OpenTelemetry sinks with appropriate formatters and log levels.
 * @param id - Logger category or categories
 * @param basePath - Directory for log files
 * @param verbose - Enable verbose logging
 * @param debug - Enable debug logging
 * @returns Logger instance for the given category
 */
export async function configureLogging(
  id: string | string[],
  basePath: string,
  verbose?: boolean,
  debug?: boolean
) {
  if (!Array.isArray(id)) id = [id];
  if (verbose === undefined) verbose = false;
  if (debug === undefined) debug = false;

  const plainFormatter = complexFormatter(getTextFormatter);
  const colorFormatter = complexFormatter(getAnsiColorFormatter, {}, false);

  const logfileOptions = {
    maxSize: 0x400 * 0x400, // 1 MiB
    maxFiles: 3,
    formatter: plainFormatter
  };

  try {
    await mkdir("logs", { recursive: true });
  } catch {
    /* Directory may already exist */
  }

  // Get log level from environment or use defaults
  const envLogLevel = getLogLevelFromEnv();
  const consoleLogLevel = envLogLevel || (debug ? "debug" : verbose ? "info" : "info");
  const fileLogLevel = envLogLevel || (debug ? "debug" : "info");

  const sinks = ["console", "logFile", "errorFile"];
  if (!debug && !verbose) {
    sinks.push("otel");
  }

  await configure({
    reset: true,
    contextLocalStorage: new AsyncLocalStorage(),
    sinks: {
      console: withFilter(
        getConsoleSink({
          formatter: colorFormatter
        }),
        (log) => compareLogLevel(log.level, consoleLogLevel) >= 0
      ),
      meta: getRotatingFileSink(path.join(basePath, `${id.join("-")}.meta.log`), logfileOptions),
      logFile: withFilter(
        getRotatingFileSink(path.join(basePath, `${id.join("-")}.log`), logfileOptions),
        (log) => compareLogLevel(log.level, fileLogLevel) >= 0
      ),
      errorFile: withFilter(
        getRotatingFileSink(path.join(basePath, `${id.join("-")}.error.log`), logfileOptions),
        (log) => compareLogLevel(log.level, "error") >= 0
      ),
      otel: getOpenTelemetrySink({
        serviceName: "ai-survey-service"
      })
    },
    loggers: [
      {
        category: ["logtape", "meta"],
        sinks: ["meta"],
        lowestLevel: "warning"
      },
      {
        // Catch-all logger for any category not explicitly configured
        category: [],
        sinks,
        lowestLevel: debug ? "debug" : "info"
      }
    ]
  });
  return getLogger(id);
}


/**
 * Returns the caller's stack frame for debugging/logging purposes.
 * @param parent - The function to exclude from the stack trace
 * @returns The caller's stack frame as a string
 */
export function getCaller(parent: any) {
  const error = new Error();
  Error.captureStackTrace(error, parent);
  const stack = error.stack?.split("\n");
  // Check if stack exists, has enough lines, and the specific line exists before accessing it
  if (stack && stack.length > 1 && stack[1]) {
    return stack[1].replace(/\s*at\s?/, "");
  }
  return "unknown"; // Return "unknown" if stack is not available, too short, or the line is undefined
}
