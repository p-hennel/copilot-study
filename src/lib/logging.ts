import {
  compareLogLevel,
  configure,
  getAnsiColorFormatter,
  getConsoleSink,
  getLogger,
  getTextFormatter,
  withFilter,
  type LogRecord
} from "@logtape/logtape";
import { getOpenTelemetrySink } from "@logtape/otel";
import { getRotatingFileSink } from "@logtape/file";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdir } from "node:fs/promises";

export const complexFormatter = (
  formatterFactory: (options?: {}) => (record: any) => string,
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

    let props = record.properties;
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

export async function configureLogging(id: string | string[], verbose?: boolean, debug?: boolean) {
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

  await mkdir("logs", { recursive: true });

  const consoleLogLevel = debug ? "debug" : verbose ? "info" : "warning";
  const fileLogLevel = debug ? "debug" : "info";

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
      meta: getRotatingFileSink(`logs/${id.join("-")}.meta.log`, logfileOptions),
      logFile: withFilter(
        getRotatingFileSink(`logs/${id.join("-")}.log`, logfileOptions),
        (log) => compareLogLevel(log.level, fileLogLevel) >= 0
      ),
      errorFile: withFilter(
        getRotatingFileSink(`logs/${id.join("-")}.error.log`, logfileOptions),
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
        category: id,
        sinks
      }
    ]
  });
  return getLogger(id);
}

export function getCaller(parent: any) {
  const error = new Error();
  Error.captureStackTrace(error, parent);
  let stack = error.stack?.split("\n");
  // 6 / 5
  return !!stack && stack.length > 1 ? `${stack[1].replace(/\s*at\s?/, "")}` : "unknown";
}
