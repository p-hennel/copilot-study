// src/monitoring.ts
import { getLogger } from '@logtape/logtape';
import { type Server } from 'bun';
import { type SettingsChangeEvent } from 'settings';
import { supervisorSettings } from './settings';
import { Supervisor } from './supervisor';
import { ProcessState } from './types';

export class MonitoringServer {
  private server: Server | null = null;
  private supervisor: Supervisor;
  private port: number;
  private logger: ReturnType<typeof getLogger>;
  private settingsUnsubscribe: (() => void) | null = null;
  
  constructor(supervisor: Supervisor) {
    this.supervisor = supervisor;
    
    // Get port from settings
    const config = supervisorSettings.getSettings();
    this.port = config.monitoringPort || 9090;
    
    // Initialize logger
    this.logger = getLogger(['monitoring']);
    
    // Subscribe to settings changes
    this.settingsUnsubscribe = supervisorSettings.onChange(this.handleSettingsChange.bind(this));
  }
  
  /**
   * Handle settings changes that affect monitoring
   */
  private handleSettingsChange(event: SettingsChangeEvent): void {
    const oldConfig = event.previousSettings as any;
    const newConfig = event.currentSettings as any;
    
    // Check if monitoring port changed
    if (oldConfig.monitoringPort !== newConfig.monitoringPort) {
      this.logger.info(`Monitoring port changed from ${oldConfig.monitoringPort} to ${newConfig.monitoringPort}`);
      this.port = newConfig.monitoringPort;
      
      // Restart server with new port
      if (this.server) {
        this.stop();
        this.start();
      }
    }
    
    // Check if monitoring was enabled/disabled
    if (oldConfig.enableMonitoring !== newConfig.enableMonitoring) {
      if (newConfig.enableMonitoring) {
        this.logger.info('Monitoring enabled, starting server');
        this.start();
      } else {
        this.logger.info('Monitoring disabled, stopping server');
        this.stop();
      }
    }
  }
  
  public start(): void {
    // Only start if monitoring is enabled in settings
    const config = supervisorSettings.getSettings();
    if (!config.enableMonitoring) {
      this.logger.info('Monitoring is disabled in settings, not starting server');
      return;
    }
    
    if (this.server) {
      this.stop();
    }
    
    this.server = Bun.serve({
      port: this.port,
      fetch: (req) => {
        const url = new URL(req.url);
        
        if (url.pathname === '/metrics') {
          return this.handleMetricsRequest();
        }
        
        if (url.pathname === '/health') {
          return this.handleHealthRequest();
        }
        
        if (url.pathname === '/processes') {
          return this.handleProcessListRequest();
        }
        
        // New endpoint to access settings
        if (url.pathname === '/settings') {
          return this.handleSettingsRequest();
        }
        
        return new Response('Not Found', { status: 404 });
      },
    });
    
    this.logger.info(`Monitoring server started on http://localhost:${this.port}`);
  }
  
  public stop(): void {
    if (this.server) {
      this.server.stop();
      this.server = null;
      this.logger.info('Monitoring server stopped');
    }
    
    if (this.settingsUnsubscribe) {
      this.settingsUnsubscribe();
      this.settingsUnsubscribe = null;
    }
  }
  
  private handleMetricsRequest(): Response {
    // Generate Prometheus-compatible metrics
    const metrics = [
      '# HELP supervisor_process_count Number of managed processes',
      '# TYPE supervisor_process_count gauge',
      `supervisor_process_count ${this.supervisor['processes'].size}`,
      '',
      '# HELP supervisor_process_state Process state (1 = active, 0 = inactive)',
      '# TYPE supervisor_process_state gauge'
    ];
    
    // Add process-specific metrics
    for (const [id, process] of this.supervisor['processes'].entries()) {
      const state = process.getState();
      const isActive = state === ProcessState.IDLE || state === ProcessState.BUSY;
      
      metrics.push(`supervisor_process_state{id="${id}",state="${state}"} ${isActive ? 1 : 0}`);
    }
    
    // Add more metrics
    metrics.push('');
    metrics.push('# HELP supervisor_process_restart_count Process restart count');
    metrics.push('# TYPE supervisor_process_restart_count counter');
    
    for (const [id, process] of this.supervisor['processes'].entries()) {
      metrics.push(`supervisor_process_restart_count{id="${id}"} ${process.getRestartCount() || 0}`);
    }
    
    return new Response(metrics.join('\n'), {
      headers: { 'Content-Type': 'text/plain' }
    });
  }
  
  private handleHealthRequest(): Response {
    // Simple health check - consider unhealthy if too many processes are failed
    const processes = this.supervisor['processes'];
    const failedCount = Array.from(processes.values())
      .filter(p => p.getState() === ProcessState.FAILED)
      .length;
    
    const healthy = failedCount < processes.size / 2; // Less than half failed
    
    return new Response(JSON.stringify({
      healthy,
      status: healthy ? 'ok' : 'degraded',
      failed_processes: failedCount,
      total_processes: processes.size,
      supervisor_uptime: process.uptime(),
    }), {
      status: healthy ? 200 : 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  private handleProcessListRequest(): Response {
    const processes = Array.from(this.supervisor['processes'].entries()).map(([id, proc]) => {
      const health = proc.getHealth();
      return {
        id,
        state: proc.getState(),
        uptime: health.uptime,
        restarts: proc.getRestartCount(),
        cpu: health.cpu,
        memory: health.memory,
        pid: health.pid
      };
    });
    
    return new Response(JSON.stringify(processes), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  private handleSettingsRequest(): Response {
    // Get the current settings
    const settings = supervisorSettings.getSettings();
    
    // For security, we redact any secret or sensitive information
    const safeSettings = { ...settings };
    
    // Remove environment variables that might contain secrets
    if (safeSettings.processes) {
      safeSettings.processes = safeSettings.processes.map((proc: any) => {
        if (proc.env) {
          // Create a new object without env
          const { env, ...rest } = proc;
          return rest;
        }
        return proc;
      });
    }
    
    return new Response(JSON.stringify(safeSettings, null, 2), {
      headers: { 'Content-Type': 'application/json' }
    });
  }
}