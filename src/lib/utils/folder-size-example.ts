import {
	calculateFolderSize,
	getFolderSizeWithAvailableSpace,
	clearFolderSizeCache} from './folder-size';
import { formatBytes } from '$lib/utils';

/**
 * Example usage of the folder size calculation utility
 */
async function demonstrateFolderSizeCalculation() {
	console.log('🔍 Folder Size Calculator Demo\n');

	// Example 1: Calculate size of the current project's src directory
	try {
		console.log('📁 Calculating size of src/ directory...');
		const srcSize = await calculateFolderSize('./src');
		console.log(`Size: ${formatBytes(srcSize)} (${srcSize} bytes)\n`);
	} catch (error) {
		console.error('Error calculating src/ size:', error);
	}

	// Example 2: Get folder size with available disk space
	try {
		console.log('💾 Getting folder size with disk space info...');
		const spaceInfo = await getFolderSizeWithAvailableSpace('./src');
		console.log(`Used: ${formatBytes(spaceInfo.used)}`);
		console.log(`Available: ${formatBytes(spaceInfo.available)}`);
		console.log(`Total: ${formatBytes(spaceInfo.total)}\n`);
	} catch (error) {
		console.error('Error getting space info:', error);
	}

	// Example 3: Demonstrate caching
	console.log('🔄 Demonstrating cache behavior...');
	const startTime = Date.now();
	await calculateFolderSize('./src');
	const firstCalculation = Date.now() - startTime;

	const startTime2 = Date.now();
	await calculateFolderSize('./src'); // Should use cache
	const secondCalculation = Date.now() - startTime2;

	console.log(`First calculation: ${firstCalculation}ms`);
	console.log(`Second calculation (cached): ${secondCalculation}ms\n`);

	// Example 4: Clear cache
	console.log('🧹 Clearing cache...');
	await clearFolderSizeCache('./src');
	console.log('Cache cleared!\n');

	// Example 5: Calculate with different cache settings
	console.log('⏱️ Calculating with 5-second cache...');
	const sizeWithShortCache = await calculateFolderSize('./src', 5000); // 5 seconds
	console.log(`Size with 5s cache: ${formatBytes(sizeWithShortCache)}\n`);

	console.log('✅ Demo completed!');
}

// Run the demo if this file is executed directly
if (import.meta.main) {
	demonstrateFolderSizeCalculation().catch(console.error);
}

export { demonstrateFolderSizeCalculation };