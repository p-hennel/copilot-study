# Database Management System

This document describes the improved database management system for the web application, featuring safe migrations, backup capabilities, and CLI tools.

## 🚀 Overview

The database management system has been enhanced with the following features:

- **Safe Migrations**: Non-destructive database migrations with individual statement execution
- **Automatic Backups**: Automatic backup creation before any database changes
- **CLI Tools**: Command-line tools for database management and inspection
- **SQLite3 Access**: Direct database access via SQLite3 CLI tool
- **Integrity Checking**: Built-in database integrity verification

## 📁 Key Files

- `db-migrate-safe.ts` - Safe migration system with individual statement execution
- `db-cli.sh` - Command-line database management tool
- `startup.sh` - Updated startup script with safe migration integration
- `Dockerfile` - Updated to include SQLite3 CLI and backup directories

## 🔧 Safe Migration System

### Features

- **Non-Destructive**: Never drops tables or deletes data (except indexes when necessary)
- **Individual Statement Execution**: Each SQL statement is executed separately with error handling
- **Smart Table Management**: Analyzes existing tables and adds missing columns instead of failing
- **Schema Comparison**: Compares CREATE TABLE statements with existing table schemas
- **Column Addition**: Automatically adds missing columns to existing tables using ALTER TABLE
- **Automatic Backups**: Creates backups before applying migrations
- **Rollback Support**: Maintains backups for rollback capabilities
- **Integrity Checking**: Verifies database integrity after migrations
- **Detailed Logging**: Comprehensive logging of all migration activities

### How It Works

1. **Backup Creation**: Creates a timestamped backup before any changes
2. **Statement Parsing**: Parses migration files into individual SQL statements
3. **Safety Classification**: Classifies each statement as safe, destructive, or requiring validation
4. **Smart Table Handling**: For CREATE TABLE statements:
   - Checks if table already exists
   - If exists, compares schema and identifies missing columns
   - Generates ALTER TABLE ADD COLUMN statements for missing columns
   - If doesn't exist, creates table normally
5. **Individual Execution**: Executes each statement in isolation with proper error handling
6. **Validation**: Validates successful execution of critical statements
7. **Integrity Check**: Runs database integrity checks after completion

### Migration Types Handled

- ✅ `CREATE TABLE` - Creates new tables or adds missing columns to existing tables
  - **New Table**: Creates table with all columns and constraints
  - **Existing Table**: Analyzes schema, identifies missing columns, adds them via ALTER TABLE
- ✅ `CREATE INDEX` - Creates new indexes
- ✅ `DROP INDEX` - Safely removes indexes (only destructive operation allowed)
- ✅ `ALTER TABLE ADD COLUMN` - Adds new columns (also auto-generated for existing tables)
- ❌ `DROP TABLE` - Blocked for safety
- ❌ `DROP COLUMN` - Blocked for safety
- ❌ `DELETE FROM` - Blocked for safety

### Smart Schema Management

The migration system intelligently handles schema evolution:

**Example Scenario**:
1. Migration contains: `CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT, role TEXT)`
2. Database has: `user` table with only `id`, `name`, `email` columns
3. System detects missing `role` column
4. Automatically executes: `ALTER TABLE user ADD COLUMN role TEXT`
5. Logs: `📝 Adding 1 missing columns to user: role`

**Column Addition Rules**:
- Preserves existing data and columns
- Adds only missing columns from CREATE TABLE statement
- Filters out unsafe constraints for existing tables (PRIMARY KEY, UNIQUE)
- Maintains column data types and basic constraints
- Creates backups before any schema changes

## 🛠 CLI Tools Usage

### Basic Commands

```bash
# Show database status and table information
./db-cli.sh status

# List all tables
./db-cli.sh tables

# Show schema for all tables or specific table
./db-cli.sh schema
./db-cli.sh schema user

# Execute a SQL query
./db-cli.sh query "SELECT COUNT(*) FROM user;"

# Open interactive SQLite shell
./db-cli.sh connect
```

### Backup and Restore

```bash
# Create backup (timestamped in /home/bun/data/backups/)
./db-cli.sh backup

# Create backup to specific location
./db-cli.sh backup /path/to/backup.db

# Restore from backup
./db-cli.sh restore /path/to/backup.db
```

### Maintenance

```bash
# Check database integrity
./db-cli.sh integrity

# Optimize database (VACUUM)
./db-cli.sh vacuum

# Run safe migration
./db-cli.sh migrate
```

### NPM Scripts

```bash
# Run safe migration
bun run db:migrate:safe

# Open database CLI
bun run db:cli

# Show database status
bun run db:status

# Create backup
bun run db:backup
```

## 🐳 Docker Integration

### Startup Process

When the Docker container starts:

1. **Database Initialization**: Checks if safe migrator is available
2. **Safe Migration**: Runs safe migration system if available
3. **Fallback**: Falls back to legacy `db-test.ts` if safe migrator fails
4. **Application Start**: Starts the web application after successful database setup

### SQLite3 CLI Access

The Docker image includes the `sqlite3` CLI tool for direct database access:

```bash
# Connect to container
docker exec -it <container-name> bash

# Access database directly
sqlite3 /home/bun/data/config/main.db

# Or use the CLI helper
./db-cli.sh connect
```

### Directory Structure

```
/home/bun/data/
├── config/
│   └── main.db          # Main database file
├── backups/             # Automatic backups
│   ├── backup-2024-01-01T12-00-00.db
│   └── manual_backup_20240101_120000.db
├── logs/                # Application logs
└── archive/             # Archived data
```

## 🔒 Safety Features

### Migration Safety

- **Destructive Operation Blocking**: Automatically blocks operations that could cause data loss
- **Statement Isolation**: Each statement is executed in its own transaction
- **Error Recovery**: Continues with non-critical errors, stops on critical failures
- **Validation**: Validates table and index creation after execution

### Backup Strategy

- **Automatic Backups**: Created before any migration or destructive operation
- **Timestamped**: All backups are timestamped for easy identification
- **Integrity Verified**: Backup integrity is verified during creation
- **Space Efficient**: Uses SQLite VACUUM INTO for compact backups

### Error Handling

- **Non-Critical Errors**: "already exists" errors are treated as non-critical
- **Critical Errors**: Schema corruption or constraint violations stop migration
- **Logging**: All errors are logged with context and SQL statement
- **Recovery**: Failed migrations preserve original database state

## 📊 Monitoring and Maintenance

### Health Checks

```bash
# Check overall database health
./db-cli.sh status

# Verify database integrity
./db-cli.sh integrity

# Monitor database size and optimization
./db-cli.sh vacuum
```

### Backup Management

- Backups are stored in `/home/bun/data/backups/`
- Automatic cleanup of old backups (implementation recommended)
- Manual backup creation before major changes
- Restore capabilities with confirmation prompts

### Performance Optimization

- WAL mode enabled for better concurrent access
- Foreign key constraints enabled for data integrity
- VACUUM operations for space optimization
- Index management for query performance

## 🚨 Troubleshooting

### Common Issues

1. **Migration Fails**
   - Check logs for specific error messages
   - Verify database file permissions
   - Ensure sufficient disk space
   - Use backup to restore if needed

2. **Database Corruption**
   - Run integrity check: `./db-cli.sh integrity`
   - Restore from recent backup
   - Contact support if corruption persists

3. **Performance Issues**
   - Run VACUUM: `./db-cli.sh vacuum`
   - Check index usage with query analysis
   - Consider database optimization

### Recovery Procedures

1. **From Backup**:
   ```bash
   ./db-cli.sh restore /home/bun/data/backups/backup-TIMESTAMP.db
   ```

2. **Integrity Repair**:
   ```bash
   # Check integrity
   ./db-cli.sh integrity
   
   # If issues found, restore from backup
   ./db-cli.sh restore /path/to/good/backup.db
   ```

3. **Emergency Access**:
   ```bash
   # Direct SQLite access
   sqlite3 /home/bun/data/config/main.db
   
   # Check tables
   .tables
   
   # Check schema
   .schema
   ```

## 🔮 Future Enhancements

- Automated backup rotation and cleanup
- Migration rollback capabilities
- Performance monitoring and alerting
- Automated integrity checking schedules
- Integration with external backup systems
- Advanced query performance analysis tools

## ✅ Best Practices

1. **Always backup before major changes**
2. **Test migrations in development first**
3. **Monitor database size and performance**
4. **Run integrity checks regularly**
5. **Keep backups in multiple locations**
6. **Use the CLI tools for maintenance**
7. **Monitor application logs for database errors**