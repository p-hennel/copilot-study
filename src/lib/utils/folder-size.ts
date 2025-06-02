import { stat, readdir } from 'fs/promises';
import { join, resolve } from 'path';
import { getBasicDiskSpace } from './disk-space';
import type { Dirent } from 'fs';
import DirEnt, { FilterDirEntResult } from "./DirEnt"
import { timestamp } from 'drizzle-orm/gel-core';

/**
 * Configuration options for folder size calculation
 */
export interface FolderSizeOptions {
	/** Maximum age of cache in milliseconds (default: 10 minutes) */
	maxCacheAge?: number;
	/** Whether to include hidden files and folders (default: false) */
	includeHidden?: boolean;
}

/**
 * Result of folder size calculation with disk space information
 */
export interface FolderSizeWithSpace {
	/** Used space in bytes */
	used: number;
	/** Available space in bytes */
	available: number;
	/** Total disk space in bytes */
	total: number;
}

/**
 * Cache entry structure for folder size
 */
interface CacheEntry {
	size: number;
	timestamp: number;
}

const DEFAULT_CACHE_AGE = 10 * 60 * 1000; // 10 minutes in milliseconds
const CACHE_FILE_NAME = '.folder.bytes';

/**
 * Checks if a cache file exists and is valid
 * @param folderPath - Path to the folder being checked
 * @param maxCacheAge - Maximum age of cache in milliseconds
 * @returns Promise<CacheEntry | null> - Cache entry if valid, null otherwise
 */
async function getCacheEntry(folderPath: string, maxCacheAge: number): Promise<CacheEntry | null> {
	const cacheFilePath = join(folderPath, CACHE_FILE_NAME);
	
	try {
		const cacheFile = Bun.file(cacheFilePath);
		
		// Check if cache file exists
		if (!(await cacheFile.exists())) {
			return null;
		}

		// Check if cache is too old
		if (Date.now() - cacheFile.lastModified > maxCacheAge) {
			return null;
		}

		// Read and parse cache content
		const cacheContent = await cacheFile.text();
		
		// Validate cache against file modifications
		if (await isCacheStale(folderPath, cacheFile.lastModified)) {
			return null;
		}

		return {
			size: parseInt(cacheContent),
			timestamp: cacheFile.lastModified
		};
	} catch {
		// If any error occurs, treat as invalid cache
		return null;
	}
}

/**
 * Checks if any files in the folder have been modified after the cache timestamp
 * @param folderPath - Path to the folder
 * @param cacheTimestamp - Timestamp when cache was created
 * @returns Promise<boolean> - True if cache is stale, false otherwise
 */
async function isCacheStale(folderPath: string, cacheTimestamp: number): Promise<boolean> {
	try {
		const entries = await readdir(folderPath, { withFileTypes: true });
		
		for (const entry of entries) {
			// Skip the cache file itself and hidden files
			if (entry.name === CACHE_FILE_NAME || entry.name.startsWith('.')) {
				continue;
			}

			const entryPath = join(folderPath, entry.name);
			const entryFile = Bun.file(entryPath)
			
			// If any file is newer than cache, cache is stale
			if (entryFile.lastModified > cacheTimestamp) {
				return true;
			}
		}
		
		return false;
	} catch {
		// If we can't check, assume cache is stale
		return true;
	}
}

/**
 * Saves the calculated folder size to cache
 * @param folderPath - Path to the folder
 * @param size - Calculated size in bytes
 */
async function saveCacheEntry(folderPath: string, size: number): Promise<void> {
	const cacheFilePath = join(folderPath, CACHE_FILE_NAME);
	
	try {
		await Bun.write(cacheFilePath, `${size}`);
	} catch (error) {
		// Silently fail cache write - don't let it break the main functionality
		console.warn(`Failed to write cache for ${folderPath}:`, error);
	}
}

/**
 * Calculates the size of files in a folder (excluding subfolders)
 * @param folderPath - Path to the folder
 * @param includeHidden - Whether to include hidden files
 * @returns Promise<number> - Size of files in bytes
 */
async function calculateImmediateFolderSize(folderPath: string, includeHidden: boolean = false): Promise<number> {
	try {
		return await _calculateImmediateFolderSize(
			folderPath,
			(await
				readdir(folderPath, { withFileTypes: true })
			).filter(checkIfFileSizeRelevant(includeHidden)),
			includeHidden
		)
	} catch (error) {
		console.warn(`Failed to calculate immediate folder size for ${folderPath}:`, error);
		return 0;
	}
}

function checkIfFileSizeRelevant(includeHidden: boolean) {
	return (entry: Dirent<string>) => includeHidden ? DirEnt.allFiles(entry) : DirEnt.noHiddenFiles(entry)
}

async function _calculateImmediateFolderSize(folderPath: string, entries: Dirent[], includeHidden: boolean): Promise<number> {
	try {
		let totalSize = 0;
		const filePromises = entries
			.map(async (entry) => {
				try {
					const filePath = join(folderPath, entry.name);
					const file = Bun.file(filePath);
					return file.size;
				} catch (error) {
					console.warn(`Failed to get size for ${entry.name}:`, error);
					return 0;
				}
			});
		
		const fileSizes = await Promise.all(filePromises);
		totalSize = fileSizes.reduce((sum, size) => sum + size, 0);
		
		return totalSize;
	} catch (error) {
		console.warn(`Failed to calculate immediate folder size for ${folderPath}:`, error);
		return 0;
	}
}

/**
 * Gets all subdirectories in a folder
 * @param folderPath - Path to the folder
 * @param includeHidden - Whether to include hidden directories
 * @returns Promise<string[]> - Array of subdirectory paths
 */
async function getSubdirectories(folderPath: string, includeHidden: boolean = false): Promise<string[]> {
	try {
		return _getSubdirectories(
			folderPath,
			(await
				readdir(folderPath, { withFileTypes: true })
			).filter(checkIfSubdirectory(includeHidden)),
			includeHidden
		);
	} catch (error) {
		console.warn(`Failed to get subdirectories for ${folderPath}:`, error);
		return [];
	}
}

function checkIfSubdirectory(includeHidden: boolean) {
	return (entry: Dirent<string>) => includeHidden ? DirEnt.allFolders(entry) : DirEnt.noHidd(entry)
}

async function _getSubdirectories(folderPath: string, entries: Dirent[], includeHidden: boolean): Promise<string[]> {
	try {
		return entries.map(entry => join(folderPath, entry.name));
	} catch (error) {
		console.warn(`Failed to get subdirectories for ${folderPath}:`, error);
		return [];
	}
}

async function getDirectoryEntries(path: string, includeHidden: boolean = false) {
	const entries = await readdir(path, { withFileTypes: true })
	let result = { folders: [] as Dirent<string>[], files: [] as Dirent<string>[] }
	result = entries.reduce<typeof result>((result, _item) => {
		const item = DirEnt.create(_item)
		const filterResult = DirEnt.filter(item, includeHidden)
		if (!item.dirent || filterResult === FilterDirEntResult.discard)
			return result
		else if (filterResult === FilterDirEntResult.file) {
			result.files.push(item.dirent)
		} else if (filterResult === FilterDirEntResult.folder) {
			result.folders.push(item.dirent)
		}
		return result
	}, result)
	return result
}

async function dirExists(path: string) {
	try {
		readdir(path)
		return true
	} catch {
		return false
	}
}

/**
 * Calculates the total size of a folder recursively
 * @param path - Path to the folder
 * @param maxCacheAge - Maximum age of cache in milliseconds (default: 10 minutes)
 * @param includeHidden - Whether to include hidden files and folders (default: false)
 * @returns Promise<number> - Total size in bytes
 */
export async function calculateFolderSize(
	path: string,
	maxCacheAge: number = DEFAULT_CACHE_AGE,
	includeHidden: boolean = false
): Promise<number> {
	const resolvedPath = resolve(path);
	return _calculateFolderSize(resolvedPath, maxCacheAge, includeHidden)
}

async function _calculateFolderSize(
	resolvedPath: string,
	maxCacheAge: number,
	includeHidden: boolean
): Promise<number> {
	try {
		// Check if path exists and is a directory
		if (!(await dirExists(resolvedPath))) {
			throw new Error(`Path ${resolvedPath} is not a directory`);
		}

		const dirContent = await getDirectoryEntries(resolvedPath, includeHidden)

		console.error(dirContent)
		
		// Check cache first
		const cacheEntry = await getCacheEntry(resolvedPath, maxCacheAge);
		if (cacheEntry) {
			return cacheEntry.size;
		}
		
		// Calculate immediate folder size (files only)
		const immediateSize = await _calculateImmediateFolderSize(resolvedPath, dirContent.files, includeHidden);
		
		// Get subdirectories for recursive calculation
		const subdirectories = await _getSubdirectories(resolvedPath, dirContent.folders, includeHidden);
		
		// Calculate subdirectory sizes using map-reduce pattern
		const subdirSizePromises = subdirectories.map(subdir =>
			_calculateFolderSize(subdir, maxCacheAge, includeHidden)
		);
		
		const subdirSizes = await Promise.all(subdirSizePromises);
		const totalSubdirSize = subdirSizes.reduce((sum, size) => sum + size, 0);
		
		// Total size is immediate files + recursive subdirectory sizes
		const totalSize = immediateSize + totalSubdirSize;
		
		// Save to cache
		await saveCacheEntry(resolvedPath, totalSize);
		
		return totalSize;
	} catch (error) {
		console.error(`Failed to calculate folder size for ${resolvedPath}:`, error);
		throw error;
	}
}

/**
 * Gets disk space information for the filesystem containing the given path
 * @param path - Path to check disk space for
 * @returns Promise<{available: number, total: number}> - Available and total disk space in bytes
 */
async function getDiskSpaceInfo(path: string): Promise<{ available: number; total: number }> {
	try {
		// Verify path exists
		await stat(path);
		
		// For now, we'll use a placeholder implementation
		// In a production environment, you'd want to use system calls
		// or platform-specific libraries to get actual disk space
		return {
			available: 1000000000000, // 1TB placeholder
			total: 2000000000000 // 2TB placeholder
		};
	} catch (error) {
		console.warn(`Failed to get disk space info for ${path}:`, error);
		return {
			available: 0,
			total: 0
		};
	}
}

/**
 * Calculates folder size and returns it along with available disk space
 * @param path - Path to the folder
 * @param options - Configuration options
 * @returns Promise<FolderSizeWithSpace> - Object containing used, available, and total space
 */
export async function getFolderSizeWithAvailableSpace(
	path: string,
	options: FolderSizeOptions = {}
): Promise<FolderSizeWithSpace> {
	const { maxCacheAge = DEFAULT_CACHE_AGE, includeHidden = false } = options;
	
	try {
		const [used, diskSpace] = await Promise.all([
			calculateFolderSize(path, maxCacheAge, includeHidden),
			getBasicDiskSpace(path)
		]);
		
		return {
			used,
			available: diskSpace.available,
			total: diskSpace.total
		};
	} catch (error) {
		console.error(`Failed to get folder size with available space for ${path}:`, error);
		throw error;
	}
}

/**
 * Clears cache files from a directory tree
 * @param path - Root path to clear cache from
 * @param recursive - Whether to clear cache recursively (default: true)
 */
export async function clearFolderSizeCache(path: string, recursive: boolean = true): Promise<void> {
	const resolvedPath = resolve(path);
	
	try {
		const cacheFilePath = join(resolvedPath, CACHE_FILE_NAME);
		const cacheFile = Bun.file(cacheFilePath);
		
		// Remove cache file if it exists
		if (await cacheFile.exists()) {
			try {
				await Bun.write(cacheFilePath, ''); // Clear the file
				console.log(`Cleared cache file: ${cacheFilePath}`);
			} catch (error) {
				console.warn(`Failed to clear cache file ${cacheFilePath}:`, error);
			}
		}
		
		// Recursively clear subdirectory caches
		if (recursive) {
			const subdirectories = await getSubdirectories(resolvedPath, true);
			await Promise.all(
				subdirectories.map(subdir => clearFolderSizeCache(subdir, true))
			);
		}
	} catch (error) {
		console.warn(`Failed to clear folder size cache for ${resolvedPath}:`, error);
	}
}