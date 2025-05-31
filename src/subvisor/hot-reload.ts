import { EventEmitter } from "events";
import { watch } from "fs";
import { Supervisor } from "./supervisor";
import { getLogger } from "@logtape/logtape";
const logger = getLogger(["subvisor"]);

export class HotReloader extends EventEmitter {
  private supervisor: Supervisor;
  private watchers: Map<string, any> = new Map();
  private debounceTimers: Map<string, Timer> = new Map();

  constructor(supervisor: Supervisor) {
    super();
    this.supervisor = supervisor;
  }

  public watchProcess(processId: string, scriptPath: string): void {
    if (this.watchers.has(processId)) {
      // Already watching this process
      return;
    }

    try {
      const watcher = watch(scriptPath, { persistent: true }, (eventType) => {
        this.handleFileChange(processId, scriptPath, eventType);
      });

      this.watchers.set(processId, watcher);
      logger.info(`Watching ${scriptPath} for changes (process ${processId})`);
    } catch (err: any) {
      logger.error(`Failed to watch ${scriptPath}: ${err.message}`);
    }
  }

  public watchAllProcesses(): void {
    for (const [id, process] of this.supervisor["processes"].entries()) {
      const scriptPath = process.config.script;
      this.watchProcess(id, scriptPath);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private handleFileChange(processId: string, scriptPath: string, eventType: string): void {
    // Debounce to prevent multiple restarts for a single save
    if (this.debounceTimers.has(processId)) {
      clearTimeout(this.debounceTimers.get(processId)!);
    }

    this.debounceTimers.set(
      processId,
      setTimeout(() => {
        logger.info(`Detected change in ${scriptPath}, restarting process ${processId}`);

        this.emit("fileChanged", processId, scriptPath);

        // Restart the process
        const process = this.supervisor["processes"].get(processId);
        if (process) {
          process.stop().then(() => {
            process.start();
          });
        }
      }, 500)
    ); // 500ms debounce
  }

  public stopWatching(processId?: string): void {
    if (processId) {
      // Stop watching specific process
      if (this.watchers.has(processId)) {
        this.watchers.get(processId)!.close();
        this.watchers.delete(processId);
      }
    } else {
      // Stop all watchers
      for (const watcher of this.watchers.values()) {
        watcher.close();
      }
      this.watchers.clear();
    }
  }
}
