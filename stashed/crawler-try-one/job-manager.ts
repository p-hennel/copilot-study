import {
    MessageType,
    sendToBackend,
    type ControlCommandType,
    type JobStatus,
    type LoadStateRequest,
    type SaveStateRequest,
    type JobStatusUpdateMessage,
} from './ipc';
import type { JobPayload, JobState, FetcherState } from './types';
// Placeholder for actual fetcher implementations
// import { runFetcher } from './fetchers';
// Placeholder for storage implementation
// import { initializeStorage } from './storage';

interface ActiveJob {
    payload: JobPayload;
    status: JobStatus;
    state: JobState; // Current state (e.g., cursors) for each data type
    // Add references to active fetcher processes/promises if needed
    fetcherPromises?: Map<string, Promise<void>>; // Map dataType to its running promise
    abortControllers?: Map<string, AbortController>; // Map dataType to its AbortController
}

export class JobManager {
    private activeJobs: Map<string, ActiveJob> = new Map();

    constructor() {
        console.log(`[JobManager ${process.pid}] Initialized`);
    }

    // --- Public Methods (called from index.ts) ---

    public startJob(payload: JobPayload, initialState?: JobState): void {
        const jobId = payload.jobId;
        if (this.activeJobs.has(jobId)) {
            console.warn(`[JobManager ${process.pid}] Job ${jobId} is already active. Ignoring START_JOB command.`);
            // Optionally send an update back?
            return;
        }

        console.log(`[JobManager ${process.pid}] Starting job ${jobId} for path: ${payload.gitlabPath}`);

        const job: ActiveJob = {
            payload,
            status: 'started',
            state: initialState || {},
            fetcherPromises: new Map(),
            abortControllers: new Map(),
        };
        this.activeJobs.set(jobId, job);

        this.sendStatusUpdate(jobId, 'started');

        // Initialize storage for this job path
        // initializeStorage(payload.storageBasePath, payload.gitlabPath);

        // Start fetchers for each requested data type
        job.status = 'running';
        this.sendStatusUpdate(jobId, 'running', `Starting fetchers for ${payload.dataTypes.join(', ')}`);

        payload.dataTypes.forEach(dataType => {
            this.startFetcher(job, dataType);
        });

        // Monitor fetcher completion (basic example)
        this.monitorJobCompletion(jobId);
    }

    public handleControlCommand(command: ControlCommandType, jobId?: string): void {
        console.log(`[JobManager ${process.pid}] Handling command: ${command} for job ${jobId ?? 'all'}`);
        const targetJobIds = jobId ? [jobId] : Array.from(this.activeJobs.keys());

        targetJobIds.forEach(id => {
            const job = this.activeJobs.get(id);
            if (!job) {
                console.warn(`[JobManager ${process.pid}] Job ${id} not found for control command.`);
                return;
            }

            switch (command) {
                case 'PAUSE':
                    this.pauseJob(id, job);
                    break;
                case 'RESUME':
                    this.resumeJob(id, job);
                    break;
                case 'SHUTDOWN': // Handled in index.ts, but could trigger pausing here
                    this.pauseJob(id, job, true); // Pause before shutdown
                    break;
            }
        });
    }

    public handleLoadStateResponse(jobId: string, dataType: string, state: FetcherState | null): void {
        const job = this.activeJobs.get(jobId);
        if (!job) {
            console.warn(`[JobManager ${process.pid}] Received state for unknown job ${jobId}`);
            return;
        }
        console.log(`[JobManager ${process.pid}] Received state for ${jobId}/${dataType}:`, state);
        job.state[dataType] = state || {}; // Store the loaded state

        // If the job was waiting for this state to resume, start the fetcher
        if (job.status === 'paused') { // Or a more specific state like 'waiting_for_state'
            // Potentially check if all required states are loaded before resuming the job
             console.log(`[JobManager ${process.pid}] State loaded for paused job ${jobId}/${dataType}. Ready to resume.`);
             // We might need more logic here if resuming depends on multiple states
             // For now, assume resuming happens via explicit RESUME command
        }
         if (job.status === 'running' && !job.fetcherPromises?.has(dataType)) {
             // If the job is running but this fetcher wasn't started (e.g., waiting for state), start it now
             console.log(`[JobManager ${process.pid}] State loaded, starting fetcher for ${jobId}/${dataType}`);
             this.startFetcher(job, dataType);
         }
    }

    public async shutdown(): Promise<void> {
        console.log(`[JobManager ${process.pid}] Initiating shutdown...`);
        const pausePromises = Array.from(this.activeJobs.entries()).map(([jobId, job]) =>
            this.pauseJob(jobId, job, true) // Pause all jobs, indicating shutdown
        );
        await Promise.allSettled(pausePromises);
        console.log(`[JobManager ${process.pid}] All active jobs paused.`);
        this.activeJobs.clear();
    }


    // --- Internal Methods ---

    private startFetcher(job: ActiveJob, dataType: string): void {
        const jobId = job.payload.jobId;
        if (job.fetcherPromises?.has(dataType)) {
            console.warn(`[JobManager ${process.pid}] Fetcher for ${jobId}/${dataType} already running.`);
            return;
        }

        const initialFetcherState = job.state[dataType] || {};
        console.log(`[JobManager ${process.pid}] Starting fetcher for ${jobId}/${dataType} with state:`, initialFetcherState);

        const abortController = new AbortController();
        job.abortControllers?.set(dataType, abortController);

        // Placeholder for actual fetcher execution
        const fetcherPromise = (async () => {
            try {
                this.sendStatusUpdate(jobId, 'running', `Fetcher started: ${dataType}`);
                // --- Replace with actual fetcher call ---
                // await runFetcher(
                //     job.payload,
                //     dataType,
                //     initialFetcherState,
                //     (newState) => this.saveState(jobId, dataType, newState), // Callback to save state
                //     (progressUpdate) => this.sendStatusUpdate(jobId, 'running', progressUpdate, dataType), // Callback for progress
                //     abortController.signal // Pass signal for cancellation
                // );
                await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate work
                console.log(`[JobManager ${process.pid}] Fetcher completed successfully for ${jobId}/${dataType}`);
                 this.sendStatusUpdate(jobId, 'running', `Fetcher completed: ${dataType}`);
                // --- End Placeholder ---

            } catch (error: any) {
                 if (error.name === 'AbortError') {
                    console.log(`[JobManager ${process.pid}] Fetcher aborted for ${jobId}/${dataType}`);
                    this.sendStatusUpdate(jobId, job.status, `Fetcher aborted: ${dataType}`); // Keep job status (likely 'paused')
                 } else {
                    console.error(`[JobManager ${process.pid}] Fetcher failed for ${jobId}/${dataType}:`, error);
                    this.sendStatusUpdate(jobId, 'failed', `Fetcher failed: ${dataType} - ${error.message}`, dataType);
                    // Optionally mark the whole job as failed?
                    job.status = 'failed'; // Mark job as failed if one fetcher fails
                 }
            } finally {
                 job.fetcherPromises?.delete(dataType);
                 job.abortControllers?.delete(dataType);
                 this.checkJobCompletion(jobId); // Check if all fetchers for the job are done
            }
        })();

        job.fetcherPromises?.set(dataType, fetcherPromise);
    }

    private async monitorJobCompletion(jobId: string): Promise<void> {
        const job = this.activeJobs.get(jobId);
        if (!job || !job.fetcherPromises) return;

        // Wait for all initially started fetchers to complete
        await Promise.allSettled(Array.from(job.fetcherPromises.values()));

        // Double-check if the job still exists and hasn't failed or been paused/restarted
        const finalJobState = this.activeJobs.get(jobId);
        if (finalJobState && finalJobState.status === 'running' && finalJobState.fetcherPromises?.size === 0) {
            console.log(`[JobManager ${process.pid}] All fetchers completed for job ${jobId}. Marking as completed.`);
            finalJobState.status = 'completed';
            this.sendStatusUpdate(jobId, 'completed');
            // Optionally remove from activeJobs after a delay or confirmation?
            // this.activeJobs.delete(jobId);
        } else if (finalJobState && finalJobState.status !== 'failed' && finalJobState.status !== 'paused') {
             console.log(`[JobManager ${process.pid}] Job ${jobId} finished fetchers, but status is ${finalJobState.status}. Not marking completed.`);
        }
    }

     private checkJobCompletion(jobId: string): void {
        const job = this.activeJobs.get(jobId);
        // If the job is still considered running and all its fetcher promises are gone,
        // it means the last fetcher just finished.
        if (job && job.status === 'running' && job.fetcherPromises?.size === 0) {
            console.log(`[JobManager ${process.pid}] Last fetcher finished for job ${jobId}. Marking as completed.`);
            job.status = 'completed';
            this.sendStatusUpdate(jobId, 'completed');
            // Consider removing the job from activeJobs after completion?
            // this.activeJobs.delete(jobId);
        }
     }


    private async pauseJob(jobId: string, job: ActiveJob, isShutdown: boolean = false): Promise<void> {
        if (job.status !== 'running') {
            console.log(`[JobManager ${process.pid}] Job ${jobId} is not running, cannot pause (status: ${job.status}).`);
            return;
        }

        console.log(`[JobManager ${process.pid}] Pausing job ${jobId}...`);
        job.status = 'paused';
        this.sendStatusUpdate(jobId, 'paused', isShutdown ? 'Paused due to shutdown' : 'Paused by command');

        // Signal all active fetchers for this job to abort
        job.abortControllers?.forEach(controller => controller.abort());

        // Wait for fetchers to acknowledge abortion and potentially save state
        // (The fetcher's finally block should handle state saving via callback)
        if (job.fetcherPromises) {
            await Promise.allSettled(Array.from(job.fetcherPromises.values()));
        }

        console.log(`[JobManager ${process.pid}] Job ${jobId} paused. Current state saved by fetchers.`);
        // State saving is now handled via IPC request from the fetcher itself before it exits.
    }

    private resumeJob(jobId: string, job: ActiveJob): void {
        if (job.status !== 'paused') {
            console.log(`[JobManager ${process.pid}] Job ${jobId} is not paused, cannot resume (status: ${job.status}).`);
            return;
        }

        console.log(`[JobManager ${process.pid}] Resuming job ${jobId}...`);
        job.status = 'running'; // Set status back to running
        this.sendStatusUpdate(jobId, 'running', 'Resumed by command');

        // Clear any old controllers/promises before restarting
        job.abortControllers?.clear();
        job.fetcherPromises?.clear();


        // Request the latest state for all data types for this job before starting fetchers
        // Or, assume the state loaded via LOAD_STATE_RESPONSE is current enough if pause/resume is quick.
        // For simplicity here, we'll restart fetchers using the state currently held in job.state.
        // A more robust implementation might re-request state via LOAD_STATE_REQUEST here.

        job.payload.dataTypes.forEach(dataType => {
             console.log(`[JobManager ${process.pid}] Restarting fetcher for resumed job ${jobId}/${dataType}`);
            this.startFetcher(job, dataType);
        });

        this.monitorJobCompletion(jobId);
    }

    // --- IPC Communication Helpers ---

    private sendStatusUpdate(jobId: string, status: JobStatus, message?: string, dataType?: string, progress?: number): void {
        const updateMessage: JobStatusUpdateMessage = {
            type: MessageType.JOB_STATUS_UPDATE,
            jobId,
            status,
            ...(message && { message }),
            ...(dataType && { dataType }),
            ...(progress !== undefined && { progress }),
            ...(status === 'failed' && !message && { message: 'Job failed' }) // Default fail message
        };
        sendToBackend(updateMessage);
    }

    // Called by fetchers via callback when they need to save state
    public saveState(jobId: string, dataType: string, state: FetcherState): void {
         console.log(`[JobManager ${process.pid}] Requesting state save for ${jobId}/${dataType}:`, state);
        const request: SaveStateRequest = {
            type: MessageType.SAVE_STATE_REQUEST,
            jobId,
            dataType,
            state,
        };
        sendToBackend(request);
        // Update local state copy as well? Or wait for confirmation?
        const job = this.activeJobs.get(jobId);
        if (job) {
            job.state[dataType] = state;
        }
    }

    // Called by fetchers via callback when they need to load state (e.g., on resume)
    // Note: In the current flow, state is loaded via START_JOB or LOAD_STATE_RESPONSE
    // This might be needed if a fetcher itself decides it needs to reload state mid-run.
    public loadState(jobId: string, dataType: string): void {
         console.log(`[JobManager ${process.pid}] Requesting state load for ${jobId}/${dataType}`);
        const request: LoadStateRequest = {
            type: MessageType.LOAD_STATE_REQUEST,
            jobId,
            dataType,
        };
        sendToBackend(request);
        // The response will come via handleLoadStateResponse
    }
}
