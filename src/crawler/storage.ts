// src/crawler/storage.ts
import { join, dirname } from "path"
import { mkdir, appendFile } from "fs/promises"

/**
 * Handles storing crawled data into JSONL files within a structured directory tree.
 */
export class Storage {
  private baseDir: string

  /**
   * Creates a new Storage instance.
   * @param baseDir The root directory where crawled data will be stored.
   */
  constructor(baseDir: string) {
    this.baseDir = baseDir
    console.log(`Storage initialized with base directory: ${this.baseDir}`)
  }

  /**
   * Builds the full file path for a given data type and target path.
   * Example: ('issues', 'groups/my-group/projects/my-project') -> '/path/to/baseDir/groups/my-group/projects/my-project/issues.jsonl'
   * @param dataType The type of data being stored (e.g., 'issues', 'members').
   * @param targetPath The GitLab path (e.g., 'groups/my-group', 'projects/my-project').
   * @returns The full path to the JSONL file.
   */
  private getFilePath(dataType: string, targetPath: string): string {
    // Sanitize dataType and targetPath to prevent path traversal issues if necessary
    const safeDataType = dataType.replace(/[^a-zA-Z0-9_-]/g, "_")
    // Assuming targetPath is already structured like 'group/subgroup/project'
    const safeTargetPath = targetPath // Add sanitization if needed

    const filename = `${safeDataType}.jsonl`
    return join(this.baseDir, safeTargetPath, filename)
  }

  /**
   * Appends a data record to the appropriate JSONL file.
   * Creates directories if they don't exist.
   * @param dataType The type of data being stored.
   * @param targetPath The GitLab path associated with the data.
   * @param data The data record (JavaScript object) to store.
   */
  async storeRecord(dataType: string, targetPath: string, data: unknown): Promise<void> {
    const filePath = this.getFilePath(dataType, targetPath)
    const dirPath = dirname(filePath)

    try {
      // Ensure the directory exists
      await mkdir(dirPath, { recursive: true })

      // Prepare the JSONL line
      const jsonLine = JSON.stringify(data) + "\n"

      // Append the line to the file
      await appendFile(filePath, jsonLine, "utf-8")
      // console.log(`Stored record type '${dataType}' for path '${targetPath}'`); // Optional: verbose logging
    } catch (error) {
      console.error(`Error storing record to ${filePath}:`, error)
      // Decide on error handling: throw, log, retry?
      throw error // Re-throw for the job manager to handle
    }
  }

  /**
   * Appends multiple data records efficiently.
   * @param dataType The type of data being stored.
   * @param targetPath The GitLab path associated with the data.
   * @param records An array of data records to store.
   */
  async storeRecords(dataType: string, targetPath: string, records: unknown[]): Promise<void> {
    if (!records || records.length === 0) {
      return
    }

    const filePath = this.getFilePath(dataType, targetPath)
    const dirPath = dirname(filePath)

    try {
      await mkdir(dirPath, { recursive: true })

      const jsonLines = records.map((record) => JSON.stringify(record)).join("\n") + "\n"

      await appendFile(filePath, jsonLines, "utf-8")
      // console.log(`Stored ${records.length} records of type '${dataType}' for path '${targetPath}'`); // Optional: verbose logging
    } catch (error) {
      console.error(`Error storing multiple records to ${filePath}:`, error)
      throw error
    }
  }

  // Potential future methods:
  // - readRecords(dataType, targetPath)
  // - deleteData(targetPath)
  // - getMetadata(dataType, targetPath) -> Could read a separate metadata file or infer from file system
}
