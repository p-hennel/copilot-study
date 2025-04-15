import { Supervisor } from './supervisor';
import { ProcessState } from './types';

export class RollingUpdater {
  private supervisor: Supervisor;
  private updateInProgress: boolean = false;
  
  constructor(supervisor: Supervisor) {
    this.supervisor = supervisor;
  }
  
  public async performRollingUpdate(
    processIds: string[],
    options: { 
      waitTime?: number,
      healthCheckFn?: (processId: string) => Promise<boolean>
    } = {}
  ): Promise<boolean> {
    if (this.updateInProgress) {
      throw new Error('Another rolling update is already in progress');
    }
    
    this.updateInProgress = true;
    const waitTime = options.waitTime || 5000; // Default 5 seconds between updates
    
    try {
      console.log(`Starting rolling update for ${processIds.length} processes`);
      
      for (const processId of processIds) {
        const process = this.supervisor['processes'].get(processId);
        if (!process) {
          console.warn(`Process not found, skipping: ${processId}`);
          continue;
        }
        
        console.log(`Updating ${processId}...`);
        
        // Restart the process
        await process.stop();
        process.start();
        
        // Wait for the process to be ready
        const isHealthy = await this.waitForProcessReady(
          processId, 
          options.healthCheckFn
        );
        
        if (!isHealthy) {
          console.error(`Process ${processId} failed to become healthy after restart`);
          // Optionally implement rollback logic here
          this.updateInProgress = false;
          return false;
        }
        
        // Wait before updating the next process
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
      
      console.log('Rolling update completed successfully');
      this.updateInProgress = false;
      return true;
    } catch (err: any) {
      console.error(`Rolling update failed: ${err.message}`);
      this.updateInProgress = false;
      return false;
    }
  }
  
  private async waitForProcessReady(
    processId: string,
    healthCheckFn?: (processId: string) => Promise<boolean>
  ): Promise<boolean> {
    const maxWaitTime = 60000; // 1 minute maximum wait
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWaitTime) {
      const process = this.supervisor['processes'].get(processId);
      if (!process) return false;
      
      const state = process.getState();
      
      // If there's a custom health check, use it
      if (healthCheckFn) {
        try {
          const isHealthy = await healthCheckFn(processId);
          if (isHealthy) return true;
        } catch (err: any) {
          console.warn(`Health check failed for ${processId}: ${err.message}`);
        }
      } else {
        // Otherwise use basic state check
        if (state === ProcessState.IDLE || state === ProcessState.BUSY) {
          return true;
        }
      }
      
      // Check if process failed
      if (state === ProcessState.FAILED) {
        return false;
      }
      
      // Wait before checking again
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    return false; // Timed out waiting
  }
  
  public isUpdateInProgress(): boolean {
    return this.updateInProgress;
  }
}