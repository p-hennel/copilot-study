interface DiskSpaceInfo {
  totalBytes: number;
  availableBytes: number;
  usedBytes: number;
  usagePercentage: number;
}

/**
 * Gets disk space information for a given path using df command
 * Optimized for Bun runtime using Bun's shell template literal
 * 
 * @param path - The filesystem path to check
 * @returns Promise<DiskSpaceInfo> - Disk space information in bytes
 * @throws Error if the path doesn't exist or df command fails
 */
export async function getDiskSpace(path: string): Promise<DiskSpaceInfo> {
  try {
    // Use Bun's shell template literal for optimal performance
    const result = await Bun.$`df -k ${path}`.text();
    
    // Split output into lines and get the data line (skip header)
    const lines = result.trim().split('\n');
    if (lines.length < 2) {
      throw new Error('Invalid df output format');
    }
    
    // Parse the data line - handle cases where filesystem name wraps to next line
    let dataLine: string;
    if (lines.length === 2) {
      // Normal case: filesystem and data on same line
      dataLine = lines[1] || "";
    } else {
      // Edge case: filesystem name on separate line
      dataLine = lines.slice(1).join(' ');
    }
    
    // Split by whitespace and filter out empty strings
    const columns = dataLine.split(/\s+/).filter(col => col.length > 0);
    
    if (columns.length < 6) {
      throw new Error('Unable to parse df output - insufficient columns');
    }
    
    // Extract values (df -k outputs in 1K blocks)
    const totalKB = parseInt(columns[1] ?? "", 10);
    const usedKB = parseInt(columns[2] ?? "", 10);
    const availableKB = parseInt(columns[3] ?? "", 10);
    const usagePercent = parseInt((columns[4] ?? "").replace('%', ''), 10);
    
    // Validate numeric values
    if (isNaN(totalKB) || isNaN(usedKB) || isNaN(availableKB)) {
      throw new Error('Unable to parse numeric values from df output');
    }
    
    // Convert from KB (1024 bytes) to bytes
    const KB_TO_BYTES = 1024;
    
    return {
      totalBytes: totalKB * KB_TO_BYTES,
      availableBytes: availableKB * KB_TO_BYTES,
      usedBytes: usedKB * KB_TO_BYTES,
      usagePercentage: usagePercent,
    };
    
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Failed to get disk space for path '${path}': ${error.message}`);
    }
    throw new Error(`Failed to get disk space for path '${path}': Unknown error`);
  }
}

/**
 * Convenience function that returns only total and available bytes
 * 
 * @param path - The filesystem path to check
 * @returns Promise<{totalBytes: number, availableBytes: number}>
 */
export async function getBasicDiskSpace(path: string): Promise<{total: number, available: number}> {
  const info = await getDiskSpace(path);
  return {
    total: info.totalBytes,
    available: info.availableBytes
  };
}