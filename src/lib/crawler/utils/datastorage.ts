import path from "path";
import { type FileSink } from "bun";
import { mkdir } from "node:fs/promises";
import { type Logger } from "@logtape/logtape";

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
  WorkItem = "workitems"
}

class DataStorage {
  baseDir: string;
  writers: Map<CollectionTypes, FileSink>;
  stopped = false;
  logger: Logger;
  heartbeatInterval: number;

  constructor(base: string[] | undefined, logger: Logger, heartbeatInterval = 10) {
    this.logger = logger;
    this.baseDir = DataStorage.getBaseDir(base);
    this.writers = new Map<CollectionTypes, FileSink>();
    this.logger.info(`Storage finished preparing at base directory: ${this.baseDir}`);
    this.heartbeatInterval = heartbeatInterval * 1000;
    this.heartbeat();
  }

  private readonly getWriter = (type: CollectionTypes): FileSink => {
    const filePath = path.join(this.baseDir, `${type}.jsonl`);
    // Create a new file writer with a ~100kB highWaterMark
    return Bun.file(filePath).writer({ highWaterMark: 1024 * 100 });
  };

  private getWriterForType(type: CollectionTypes): FileSink {
    if (!this.writers.has(type)) {
      this.writers.set(type, this.getWriter(type));
    }
    return this.writers.get(type)!;
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
    if (!(await Bun.file(baseDir).exists())) {
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

  public async save(type: CollectionTypes, data: any): Promise<void> {
    const writer = this.getWriterForType(type);
    if (Array.isArray(data)) {
      // Batch write the array of records as JSONL (one record per line)
      const lines = data.map(item => JSON.stringify(item)).join("\n") + "\n";
      await writer.write(lines);
      this.logger.debug(`Saved batch of data to ${path.join(this.baseDir, `${type}.jsonl`)}`);
    } else {
      // Write a single record as JSONL
      const line = JSON.stringify(data) + "\n";
      await writer.write(line);
      this.logger.debug(`Saved single record to ${path.join(this.baseDir, `${type}.jsonl`)}`);
    }
  }

  public async done(): Promise<void> {
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
