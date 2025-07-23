import { LibSQLDatabase } from 'drizzle-orm/libsql';
import { sql } from 'drizzle-orm';
import * as fs from 'fs';
import * as path from 'path';
import * as mySchema from "./schema";
import { getLogger } from '@logtape/logtape';
import AppSettings from '../settings';
import { spawn } from 'child_process';
import { sleep } from 'bun';

const logger = getLogger(['server', 'db', 'fixer']);

interface DrizzleTable {
  [key: string]: any;
}

interface RepairOptions {
  schema: Record<string, DrizzleTable>;
  databasePath: string; // Used for backup location
  dryRun?: boolean;
  verbose?: boolean;
  backupMethod?: 'native' | 'export' | 'auto';
}

interface RepairResult {
  success: boolean;
  backupPath?: string;
  tablesCreated: string[];
  columnsAdded: Array<{ table: string; column: string }>;
  indexesCreated: string[];
  errors: Array<{ operation: string; error: string }>;
}

export class DrizzleDatabaseRepairer<T extends Record<string, any> = typeof mySchema> {
  private db: LibSQLDatabase<T>;
  private options: RepairOptions;
  private results: RepairResult;

  constructor(db: LibSQLDatabase<T>, options: RepairOptions = {schema: mySchema, databasePath: AppSettings().paths.database}) {
    this.db = db;
    this.options = {
      dryRun: false,
      verbose: false,
      ...options
    };

    if (this.options.databasePath.startsWith('file://')) {
      this.options.databasePath = this.options.databasePath.replace('file://', '');
    } else if (this.options.databasePath.startsWith('file:')) {
      this.options.databasePath = this.options.databasePath.replace('file:', '');
    } 

    this.results = {
      success: true,
      tablesCreated: [],
      columnsAdded: [],
      indexesCreated: [],
      errors: []
    };
  }

  /**
   * Main repair function
   */
  async repair(): Promise<RepairResult> {
    try {
      logger.info('Starting database repair process...');

      // Create backup if database path is provided
      if (this.options.databasePath) {
        const backupPath = await this.createBackup();
        this.results.backupPath = backupPath;
        logger.info(`Backup created: ${backupPath}`);
      } else {
        logger.warn('No database path provided - skipping backup creation');
      }

      logger.info(`Processing schema with ${Object.keys(this.options.schema).length} tables`);

      // Get current database structure
      const currentTables = await this.getCurrentTables();
      const currentColumns = await this.getCurrentColumns();
      const currentIndexes = await this.getCurrentIndexes();

      // Compare and repair
      await this.repairTables(this.options.schema, currentTables);
      await this.repairColumns(this.options.schema, currentColumns);
      await this.repairIndexes(this.options.schema, currentIndexes);

      logger.info('Database repair completed successfully!');
      
    } catch (error: any) {
      this.results.success = false;
      this.results.errors.push({
        operation: 'general',
        error: error.message
      });
      logger.error(`Fatal error: ${error.message}`);
    }

    return this.results;
  }

  /**
   * Create a backup of the database using SQLite's native backup capability
   */
  private async createBackup(): Promise<string> {
    if (!this.options.databasePath) {
      throw new Error('Database path required for creating backups');
    }

    const dbDir = path.dirname(this.options.databasePath);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = path.basename(this.options.databasePath, path.extname(this.options.databasePath));
    const extension = path.extname(this.options.databasePath);
    
    let backupName = `${baseName}_backup_${timestamp}${extension}`;
    let backupPath = path.join(dbDir, backupName);
    
    // Handle existing backups by incrementing number
    let counter = 1;
    while (fs.existsSync(backupPath)) {
      backupName = `${baseName}_backup_${timestamp}_${counter}${extension}`;
      backupPath = path.join(dbDir, backupName);
      counter++;
    }

    try {
      // Choose backup method based on options
      if (this.options.backupMethod === 'export') {
        await this.exportDatabase(backupPath);
      } else if (this.options.backupMethod === 'native') {
        await this.createNativeBackup(backupPath);
      } else {
        // Auto mode: try native first, fallback to export
        try {
          await this.createNativeBackup(backupPath);
        } catch (error: any) {
          logger.warn(`Native backup failed, falling back to export method: ${error.message}`);
          await this.exportDatabase(backupPath);
        }
      }

      await sleep (1000); // Ensure file system is ready
      
      // Verify backup by checking if file exists and has content
      if (!fs.existsSync(backupPath) || fs.statSync(backupPath).size === 0) {
        throw new Error('Backup verification failed - backup file is empty or does not exist: ' + backupPath + ' ' + this.options.databasePath);
      }

      logger.debug(`Backup created successfully: ${backupPath}`);
      return backupPath;
    } catch (error: any) {
      throw new Error(`Failed to create backup: ${error.message}`);
    }
  }

  /**
   * Create backup using SQLite's native .backup command
   */
  private async createNativeBackup(backupPath: string): Promise<void> {
    // Method 1: Try using SQL BACKUP command (if supported by LibSQL)
    try {
      await this.db.run(sql.raw(`BACKUP TO '${backupPath}'`));
      return;
    } catch (error: any) {
      logger.debug(`SQL BACKUP command failed: ${error.message}`);
    }

    // Method 2: Try using VACUUM INTO (SQLite 3.27.0+)
    try {
      await this.db.run(sql.raw(`VACUUM INTO '${backupPath}'`));
      return;
    } catch (error: any) {
      logger.debug(`VACUUM INTO command failed: ${error.message}`);
    }

    // Method 3: Use sqlite3 command line tool
    if (this.options.databasePath) {
      await this.createCommandLineBackup(this.options.databasePath, backupPath);
      return;
    }

    throw new Error('All native backup methods failed');
  }

  /**
   * Create backup using sqlite3 command line tool
   */
  private async createCommandLineBackup(sourcePath: string, backupPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const sqlite3Process = spawn('sqlite3', [sourcePath], {
        stdio: ['pipe', 'pipe', 'pipe']
      });

      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      let stdout = '';
      let stderr = '';

      sqlite3Process.stdout.on('data', (data: any) => {
        stdout += data.toString();
      });

      sqlite3Process.stderr.on('data', (data: any) => {
        stderr += data.toString();
      });

      sqlite3Process.on('close', (code: number) => {
        if (code === 0) {
          logger.debug('Command line backup completed successfully');
          resolve();
        } else {
          reject(new Error(`sqlite3 backup failed with code ${code}: ${stderr}`));
        }
      });

      sqlite3Process.on('error', (error: any) => {
        reject(new Error(`Failed to spawn sqlite3 process: ${error.message}`));
      });

      // Send the backup command
      sqlite3Process.stdin.write(`.backup '${backupPath}'\n`);
      sqlite3Process.stdin.write('.quit\n');
      sqlite3Process.stdin.end();
    });
  }

  /**
   * Export database content to a file (fallback method for LibSQL databases)
   */
  private async exportDatabase(backupPath: string): Promise<void> {
    try {
      // Get all table names
      const tables = await this.getCurrentTables();
      
      // Create backup file with schema and data
      const backupStatements: string[] = [];
      
      // Export each table
      for (const tableName of tables) {
        try {
          // Get table schema
          const schemaResult: any = await this.db.all(
            sql.raw(`SELECT sql FROM sqlite_master WHERE type='table' AND name='${tableName}'`)
          );
          
          if (schemaResult.length > 0 && schemaResult[0].sql) {
            backupStatements.push(`${schemaResult[0].sql};`);
          }

          // Get table data
          const dataResult = await this.db.all(sql.raw(`SELECT * FROM ${tableName}`));
          
          if (dataResult.length > 0) {
            const columns = Object.keys(dataResult[0] as any);
            const values = dataResult.map(row => {
              const vals = columns.map(col => {
                const val = (row as any)[col];
                if (val === null) return 'NULL';
                if (typeof val === 'string') return `'${val.replace(/'/g, "''")}'`;
                return val;
              });
              return `(${vals.join(', ')})`;
            });
            
            backupStatements.push(
              `INSERT INTO ${tableName} (${columns.join(', ')}) VALUES ${values.join(', ')};`
            );
          }
        } catch (error: any) {
          logger.warn(`Failed to backup table ${tableName}: ${error.message}`);
        }
      }

      // Export indexes
      try {
        const indexResult: any = await this.db.all(
          sql.raw(`SELECT sql FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`)
        );
        
        for (const index of indexResult) {
          if (index.sql) {
            backupStatements.push(`${index.sql};`);
          }
        }
      } catch (error: any) {
        logger.warn(`Failed to backup indexes: ${error.message}`);
      }

      // Write backup file
      fs.writeFileSync(backupPath, backupStatements.join('\n'));
      
    } catch (error: any) {
      throw new Error(`Database export failed: ${error.message}`);
    }
  }


  /**
   * Get current tables from database
   */
  private async getCurrentTables(): Promise<Set<string>> {
    try {
      const result = await this.db.all(
        sql.raw(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`)
      );
      return new Set(result.map((row: any) => row.name));
    } catch (error: any) {
      logger.error(`Failed to get current tables: ${error.message}`);
      return new Set();
    }
  }

  /**
   * Get current columns for all tables
   */
  private async getCurrentColumns(): Promise<Map<string, Set<string>>> {
    const tables = await this.getCurrentTables();
    const columnsMap = new Map<string, Set<string>>();

    for (const tableName of tables) {
      try {
        const result = await this.db.all(sql.raw(`PRAGMA table_info(${tableName})`));
        columnsMap.set(tableName, new Set(result.map((row: any) => row.name)));
      } catch (error: any) {
        this.results.errors.push({
          operation: `get_columns_${tableName}`,
          error: error.message
        });
        logger.warn(`Failed to get columns for table ${tableName}: ${error.message}`);
      }
    }

    return columnsMap;
  }

  /**
   * Get current indexes
   */
  private async getCurrentIndexes(): Promise<Map<string, Set<string>>> {
    const indexesMap = new Map<string, Set<string>>();
    
    try {
      const result = await this.db.all(
        sql.raw(`SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'`)
      );
      
      for (const row of result) {
        const index = row as any;
        if (!indexesMap.has(index.tbl_name)) {
          indexesMap.set(index.tbl_name, new Set());
        }
        indexesMap.get(index.tbl_name)!.add(index.name);
      }
    } catch (error: any) {
      this.results.errors.push({
        operation: 'get_indexes',
        error: error.message
      });
      logger.warn(`Failed to get indexes: ${error.message}`);
    }

    return indexesMap;
  }

  /**
   * Repair missing tables
   */
  private async repairTables(schema: Record<string, DrizzleTable>, currentTables: Set<string>) {
    for (const [tableName, tableDefinition] of Object.entries(schema)) {
      if (!currentTables.has(tableName)) {
        try {
          await this.createTable(tableName, tableDefinition);
          this.results.tablesCreated.push(tableName);
          logger.info(`Created table: ${tableName}`);
        } catch (error: any) {
          this.results.errors.push({
            operation: `create_table_${tableName}`,
            error: error.message
          });
          logger.error(`Failed to create table ${tableName}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Repair missing columns
   */
  private async repairColumns(schema: Record<string, DrizzleTable>, currentColumns: Map<string, Set<string>>) {
    for (const [tableName, tableDefinition] of Object.entries(schema)) {
      const currentTableColumns = currentColumns.get(tableName);
      if (!currentTableColumns) continue;

      try {
        const schemaColumns = this.getSchemaColumns(tableDefinition);
        
        for (const columnName of schemaColumns.keys()) {
          if (!currentTableColumns.has(columnName)) {
            const columnDef = schemaColumns.get(columnName);
            if (columnDef) {
              await this.addColumn(tableName, columnName, columnDef);
              this.results.columnsAdded.push({ table: tableName, column: columnName });
              logger.info(`Added column: ${tableName}.${columnName}`);
            }
          }
        }
      } catch (error: any) {
        this.results.errors.push({
          operation: `repair_columns_${tableName}`,
          error: error.message
        });
        logger.error(`Failed to repair columns for table ${tableName}: ${error.message}`);
      }
    }
  }

  /**
   * Repair missing indexes
   */
  private async repairIndexes(schema: Record<string, DrizzleTable>, currentIndexes: Map<string, Set<string>>) {
    for (const [tableName, tableDefinition] of Object.entries(schema)) {
      try {
        const schemaIndexes = this.getSchemaIndexes(tableName, tableDefinition);
        const currentTableIndexes = currentIndexes.get(tableName) || new Set();

        for (const [indexName, indexDef] of schemaIndexes) {
          if (!currentTableIndexes.has(indexName)) {
            await this.createIndex(indexName, indexDef);
            this.results.indexesCreated.push(indexName);
            logger.info(`Created index: ${indexName}`);
          }
        }
      } catch (error: any) {
        this.results.errors.push({
          operation: `repair_indexes_${tableName}`,
          error: error.message
        });
        logger.error(`Failed to repair indexes for table ${tableName}: ${error.message}`);
      }
    }
  }

  /**
   * Create a table
   */
  private async createTable(tableName: string, tableDefinition: DrizzleTable) {
    if (this.options.dryRun) {
      logger.info(`[DRY RUN] Would create table: ${tableName}`);
      return;
    }

    try {
      // Try to get the SQL for creating the table from Drizzle
      let createSql: string;
      
      if (typeof tableDefinition.getSQL === 'function') {
        createSql = tableDefinition.getSQL();
      } else {
        // Fallback: generate basic CREATE TABLE statement
        const columns = this.getSchemaColumns(tableDefinition);
        const columnDefs = Array.from(columns.entries()).map(([name, def]) => `${name} ${def}`);
        createSql = `CREATE TABLE ${tableName} (${columnDefs.join(', ')})`;
      }
      
      logger.debug(`Creating table SQL: ${createSql}`);
      await this.db.run(sql.raw(createSql));
    } catch (error: any) {
      logger.error(`Failed to create table ${tableName}: ${error.message}`, {error});
    }
  }

  /**
   * Add a column to an existing table
   */
  private async addColumn(tableName: string, columnName: string, columnDefinition: string) {
    if (this.options.dryRun) {
      logger.info(`[DRY RUN] Would add column: ${tableName}.${columnName}`);
      return;
    }

    const addColumnSql = `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`;
    logger.debug(`Adding column SQL: ${addColumnSql}`);
    await this.db.run(sql.raw(addColumnSql));
  }

  /**
   * Create an index
   */
  private async createIndex(indexName: string, indexDefinition: string) {
    if (this.options.dryRun) {
      logger.info(`[DRY RUN] Would create index: ${indexName}`);
      return;
    }

    logger.debug(`Creating index SQL: ${indexDefinition}`);
    await this.db.run(sql.raw(indexDefinition));
  }

  /**
   * Extract column definitions from Drizzle table schema
   */
  private getSchemaColumns(tableDefinition: DrizzleTable): Map<string, string> {
    const columns = new Map<string, string>();
    
    try {
      // Try to access columns through various Drizzle table properties
      let columnsObj: any = null;
      
      if (tableDefinition._ && tableDefinition._.columns) {
        columnsObj = tableDefinition._.columns;
      } else if (tableDefinition.columns) {
        columnsObj = tableDefinition.columns;
      } else if (tableDefinition.table && tableDefinition.table.columns) {
        columnsObj = tableDefinition.table.columns;
      }

      if (columnsObj) {
        for (const [columnName, columnDef] of Object.entries(columnsObj)) {
          const sqlType = this.getSQLTypeFromColumn(columnDef as any);
          columns.set(columnName, sqlType);
        }
      }
    } catch (error: any) {
      logger.warn(`Could not extract columns from table definition: ${error.message}`);
    }

    return columns;
  }

  /**
   * Extract index definitions from Drizzle table schema
   */
  private getSchemaIndexes(tableName: string, tableDefinition: DrizzleTable): Map<string, string> {
    const indexes = new Map<string, string>();
    
    try {
      let indexesObj: any = null;
      
      if (tableDefinition._ && tableDefinition._.indexes) {
        indexesObj = tableDefinition._.indexes;
      } else if (tableDefinition.indexes) {
        indexesObj = tableDefinition.indexes;
      }

      if (indexesObj) {
        for (const [indexName, indexDef] of Object.entries(indexesObj)) {
          const sql = this.getIndexSQL(tableName, indexName, indexDef as any);
          if (sql) {
            indexes.set(indexName, sql);
          }
        }
      }
    } catch (error: any) {
      logger.warn(`Could not extract indexes for table ${tableName}: ${error.message}`);
    }

    return indexes;
  }

  /**
   * Convert Drizzle column definition to SQL type
   */
  private getSQLTypeFromColumn(columnDef: any): string {
    try {
      // Try Drizzle's built-in SQL type method
      if (typeof columnDef.getSQLType === 'function') {
        return columnDef.getSQLType();
      }
      
      // Fallback type mapping based on common Drizzle patterns
      let sqlType = 'TEXT'; // Default fallback
      
      if (columnDef.dataType) {
        sqlType = columnDef.dataType.toUpperCase();
      } else if (columnDef.columnType) {
        sqlType = columnDef.columnType.toUpperCase();
      } else if (columnDef.sqlName) {
        sqlType = columnDef.sqlName.toUpperCase();
      }
      
      // Handle common type mappings
      const typeMap: Record<string, string> = {
        'VARCHAR': 'TEXT',
        'INTEGER': 'INTEGER',
        'REAL': 'REAL',
        'BLOB': 'BLOB',
        'BOOLEAN': 'INTEGER'
      };
      
      sqlType = typeMap[sqlType] || sqlType;
      
      // Add constraints
      const constraints: string[] = [];
      
      if (columnDef.notNull || columnDef.hasDefault === false) {
        constraints.push('NOT NULL');
      }
      
      if (columnDef.primaryKey) {
        constraints.push('PRIMARY KEY');
      }
      
      if (columnDef.hasDefault && columnDef.default !== undefined) {
        let defaultValue = columnDef.default;
        if (typeof defaultValue === 'string') {
          defaultValue = `'${defaultValue}'`;
        }
        constraints.push(`DEFAULT ${defaultValue}`);
      }
      
      return `${sqlType}${constraints.length > 0 ? ' ' + constraints.join(' ') : ''}`;
    } catch (error: any) {
      logger.debug(`Failed to determine SQL type for column, using TEXT: ${error.message}`);
      return 'TEXT';
    }
  }

  /**
   * Generate SQL for creating an index
   */
  private getIndexSQL(tableName: string, indexName: string, indexDef: any): string | null {
    try {
      // Try Drizzle's built-in SQL method
      if (typeof indexDef.getSQL === 'function') {
        return indexDef.getSQL();
      }

      // Fallback index creation
      let columns: string[] = [];
      
      if (Array.isArray(indexDef.columns)) {
        columns = indexDef.columns.map((col: any) => {
          if (typeof col === 'string') return col;
          if (col.name) return col.name;
          if (col.columnName) return col.columnName;
          return String(col);
        });
      } else if (indexDef.column) {
        columns = [indexDef.column.name || indexDef.column];
      }
      
      if (columns.length === 0) {
        logger.warn(`No columns found for index ${indexName}`);
        return null;
      }

      const columnList = columns.join(', ');
      const unique = indexDef.unique ? 'UNIQUE ' : '';
      
      return `CREATE ${unique}INDEX ${indexName} ON ${tableName} (${columnList})`;
    } catch (error: any) {
      logger.warn(`Failed to generate SQL for index ${indexName}: ${error.message}`);
      return null;
    }
  }
}

export type { RepairOptions, RepairResult };