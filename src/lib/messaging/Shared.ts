import type { JobStatus } from "$lib/types";

export interface JobMessage {
  type: "job";
  data: any;
}

export interface RequestJobMessage {
  type: "requestJob";
}

export interface JobProgressMessage {
  type: "jobProgress";
  data: {
    jobId: string;
    status: JobStatus;
    details?: any;
  };
}
