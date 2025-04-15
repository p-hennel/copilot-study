/**
 * File system utilities for data storage
 * 
 * @packageDocumentation
 */
import { mkdir } from "node:fs/promises";

/**
 * Ensure a directory exists, creating it if necessary
 * 
 * @param dirPath - Directory path to ensure
 */
export async function ensureDirectoryExists(dirPath: string): Promise<void> {
  try {
    await mkdir(dirPath, { recursive: true });
  } catch (error) {
    // Directory might already exist or there's a permission issue
    const err = error as Error;
    if (!err.message.includes('EEXIST')) {
      throw error;
    }
  }
}

/**
 * Save data to a JSONL file (each object on a new line)
 * 
 * @param filePath - Path to save the file
 * @param data - Array of objects to save
 */
export async function saveJsonlFile(filePath: string, data: any[]): Promise<void> {
  // Ensure parent directory exists
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
  await ensureDirectoryExists(dirPath);
  
  // Convert array to JSONL format (each object on a separate line)
  const jsonlContent = data.map(item => JSON.stringify(item)).join('\n');
  
  // Write to file
  await Bun.write(filePath, jsonlContent);
}

/**
 * Save a single object to a JSON file
 * 
 * @param filePath - Path to save the file
 * @param data - Object to save
 */
export async function saveJsonFile(filePath: string, data: any): Promise<void> {
  // Ensure parent directory exists
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
  await ensureDirectoryExists(dirPath);
  
  // Write to file
  await Bun.write(filePath, JSON.stringify(data, null, 2));
}

/**
 * Append data to an existing JSONL file or create if it doesn't exist
 * 
 * @param filePath - Path to the file
 * @param data - Single object or array of objects to append
 */
export async function appendToJsonlFile(filePath: string, data: any | any[]): Promise<void> {
  // Ensure parent directory exists
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
  await ensureDirectoryExists(dirPath);
  
  // Convert to array if single object
  const dataArray = Array.isArray(data) ? data : [data];
  
  // Convert to JSONL lines
  const jsonlLines = dataArray.map(item => JSON.stringify(item)).join('\n');
  
  try {
    // Check if file exists
    const file = Bun.file(filePath);
    const exists = await file.exists();
    
    if (exists) {
      // Append to existing file with a newline separator
      const existingContent = await Bun.file(filePath).text();
      const separator = existingContent.endsWith('\n') ? '' : '\n';
      await Bun.write(filePath, `${existingContent}${separator}${jsonlLines}`);
    } else {
      // Create new file
      await Bun.write(filePath, jsonlLines);
    }
  } catch (error) {
    throw new Error(`Failed to append to ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Read a JSON file
 * 
 * @param filePath - Path to the file
 * @returns Parsed JSON content
 */
export async function readJsonFile<T = any>(filePath: string): Promise<T> {
  try {
    const file = Bun.file(filePath);
    
    if (!await file.exists()) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    return (await (Bun.file(filePath)).json()) as T;
  } catch (error) {
    throw new Error(`Failed to read JSON file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Read a JSONL file and parse each line as a separate object
 * 
 * @param filePath - Path to the file
 * @returns Array of parsed objects
 */
export async function readJsonlFile<T = any>(filePath: string): Promise<T[]> {
  try {
    const file = Bun.file(filePath);
    
    if (!await file.exists()) {
      throw new Error(`File not found: ${filePath}`);
    }
    
    const content = await Bun.file(filePath).text();
    
    // Split by newlines and parse each line
    return content
      .split('\n')
      .filter(line => line.trim() !== '') // Skip empty lines
      .map(line => JSON.parse(line) as T);
  } catch (error) {
    throw new Error(`Failed to read JSONL file ${filePath}: ${error instanceof Error ? error.message : String(error)}`);
  }
}