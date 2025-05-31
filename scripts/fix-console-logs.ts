#!/usr/bin/env bun

/**
 * Script to replace console.log statements with proper logtape logging
 * Usage: bun run scripts/fix-console-logs.ts
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

// Files that should be excluded from automatic fixing
const EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/dist/**',
  '**/build/**',
  '**/.svelte-kit/**',
  '**/scripts/**', // Don't fix this script itself
];

// Map of console methods to logger methods
const CONSOLE_TO_LOGGER_MAP = {
  'console.log': 'logger.info',
  'console.error': 'logger.error', 
  'console.warn': 'logger.warn',
  'console.info': 'logger.info',
  'console.debug': 'logger.debug'
};

/**
 * Check if a file already has logtape import
 */
function hasLogtapeImport(content: string): boolean {
  return content.includes('import { getLogger }') || content.includes('from "@logtape/logtape"');
}

/**
 * Add logtape import and logger initialization to a file
 */
function addLogtapeToFile(content: string, filePath: string): string {
  // Skip if already has logtape
  if (hasLogtapeImport(content)) {
    return content;
  }

  // Determine logger category based on file path
  const relativePath = filePath.replace(process.cwd(), '').replace(/^\//, '');
  const pathParts = relativePath.split('/').filter(part => 
    part !== 'src' && part !== 'lib' && !part.endsWith('.ts') && !part.endsWith('.js')
  );
  
  const loggerCategory = pathParts.length > 0 ? pathParts : ['app'];
  
  // Find where to insert the import
  const lines = content.split('\n');
  let importInsertIndex = 0;
  let hasImports = false;
  
  // Find the last import statement
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim().startsWith('import ') || lines[i].trim().startsWith('export ')) {
      hasImports = true;
      importInsertIndex = i + 1;
    } else if (hasImports && lines[i].trim() === '') {
      // Found empty line after imports
      break;
    } else if (hasImports && !lines[i].trim().startsWith('import ') && !lines[i].trim().startsWith('export ')) {
      // Found non-import line after imports
      break;
    }
  }
  
  // Add logtape import and logger initialization
  const logtapeImport = 'import { getLogger } from "@logtape/logtape";';
  const loggerInit = `\nconst logger = getLogger(${JSON.stringify(loggerCategory)});`;
  
  lines.splice(importInsertIndex, 0, logtapeImport + loggerInit);
  
  return lines.join('\n');
}

/**
 * Replace console statements with logger statements
 */
function replaceConsoleStatements(content: string): string {
  let result = content;
  
  // Replace console.log with structured logging where possible
  for (const [consoleFn, loggerFn] of Object.entries(CONSOLE_TO_LOGGER_MAP)) {
    // Simple replacement pattern
    const simpleRegex = new RegExp(`\\b${consoleFn.replace('.', '\\.')}\\s*\\(`, 'g');
    result = result.replace(simpleRegex, `${loggerFn}(`);
  }
  
  return result;
}

/**
 * Process a single file
 */
function processFile(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf-8');
    
    // Check if file has console statements
    const hasConsoleStatements = /\bconsole\.(log|error|warn|info|debug)\s*\(/.test(content);
    
    if (!hasConsoleStatements) {
      return false; // No changes needed
    }
    
    let newContent = content;
    
    // Add logtape import if needed
    newContent = addLogtapeToFile(newContent, filePath);
    
    // Replace console statements
    newContent = replaceConsoleStatements(newContent);
    
    // Only write if content changed
    if (newContent !== content) {
      writeFileSync(filePath, newContent, 'utf-8');
      console.log(`✅ Fixed: ${filePath}`);
      return true;
    }
    
    return false;
  } catch (error) {
    console.error(`❌ Error processing ${filePath}:`, error);
    return false;
  }
}

/**
 * Recursively find TypeScript files
 */
function findTypeScriptFiles(dir: string, files: string[] = []): string[] {
  const entries = readdirSync(dir);
  
  for (const entry of entries) {
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      // Skip excluded directories
      if (!EXCLUDE_PATTERNS.some(pattern =>
        pattern.replace('**/', '').replace('/**', '') === entry
      )) {
        findTypeScriptFiles(fullPath, files);
      }
    } else if (stat.isFile() && extname(entry) === '.ts') {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Main function
 */
function main() {
  console.log('🔍 Finding TypeScript files with console statements...');
  
  // Find all TypeScript files in src directory
  const files = findTypeScriptFiles(join(process.cwd(), 'src'));
  
  console.log(`📝 Found ${files.length} TypeScript files to check`);
  
  let processedCount = 0;
  let changedCount = 0;
  
  for (const file of files) {
    processedCount++;
    const changed = processFile(file);
    if (changed) {
      changedCount++;
    }
    
    // Show progress every 10 files
    if (processedCount % 10 === 0) {
      console.log(`📊 Progress: ${processedCount}/${files.length} files processed, ${changedCount} changed`);
    }
  }
  
  console.log(`\n✅ Complete! Processed ${processedCount} files, changed ${changedCount} files`);
  console.log('\n⚠️  Please review the changes and test the application');
  console.log('💡 Some console statements may need manual review for proper structured logging');
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    console.error(error);
  }
}