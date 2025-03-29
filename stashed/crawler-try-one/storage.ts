import { join, dirname } from 'node:path';
import { mkdir } from 'node:fs/promises'; // Using Node's fs/promises for mkdir recursive

/**
 * Determines the full file path for storing data of a specific type
 * related to a GitLab path.
 * Example: getStoragePath('/data', 'group/subgroup/project', 'issues')
 *       -> '/data/group/subgroup/project/issues.jsonl'
 *
 * @param basePath The root directory for all crawler data.
 * @param gitlabPath The GitLab path (e.g., 'group/project').
 * @param dataType The type of data being stored (e.g., 'issues', 'members').
 * @returns The full path to the JSONL file.
 */
export function getStoragePath(basePath: string, gitlabPath: string, dataType: string): string {
    // Ensure dataType is filename-safe (basic example)
    const safeDataType = dataType.replace(/[^a-z0-9_-]/gi, '_');
    const filename = `${safeDataType}.jsonl`;
    // Join base path, gitlab path components, and filename
    return join(basePath, gitlabPath, filename);
}

/**
 * Appends a single data record (as a JSON string) to a JSONL file.
 * Ensures the target directory exists before writing.
 *
 * @param filePath The full path to the JSONL file.
 * @param jsonData The data record (object) to append.
 */
export async function appendToJsonl(filePath: string, jsonData: object): Promise<void> {
    try {
        // Ensure the directory exists
        const dir = dirname(filePath);
        // Use { recursive: true } which is standard in Node.js fs/promises
        // Bun's mkdir also supports this.
        await mkdir(dir, { recursive: true });

        // Stringify the JSON object and add a newline
        const line = JSON.stringify(jsonData) + '\n';

        // Append the line to the file using Bun's efficient writer
        // Bun.write handles file creation if it doesn't exist and appends efficiently.
        await Bun.write(filePath, line);

    } catch (error) {
        console.error(`[Storage] Error appending to ${filePath}:`, error);
        // Re-throw or handle as needed
        throw error;
    }
}

/**
 * Initializes storage for a specific job, primarily ensuring the base
 * directory for the GitLab path exists. Usually called once per job start.
 *
 * @param basePath The root directory for all crawler data.
 * @param gitlabPath The GitLab path for the current job.
 */
export async function initializeStorage(basePath: string, gitlabPath: string): Promise<void> {
     try {
        const jobBasePath = join(basePath, gitlabPath);
        await mkdir(jobBasePath, { recursive: true });
        console.log(`[Storage] Ensured base directory exists: ${jobBasePath}`);
    } catch (error) {
        console.error(`[Storage] Error initializing storage for ${gitlabPath}:`, error);
        throw error;
    }
}

// Example Usage (would be called from a fetcher)
/*
async function exampleUsage() {
    const basePath = './crawler_output'; // Configurable base path
    const gitlabPath = 'my-group/my-project';
    const dataType = 'issues';
    const issueData = { id: 123, title: 'Fix the bug', state: 'opened' };

    await initializeStorage(basePath, gitlabPath); // Ensure base dir exists

    const filePath = getStoragePath(basePath, gitlabPath, dataType);
    await appendToJsonl(filePath, issueData);

    const anotherIssue = { id: 124, title: 'Add feature', state: 'opened' };
    await appendToJsonl(filePath, anotherIssue);

    console.log(`[Storage Example] Data appended to ${filePath}`);
}

// exampleUsage();
*/
