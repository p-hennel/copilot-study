import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	calculateFolderSize,
	getFolderSizeWithAvailableSpace} from '$lib/utils/folder-size';
import { formatBytes } from '$lib/utils';

/**
 * API endpoint for calculating folder sizes
 * 
 * Query parameters:
 * - path: The folder path to calculate (required)
 * - cache: Cache age in milliseconds (optional, default: 600000 = 10 minutes)
 * - format: Whether to return formatted bytes (optional, default: false)
 * - includeSpace: Whether to include disk space info (optional, default: false)
 * 
 * Examples:
 * GET /api/folder-size?path=./src
 * GET /api/folder-size?path=./data&cache=60000&format=true
 * GET /api/folder-size?path=./logs&includeSpace=true
 */
export const GET: RequestHandler = async ({ url }) => {
	try {
		const path = url.searchParams.get('path');
		const cacheAge = parseInt(url.searchParams.get('cache') || '600000'); // 10 minutes default
		const shouldFormat = url.searchParams.get('format') === 'true';
		const includeSpace = url.searchParams.get('includeSpace') === 'true';

		if (!path) {
			return json(
				{ error: 'Path parameter is required' },
				{ status: 400 }
			);
		}

		// Validate path to prevent directory traversal attacks
		if (path.includes('..') || path.startsWith('/')) {
			return json(
				{ error: 'Invalid path. Relative paths only, no parent directory access.' },
				{ status: 400 }
			);
		}

		if (includeSpace) {
			const spaceInfo = await getFolderSizeWithAvailableSpace(path, { maxCacheAge: cacheAge });
			
			return json({
				path,
				used: shouldFormat ? formatBytes(spaceInfo.used) : spaceInfo.used,
				usedBytes: spaceInfo.used,
				available: shouldFormat ? formatBytes(spaceInfo.available) : spaceInfo.available,
				availableBytes: spaceInfo.available,
				total: shouldFormat ? formatBytes(spaceInfo.total) : spaceInfo.total,
				totalBytes: spaceInfo.total,
				cacheAge,
				timestamp: new Date().toISOString()
			});
		} else {
			const size = await calculateFolderSize(path, cacheAge);
			
			return json({
				path,
				size: shouldFormat ? formatBytes(size) : size,
				sizeBytes: size,
				cacheAge,
				timestamp: new Date().toISOString()
			});
		}
	} catch (error) {
		console.error('Error calculating folder size:', error);
		
		// Return appropriate error based on error type
		if (error instanceof Error) {
			if (error.message.includes('ENOENT') || error.message.includes('no such file')) {
				return json(
					{ error: 'Path not found' },
					{ status: 404 }
				);
			}
			
			if (error.message.includes('EACCES') || error.message.includes('permission')) {
				return json(
					{ error: 'Permission denied' },
					{ status: 403 }
				);
			}
		}
		
		return json(
			{ error: 'Internal server error' },
			{ status: 500 }
		);
	}
};

/**
 * API endpoint for clearing folder size cache
 * 
 * Body parameters:
 * - path: The folder path to clear cache for (required)
 * - recursive: Whether to clear cache recursively (optional, default: true)
 */
export const DELETE: RequestHandler = async ({ request }) => {
	try {
		const body = await request.json() as { path?: string; recursive?: boolean };
		const { path, recursive = true } = body;

		if (!path) {
			return json(
				{ error: 'Path parameter is required' },
				{ status: 400 }
			);
		}

		// Validate path to prevent directory traversal attacks
		if (path.includes('..') || path.startsWith('/')) {
			return json(
				{ error: 'Invalid path. Relative paths only, no parent directory access.' },
				{ status: 400 }
			);
		}

		const { clearFolderSizeCache } = await import('$lib/utils/folder-size');
		await clearFolderSizeCache(path, recursive);

		return json({
			success: true,
			message: `Cache cleared for ${path}${recursive ? ' (recursive)' : ''}`,
			timestamp: new Date().toISOString()
		});
	} catch (error) {
		console.error('Error clearing folder size cache:', error);
		
		return json(
			{ error: 'Failed to clear cache' },
			{ status: 500 }
		);
	}
};