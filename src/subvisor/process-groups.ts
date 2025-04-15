import { Supervisor } from "./supervisor";
import { ProcessState } from "./types";

export interface ProcessGroupConfig {
  name: string;
  description?: string;
  processes: string[];
}

export class ProcessGroupManager {
  private supervisor: Supervisor;
  private groups: Map<string, ProcessGroupConfig> = new Map();

  constructor(supervisor: Supervisor, groupConfigs: ProcessGroupConfig[] = []) {
    this.supervisor = supervisor;

    // Initialize groups
    for (const group of groupConfigs) {
      this.groups.set(group.name, group);
    }
  }

  public addGroup(config: ProcessGroupConfig): void {
    if (this.groups.has(config.name)) {
      throw new Error(`Group already exists: ${config.name}`);
    }

    // Validate that all processes exist
    for (const processId of config.processes) {
      if (!this.supervisor["processes"].has(processId)) {
        throw new Error(`Process not found: ${processId}`);
      }
    }

    this.groups.set(config.name, config);
  }

  public getGroup(name: string): ProcessGroupConfig | undefined {
    return this.groups.get(name);
  }

  public getAllGroups(): ProcessGroupConfig[] {
    return Array.from(this.groups.values());
  }

  public async startGroup(name: string): Promise<void> {
    const group = this.groups.get(name);
    if (!group) {
      throw new Error(`Group not found: ${name}`);
    }

    console.log(`Starting group: ${name}`);

    // Start all processes in the group
    for (const processId of group.processes) {
      const process = this.supervisor["processes"].get(processId);
      if (process) {
        process.start();
        // Small delay to prevent resource contention
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  public async stopGroup(name: string): Promise<void> {
    const group = this.groups.get(name);
    if (!group) {
      throw new Error(`Group not found: ${name}`);
    }

    console.log(`Stopping group: ${name}`);

    // Stop all processes in the group
    const stopPromises = [];
    for (const processId of group.processes) {
      const process = this.supervisor["processes"].get(processId);
      if (process) {
        stopPromises.push(process.stop());
      }
    }

    await Promise.all(stopPromises);
  }

  public async restartGroup(name: string): Promise<void> {
    await this.stopGroup(name);
    // Small delay to ensure all processes are fully stopped
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await this.startGroup(name);
  }

  public getGroupStatus(name: string): {
    name: string;
    processes: { id: string; state: ProcessState }[];
  } {
    const group = this.groups.get(name);
    if (!group) {
      throw new Error(`Group not found: ${name}`);
    }

    const processes = group.processes.map((processId) => {
      const process = this.supervisor["processes"].get(processId);
      return {
        id: processId,
        state: process ? process.getState() : ProcessState.STOPPED
      };
    });

    return {
      name: group.name,
      processes
    };
  }
}
