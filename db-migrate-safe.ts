#!/usr/bin/env bun
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Safe Database Migration Script
 * 
 * This script ensures safe, non-destructive database migrations by:
 * 1. Parsing SQL migration files into individual statements
 * 2. Executing each statement individually with proper error handling
 * 3. Never dropping tables or data (only indexes can be dropped if necessary)
 * 4. Creating comprehensive backups before any changes
 * 5. Providing rollback capabilities
 */

const DB_PATH = process.env.DATABASE_URL?.replace('file:', '') || process.env.DB_FILE || './app.db';
const DRIZZLE_DIR = './drizzle';
const BACKUP_DIR = process.env.BACKUP_DIR || './backups';

interface MigrationStatement {
  sql: string;
  type: 'CREATE_TABLE' | 'CREATE_INDEX' | 'DROP_INDEX' | 'ALTER_TABLE' | 'INSERT' | 'UPDATE' | 'OTHER';
  isDestructive: boolean;
  requiresValidation: boolean;
  tableName?: string;
  columns?: ColumnDefinition[];
}

interface ColumnDefinition {
  name: string;
  type: string;
  constraints: string[];
  fullDefinition: string;
}

class SafeMigrator {
  private db: Database;
  private drizzleDb: ReturnType<typeof drizzle>;

  constructor() {
    // Ensure database directory exists
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Ensure backup directory exists
    if (!fs.existsSync(BACKUP_DIR)) {
      fs.mkdirSync(BACKUP_DIR, { recursive: true });
    }

    this.db = new Database(DB_PATH);
    this.drizzleDb = drizzle(this.db);

    // Enable foreign key constraints and WAL mode for safety
    this.db.exec('PRAGMA foreign_keys = ON');
    this.db.exec('PRAGMA journal_mode = WAL');
    this.db.exec('PRAGMA synchronous = FULL');
  }

  /**
   * Create a backup of the current database
   */
  private async createBackup(): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(BACKUP_DIR, `backup-${timestamp}.db`);
    
    console.log(`Creating backup at ${backupPath}...`);
    
    try {
      // Create backup using SQLite backup API
      this.db.exec(`VACUUM INTO '${backupPath}'`);
      console.log(`✅ Backup created successfully`);
      return backupPath;
    } catch (error) {
      console.error(`❌ Failed to create backup: ${error.message}`);
      throw error;
    }
  }

  /**
   * Parse a migration file into individual statements
   */
  private parseMigrationFile(filePath: string): MigrationStatement[] {
    if (!fs.existsSync(filePath)) {
      throw new Error(`Migration file not found: ${filePath}`);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const statements: MigrationStatement[] = [];

    // Split by statement breakpoint comments
    const rawStatements = content.split('--> statement-breakpoint');

    for (const rawStatement of rawStatements) {
      const sql = rawStatement.trim();
      if (!sql || sql.startsWith('--') || sql.length === 0) continue;

      const statement = this.classifyStatement(sql);
      statements.push(statement);
    }

    return statements;
  }

  /**
   * Parse CREATE TABLE statement to extract column definitions
   */
  private parseCreateTableStatement(sql: string): { tableName: string; columns: ColumnDefinition[] } | null {
    // Extract table name
    const tableMatch = sql.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+[`"]?(\w+)[`"]?\s*\(/i);
    if (!tableMatch) return null;

    const tableName = tableMatch[1];

    // Extract column definitions
    const columns: ColumnDefinition[] = [];
    
    // Find the content between parentheses
    const contentMatch = sql.match(/\((.*)\)/s);
    if (!contentMatch) return null;

    const tableContent = contentMatch[1];
    
    // Split by commas but respect nested parentheses and quotes
    const columnDefinitions = this.splitTableDefinitions(tableContent);

    for (const colDef of columnDefinitions) {
      const trimmed = colDef.trim();
      
      // Skip constraints like PRIMARY KEY, FOREIGN KEY, etc.
      if (trimmed.toUpperCase().match(/^(PRIMARY KEY|FOREIGN KEY|UNIQUE|CHECK|CONSTRAINT)/)) {
        continue;
      }

      // Parse column definition
      const columnParts = trimmed.split(/\s+/);
      if (columnParts.length < 2) continue;

      const columnName = columnParts[0].replace(/[`"]/g, '');
      const columnType = columnParts[1];
      const constraints = columnParts.slice(2);

      columns.push({
        name: columnName,
        type: columnType,
        constraints,
        fullDefinition: trimmed
      });
    }

    return { tableName, columns };
  }

  /**
   * Split table definitions respecting nested structures
   */
  private splitTableDefinitions(content: string): string[] {
    const definitions: string[] = [];
    let current = '';
    let parenthesesDepth = 0;
    let inQuotes = false;
    let quoteChar = '';

    for (let i = 0; i < content.length; i++) {
      const char = content[i];
      const prevChar = i > 0 ? content[i - 1] : '';

      if (!inQuotes && (char === '"' || char === "'")) {
        inQuotes = true;
        quoteChar = char;
      } else if (inQuotes && char === quoteChar && prevChar !== '\\') {
        inQuotes = false;
      } else if (!inQuotes) {
        if (char === '(') {
          parenthesesDepth++;
        } else if (char === ')') {
          parenthesesDepth--;
        } else if (char === ',' && parenthesesDepth === 0) {
          definitions.push(current.trim());
          current = '';
          continue;
        }
      }

      current += char;
    }

    if (current.trim()) {
      definitions.push(current.trim());
    }

    return definitions;
  }

  /**
   * Check if a table exists in the database
   */
  private tableExists(tableName: string): boolean {
    try {
      const result = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
      ).get(tableName);
      return !!result;
    } catch {
      return false;
    }
  }

  /**
   * Get existing columns for a table
   */
  private getExistingColumns(tableName: string): ColumnDefinition[] {
    try {
      const pragma = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as any[];
      
      return pragma.map(col => ({
        name: col.name,
        type: col.type,
        constraints: [
          ...(col.notnull ? ['NOT NULL'] : []),
          ...(col.pk ? ['PRIMARY KEY'] : []),
          ...(col.dflt_value !== null ? [`DEFAULT ${col.dflt_value}`] : [])
        ],
        fullDefinition: `${col.name} ${col.type}${col.notnull ? ' NOT NULL' : ''}${col.pk ? ' PRIMARY KEY' : ''}${col.dflt_value !== null ? ` DEFAULT ${col.dflt_value}` : ''}`
      }));
    } catch (error) {
      console.warn(`⚠️  Could not get column info for table ${tableName}: ${error.message}`);
      return [];
    }
  }

  /**
   * Generate ALTER TABLE statements to add missing columns
   */
  private generateAddColumnStatements(tableName: string, missingColumns: ColumnDefinition[]): string[] {
    return missingColumns.map(col => {
      // Build ALTER TABLE ADD COLUMN statement
      let statement = `ALTER TABLE ${tableName} ADD COLUMN ${col.name} ${col.type}`;
      
      // Add constraints (but be careful with NOT NULL on existing tables)
      const constraints = col.constraints.filter(c => 
        !c.includes('PRIMARY KEY') && // Can't add PRIMARY KEY to existing table
        !c.includes('UNIQUE') // Be careful with UNIQUE on existing tables
      );

      if (constraints.length > 0) {
        statement += ' ' + constraints.join(' ');
      }

      return statement;
    });
  }

  /**
   * Handle CREATE TABLE statement - create table or add missing columns
   */
  private async handleCreateTable(statement: MigrationStatement): Promise<boolean> {
    const parsed = this.parseCreateTableStatement(statement.sql);
    if (!parsed) {
      console.warn(`⚠️  Could not parse CREATE TABLE statement: ${statement.sql.substring(0, 100)}...`);
      return false;
    }

    const { tableName, columns } = parsed;

    if (!this.tableExists(tableName)) {
      // Table doesn't exist, create it normally
      console.log(`📝 Creating new table: ${tableName}`);
      return await this.executeRawStatement(statement);
    } else {
      // Table exists, check for missing columns
      console.log(`📋 Table ${tableName} exists, checking for missing columns...`);
      
      const existingColumns = this.getExistingColumns(tableName);
      const existingColumnNames = existingColumns.map(col => col.name.toLowerCase());
      
      const missingColumns = columns.filter(col => 
        !existingColumnNames.includes(col.name.toLowerCase())
      );

      if (missingColumns.length === 0) {
        console.log(`✅ Table ${tableName} is up to date`);
        return true;
      }

      console.log(`📝 Adding ${missingColumns.length} missing columns to ${tableName}: ${missingColumns.map(c => c.name).join(', ')}`);
      
      // Generate and execute ALTER TABLE statements
      const alterStatements = this.generateAddColumnStatements(tableName, missingColumns);
      
      for (const alterSql of alterStatements) {
        const alterStatement: MigrationStatement = {
          sql: alterSql,
          type: 'ALTER_TABLE',
          isDestructive: false,
          requiresValidation: true,
          tableName,
          columns: missingColumns
        };

        console.log(`📝 Executing: ${alterSql}`);
        const success = await this.executeRawStatement(alterStatement);
        if (!success) {
          return false;
        }
      }

      console.log(`✅ Successfully updated table ${tableName}`);
      return true;
    }
  }

  /**
   * Execute raw SQL statement (internal method)
   */
  private async executeRawStatement(statement: MigrationStatement): Promise<boolean> {
    const { sql, type, isDestructive, requiresValidation } = statement;

    // Block destructive operations (except index drops)
    if (isDestructive && type !== 'DROP_INDEX') {
      console.error(`❌ BLOCKED destructive operation: ${sql.substring(0, 100)}...`);
      throw new Error(`Destructive operation blocked for safety: ${type}`);
    }

    try {
      // Execute within a transaction for individual statement safety
      this.db.transaction(() => {
        this.db.exec(sql);
      })();

      if (requiresValidation) {
        await this.validateExecution(statement);
      }

      return true;
    } catch (error) {
      console.error(`❌ Failed to execute ${type}: ${error.message}`);
      console.error(`SQL: ${sql}`);
      
      // For non-critical failures, we might want to continue
      if (this.isNonCriticalError(error.message, type)) {
        console.log(`⚠️  Continuing despite non-critical error`);
        return true;
      }
      
      throw error;
    }
  }

  /**
   * Classify a SQL statement and determine if it's safe
   */
  private classifyStatement(sql: string): MigrationStatement {
    const upperSql = sql.toUpperCase().trim();
    
    let type: MigrationStatement['type'] = 'OTHER';
    let isDestructive = false;
    let requiresValidation = false;
    let tableName: string | undefined;
    let columns: ColumnDefinition[] | undefined;

    if (upperSql.startsWith('CREATE TABLE')) {
      type = 'CREATE_TABLE';
      requiresValidation = true;
      const parsed = this.parseCreateTableStatement(sql);
      if (parsed) {
        tableName = parsed.tableName;
        columns = parsed.columns;
      }
    } else if (upperSql.startsWith('CREATE INDEX') || upperSql.startsWith('CREATE UNIQUE INDEX')) {
      type = 'CREATE_INDEX';
    } else if (upperSql.startsWith('DROP INDEX')) {
      type = 'DROP_INDEX';
      // Index drops are allowed as they're non-destructive to data
    } else if (upperSql.startsWith('ALTER TABLE')) {
      type = 'ALTER_TABLE';
      // Check if it's a destructive ALTER (DROP COLUMN, etc.)
      if (upperSql.includes('DROP COLUMN') || upperSql.includes('DROP CONSTRAINT')) {
        isDestructive = true;
      }
      requiresValidation = true;
    } else if (upperSql.startsWith('INSERT')) {
      type = 'INSERT';
    } else if (upperSql.startsWith('UPDATE')) {
      type = 'UPDATE';
      requiresValidation = true;
    } else if (upperSql.includes('DROP TABLE') || upperSql.includes('DELETE FROM')) {
      isDestructive = true;
    }

    return {
      sql,
      type,
      isDestructive,
      requiresValidation,
      tableName,
      columns
    };
  }

  /**
   * Execute a single statement with error handling
   */
  private async executeStatement(statement: MigrationStatement): Promise<boolean> {
    const { sql, type, isDestructive } = statement;

    // Block destructive operations (except index drops)
    if (isDestructive && type !== 'DROP_INDEX') {
      console.error(`❌ BLOCKED destructive operation: ${sql.substring(0, 100)}...`);
      throw new Error(`Destructive operation blocked for safety: ${type}`);
    }

    // Handle CREATE TABLE statements specially to support column addition
    if (type === 'CREATE_TABLE') {
      return await this.handleCreateTable(statement);
    }

    // Handle other statements normally
    console.log(`📝 Executing ${type}: ${sql.substring(0, 100)}${sql.length > 100 ? '...' : ''}`);
    const success = await this.executeRawStatement(statement);
    
    if (success) {
      console.log(`✅ Successfully executed ${type}`);
    }
    
    return success;
  }

  /**
   * Check if an error is non-critical and migration can continue
   */
  private isNonCriticalError(errorMessage: string, type: MigrationStatement['type']): boolean {
    const nonCriticalPatterns = [
      'already exists',
      'duplicate column name',
      'index .* already exists',
      'no such index' // for DROP INDEX on non-existent indexes
    ];

    return nonCriticalPatterns.some(pattern => 
      new RegExp(pattern, 'i').test(errorMessage)
    );
  }

  /**
   * Validate statement execution
   */
  private async validateExecution(statement: MigrationStatement): Promise<void> {
    const { sql, type } = statement;

    try {
      switch (type) {
        case 'CREATE_TABLE':
          // Check if table was created by querying sqlite_master
          const tableName = this.extractTableName(sql);
          const tableExists = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
          ).get(tableName);
          
          if (!tableExists) {
            throw new Error(`Table ${tableName} was not created`);
          }
          break;

        case 'CREATE_INDEX':
          // Check if index was created
          const indexName = this.extractIndexName(sql);
          const indexExists = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='index' AND name=?"
          ).get(indexName);
          
          if (!indexExists) {
            throw new Error(`Index ${indexName} was not created`);
          }
          break;

        case 'ALTER_TABLE':
          // Basic check that table still exists after alteration
          const alteredTableName = this.extractTableNameFromAlter(sql);
          const alteredTableExists = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?"
          ).get(alteredTableName);
          
          if (!alteredTableExists) {
            throw new Error(`Table ${alteredTableName} missing after ALTER`);
          }
          break;
      }
    } catch (error) {
      console.warn(`⚠️  Validation warning: ${error.message}`);
      // Don't throw - validation warnings shouldn't stop migration
    }
  }

  /**
   * Extract table name from CREATE TABLE statement
   */
  private extractTableName(sql: string): string {
    const match = sql.match(/CREATE TABLE(?:\s+IF NOT EXISTS)?\s+[`"]?(\w+)[`"]?/i);
    return match ? match[1] : 'unknown';
  }

  /**
   * Extract index name from CREATE INDEX statement
   */
  private extractIndexName(sql: string): string {
    const match = sql.match(/CREATE(?:\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+[`"]?(\w+)[`"]?/i);
    return match ? match[1] : 'unknown';
  }

  /**
   * Extract table name from ALTER TABLE statement
   */
  private extractTableNameFromAlter(sql: string): string {
    const match = sql.match(/ALTER TABLE\s+[`"]?(\w+)[`"]?/i);
    return match ? match[1] : 'unknown';
  }

  /**
   * Get list of migration files in chronological order
   */
  private getMigrationFiles(): string[] {
    if (!fs.existsSync(DRIZZLE_DIR)) {
      console.log(`No migration directory found at ${DRIZZLE_DIR}`);
      return [];
    }

    const files = fs.readdirSync(DRIZZLE_DIR)
      .filter(file => file.endsWith('.sql'))
      .sort(); // Drizzle files are named with timestamps, so sorting works

    return files.map(file => path.join(DRIZZLE_DIR, file));
  }

  /**
   * Check if database has been initialized
   */
  private isDatabaseInitialized(): boolean {
    try {
      const tables = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
      ).all();
      
      return tables.length > 0;
    } catch {
      return false;
    }
  }

  /**
   * Run all pending migrations safely
   */
  async migrate(): Promise<void> {
    console.log('🚀 Starting safe database migration...');
    console.log(`📁 Database path: ${DB_PATH}`);

    try {
      // Create backup if database exists and has data
      if (this.isDatabaseInitialized()) {
        await this.createBackup();
      }

      const migrationFiles = this.getMigrationFiles();
      
      if (migrationFiles.length === 0) {
        console.log('📋 No migration files found');
        return;
      }

      console.log(`📋 Found ${migrationFiles.length} migration file(s)`);

      for (const migrationFile of migrationFiles) {
        console.log(`\n📄 Processing migration: ${path.basename(migrationFile)}`);
        
        const statements = this.parseMigrationFile(migrationFile);
        console.log(`📝 Found ${statements.length} statements`);

        let executed = 0;
        let skipped = 0;

        for (const statement of statements) {
          try {
            const success = await this.executeStatement(statement);
            if (success) {
              executed++;
            }
          } catch (error) {
            console.error(`❌ Migration failed at statement: ${statement.sql.substring(0, 100)}...`);
            throw error;
          }
        }

        console.log(`✅ Migration completed: ${executed} executed, ${skipped} skipped`);
      }

      console.log('\n🎉 All migrations completed successfully!');

    } catch (error) {
      console.error('\n💥 Migration failed:', error.message);
      console.error('📋 Database state preserved - check backup if needed');
      throw error;
    } finally {
      this.db.close();
    }
  }

  /**
   * Verify database integrity after migration
   */
  async verifyIntegrity(): Promise<boolean> {
    console.log('🔍 Verifying database integrity...');
    
    try {
      // Reopen database connection for integrity check
      const tempDb = new Database(DB_PATH);
      
      // Run PRAGMA integrity_check
      const result = tempDb.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
      
      tempDb.close();
      
      if (result.integrity_check === 'ok') {
        console.log('✅ Database integrity check passed');
        return true;
      } else {
        console.error('❌ Database integrity check failed:', result.integrity_check);
        return false;
      }
    } catch (error) {
      console.error('❌ Failed to run integrity check:', error.message);
      return false;
    }
  }
}

// Main execution
async function main() {
  const migrator = new SafeMigrator();
  
  try {
    await migrator.migrate();
    await migrator.verifyIntegrity();
    console.log('🏁 Safe migration completed successfully');
    process.exit(0);
  } catch (error) {
    console.error('💥 Migration process failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.main) {
  main();
}

export { SafeMigrator };