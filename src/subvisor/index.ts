/**
 * Subvisor exports index
 */

// Export the main Supervisor class and related types
export { Supervisor } from './supervisor';
export { MessageType, ProcessState, type ProcessConfig } from './types';

// Export the simplified supervisor class for easier usage
export { SimplifiedSupervisor } from './simplified-supervisor';

// Export settings helpers
export {
  getSettings, supervisorSettings, validateConfig,
  type SupervisorConfig
} from './settings';

// Export ManagedProcess for advanced usage
export { ManagedProcess } from './managed-process';

// Export client class for process-to-process communication
export { SupervisorClient } from './client';
