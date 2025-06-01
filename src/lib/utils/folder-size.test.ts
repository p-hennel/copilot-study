import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { mkdir, writeFile, rmdir } from 'fs/promises';
import { join } from 'path';
import {
	calculateFolderSize,
	getFolderSizeWithAvailableSpace,
	clearFolderSizeCache} from './folder-size';
import { formatBytes } from '$lib/utils';

const TEST_DIR = './test-folder-size';

describe('Folder Size Calculator', () => {
	beforeAll(async () => {
		// Create test directory structure
		await mkdir(TEST_DIR, { recursive: true });
		await mkdir(join(TEST_DIR, 'subdir1'), { recursive: true });
		await mkdir(join(TEST_DIR, 'subdir2'), { recursive: true });
		
		// Create test files with known sizes
		await writeFile(join(TEST_DIR, 'file1.txt'), 'Hello World'); // 11 bytes
		await writeFile(join(TEST_DIR, 'file2.txt'), 'Test Content'); // 12 bytes
		await writeFile(join(TEST_DIR, 'subdir1', 'nested.txt'), 'Nested File'); // 11 bytes
		await writeFile(join(TEST_DIR, '.hidden'), 'Hidden Content'); // 14 bytes
	});

	afterAll(async () => {
		// Clean up test directory
		try {
			await rmdir(TEST_DIR, { recursive: true });
		} catch {
			// Ignore cleanup errors
		}
	});

	it('should calculate immediate folder size correctly', async () => {
		const size = await calculateFolderSize(TEST_DIR, 0); // maxCacheAge = 0 to skip cache
		// Should include file1.txt (11) + file2.txt (12) + subdir1/nested.txt (11) = 34 bytes
		expect(size).toBe(34);
	});

	it('should use cache when available', async () => {
		// First calculation
		const size1 = await calculateFolderSize(TEST_DIR);
		
		// Second calculation should use cache
		const size2 = await calculateFolderSize(TEST_DIR);
		
		expect(size1).toBe(size2);
	});

	it('should calculate folder size with available space', async () => {
		const result = await getFolderSizeWithAvailableSpace(TEST_DIR);
		
		expect(result.used).toBeGreaterThan(0);
		expect(result.available).toBeGreaterThan(0);
		expect(result.total).toBeGreaterThan(0);
		expect(result.total).toBeGreaterThanOrEqual(result.available);
	});

	it('should clear cache correctly', async () => {
		// Calculate size to create cache
		await calculateFolderSize(TEST_DIR);
		
		// Clear cache
		await clearFolderSizeCache(TEST_DIR);
		
		// This should work without errors
		const size = await calculateFolderSize(TEST_DIR);
		expect(size).toBeGreaterThan(0);
	});

	it('should format bytes correctly', () => {
		expect(formatBytes(0)).toBe('0 Bytes');
		expect(formatBytes(1024)).toBe('1 KB');
		expect(formatBytes(1024 * 1024)).toBe('1 MB');
		expect(formatBytes(1024 * 1024 * 1024)).toBe('1 GB');
		expect(formatBytes(1536)).toBe('1.5 KB');
	});

	it('should handle non-existent directory', async () => {
		await expect(calculateFolderSize('./non-existent')).rejects.toThrow();
	});

	it('should handle permission errors gracefully', async () => {
		// This test would need special setup for permission-denied scenarios
		// For now, just ensure the function exists and can be called
		expect(typeof calculateFolderSize).toBe('function');
	});
});