#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { Glob } from "bun";
import * as pathlib from "path";

// Path to the SQLite database
const DB_PATH = process.env.DB_FILE || '/home/bun/data/config/main.db';

// Path to the schema file
const SCHEMA_PATH = process.env.SCHEMA_PATH || './schema/*.ts';
let schemaEntryPoint = SCHEMA_PATH;

// Command to run for migration
const MIGRATION_COMMAND = () => `bunx drizzle-kit push --dialect sqlite --schema ${schemaEntryPoint} --url file:${DB_PATH} --force`;

async function checkAndCreateTables() {
  try {
    let startPoint = ""
    let schemaPath = SCHEMA_PATH;
    while(schemaPath.startsWith('.') || schemaPath.startsWith('/')) {
      startPoint += schemaPath.substring(0, 1);
      schemaPath = schemaPath.substring(1);
    }
    if (startPoint.endsWith('/')) {
      startPoint = startPoint.substring(0, startPoint.length - 1);
    }
    const schemaGlob = new Glob(schemaPath);
    
    // Use Bun.glob to find all matching schema files
    console.log(`Finding schema files matching: ${SCHEMA_PATH}`);
    
    // Extract table names from all schema files
    const schemaTables: string[] = [];
    
    for await (const filePath of schemaGlob.scan(startPoint)) {
      try {
        const schemaFile = Bun.file(filePath);
        const schemaContent = await schemaFile.text();

        const fileExt = pathlib.extname(filePath);
        const fileName = pathlib.basename(filePath, fileExt);
        if (fileName === "index")
          schemaEntryPoint = filePath;
        else if (fileName === "schema" && schemaEntryPoint !== "index")
          schemaEntryPoint = filePath
        
        // Find table definitions using regex
        // Pattern for: export const tableName = sqliteTable('table_name', {...
        const tableRegex = /export\s+const\s+(\w+)\s*=\s*\w+Table\s*\(\s*['"]([^'"]+)['"]/g;
        let match;
        
        while ((match = tableRegex.exec(schemaContent)) !== null) {
          const tableName = match[2]; // This is the string name of the table
          if (tableName == null || typeof tableName !== "string") continue
          if (!schemaTables.includes(tableName)) {
            schemaTables.push(tableName);
          }
        }
        
        // Alternative pattern for .name property assignments
        const namePropertyRegex = /\.name\s*=\s*['"]([^'"]+)['"]/g;
        while ((match = namePropertyRegex.exec(schemaContent)) !== null) {
          const tableName = match[1];
          if (!schemaTables.includes(tableName)) {
            schemaTables.push(tableName);
          }
        }
      } catch (error) {
        console.warn(`Error reading schema file ${filePath}: ${error.message}`);
        // Continue with other files, don't abort the whole process
      }
    }
    
    if (schemaTables.length === 0) {
      console.log('No tables found in any schema files. Running migration to ensure all tables are created.');
      await runMigration();
      return;
    }
    
    console.log(`Found ${schemaTables.length} tables across all schema files: ${schemaTables.join(', ')}`);
    
    // Try to connect to the database
    let sqlite;
    try {
      // Check if the database file exists
      const file = Bun.file(DB_PATH);
      const exists = await file.exists();
      
      if (!exists) {
        console.log('Database does not exist, creating it...');
        await runMigration();
        return;
      }
      
      sqlite = new Database(DB_PATH);
    } catch (error) {
      console.log('Database cannot be opened, creating it...');
      await runMigration();
      return;
    }
    
    // Query to get all tables in the SQLite database
    const existingTables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
      .all()
      .map(row => row.name);
    
    console.log(`Found ${existingTables.length} tables in database: ${existingTables.join(', ')}`);
    
    // Check if all schema tables exist in the database
    const missingTables = schemaTables.filter(table => !existingTables.includes(table));
    
    sqlite.close();
    
    if (missingTables.length > 0) {
      console.log(`Missing tables: ${missingTables.join(', ')}`);
      await runMigration();
    } else {
      console.log('All expected tables exist, no action needed');
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

async function runMigration() {
  console.log(`Running migration command: ${MIGRATION_COMMAND()}`);
  
  // Using Bun.spawn
  const proc = Bun.spawn(["bash", "-c", MIGRATION_COMMAND()], {
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit"
  });
  
  const exitCode = await proc.exited;
  
  if (exitCode === 0) {
    console.log('Tables have been created successfully');
  } else {
    throw new Error(`Migration command failed with code ${exitCode}`);
  }
}

// Run the function
checkAndCreateTables().catch(error => {
  console.error('Unhandled error:', error);
  process.exit(1);
});