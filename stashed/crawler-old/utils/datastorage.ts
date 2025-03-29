import path from "path";
//import { type FileSink } from "bun";
import { mkdir } from "node:fs/promises";
import { type Logger } from "@logtape/logtape";
import { dirname } from "node:path"; // Import dirname

export enum CollectionTypes {
  User = "users",
  Group = "groups",
  Project = "projects",
  Timelog = "timelogs",
  Vulnerability = "vulnerabilities",
  Pipeline = "pipelines",
  Issue = "issues",
  Mergerequest = "mergerequests",
  Milestone = "milestones",
  Branch = "branches",
  Release = "releases",
  Discussion = "discussions",
  Commit = "commits",
  WorkItem = "workitems",
  Label = "labels" // Added Label
}

type FileSink = globalThis.Bun.FileSink;

// Define the type for area context
export type AreaContext = {
  fullPath: string | null;
  type: "group" | "project" | "global";
};

class DataStorage {
  baseDir: string;
  writers: Map<string, FileSink>; // Key is now the full file path
  stopped = false;
  logger: Logger;
  heartbeatInterval: number;

  constructor(base: string[] | undefined, logger: Logger, heartbeatInterval = 10) {
    this.logger = logger;
    this.baseDir = DataStorage.getBaseDir(base);
    this.writers = new Map<string, FileSink>(); // Initialize map for string keys
    this.logger.info(`Storage finished preparing at base directory: ${this.baseDir}`);
    this.heartbeatInterval = heartbeatInterval * 1000;
    this.heartbeat();
  }

  // Creates a writer for a specific file path
  private readonly createWriter = (filePath: string): FileSink => {
    // Create a new file writer with a ~100kB highWaterMark
    return globalThis.Bun.file(filePath).writer({ highWaterMark: 1024 * 100 });
  };

  // Gets or creates a writer for a given file path, ensuring the directory exists
  private async getWriterForPath(filePath: string): Promise<FileSink> {
    if (!this.writers.has(filePath)) {
      const dir = dirname(filePath);
      // Ensure the directory exists before creating the writer
      await mkdir(dir, { recursive: true });
      this.writers.set(filePath, this.createWriter(filePath));
      this.logger.debug(`Created writer for path: ${filePath}`);
    }
    return this.writers.get(filePath)!;
  }

  // Calculates the target file path based on context
  private getTargetFilePath(type: CollectionTypes, context: AreaContext): string {
    if (context.type === "global" || !context.fullPath) {
      // Global data or data without specific path context
      return path.join(this.baseDir, `${type}.jsonl`);
    } else if (context.type === "group") {
      // Group-specific data
      return path.join(this.baseDir, "groups", context.fullPath, `${type}.jsonl`);
    } else if (context.type === "project") {
      // Project-specific data
      return path.join(this.baseDir, "projects", context.fullPath, `${type}.jsonl`);
    } else {
      // Fallback or unknown type - place in base directory
      this.logger.warn(
        `Unknown area type "${context.type}" for path "${context.fullPath}". Saving to base directory.`
      );
      return path.join(this.baseDir, `${type}.jsonl`);
    }
  }

  static getBaseDir(base?: string[]) {
    if (base && base.length > 0 && path.isAbsolute(base[0])) {
      return path.join(...base);
    }
    const __dir = import.meta.dir;
    return path.resolve(path.join(__dir, "data", ...(base ?? [])));
  }

  static async prepare(base?: string[]) {
    const baseDir = DataStorage.getBaseDir(base);
    if (!(await globalThis.Bun.file(baseDir).exists())) {
      await mkdir(baseDir, { recursive: true });
    }
  }

  private async heartbeat(): Promise<void> {
    // Heartbeat functionality is currently not implemented.
    // Uncomment and add logic if periodic tasks are needed.
    /*
    this.logger.debug("sending heartbeat...");
    // Implement heartbeat logic here, e.g., flushing buffers, monitoring system health, etc.
    if (!this.stopped) {
      await new Promise(resolve => setTimeout(resolve, this.heartbeatInterval));
      return this.heartbeat();
    }
    */
  }

  // Updated save method to accept context
  public async save(type: CollectionTypes, data: any, context: AreaContext): Promise<void> {
    if (this.stopped) {
      this.logger.warn("Attempted to save data after storage was stopped.", { type, context });
      return;
    }

    const targetFilePath = this.getTargetFilePath(type, context);
    const writer = await this.getWriterForPath(targetFilePath);

    try {
      if (Array.isArray(data)) {
        if (data.length === 0) return; // Don't write empty arrays
        // Batch write the array of records as JSONL (one record per line)
        const lines = data.map((item) => JSON.stringify(item)).join("\n") + "\n";
        const flushed = writer.write(lines);
        if (!flushed) {
          // Handle backpressure if needed, e.g., await writer.ready;
          await writer.flush(); // Or just flush immediately for simplicity now
        }
        this.logger.debug(`Saved batch of ${data.length} items to ${targetFilePath}`);
      } else if (data) {
        // Ensure data is not null/undefined
        // Write a single record as JSONL
        const line = JSON.stringify(data) + "\n";
        const flushed = writer.write(line);
        if (!flushed) {
          await writer.flush();
        }
        this.logger.debug(`Saved single record to ${targetFilePath}`);
      }
    } catch (error) {
      this.logger.error(`Error writing to ${targetFilePath}: {error}`, { error });
      // Optionally, attempt to remove the writer from cache if it's potentially corrupted
      // this.writers.delete(targetFilePath);
    }
  }

  public async done(): Promise<void> {
    this.stopped = true; // Prevent further writes
    this.logger.info("Wrapping up storage...");
    // End only the writers that have been created
    const endPromises: Promise<void>[] = [];
    for (const writer of this.writers.values()) {
      endPromises.push(Promise.resolve(writer.end()).then(() => {}));
    }
    await Promise.all(endPromises);
    this.logger.info("Storage wrap up complete.");
  }
}

export default DataStorage;
