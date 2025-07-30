#!/bin/bash

# Database CLI Helper Script
# Provides easy access to the SQLite database with common operations

# Use same logic as the migration script
if [ -n "$DATABASE_URL" ]; then
    DB_PATH="$DATABASE_URL"
    DB_FILE="${DB_PATH#file://}"
elif [ -n "$DB_FILE" ]; then
    DB_FILE="$DB_FILE"
else
    # Default for local development
    DB_FILE="./app.db"
fi

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

show_help() {
    echo -e "${BLUE}Database CLI Helper${NC}"
    echo -e "Usage: $0 [command] [options]"
    echo ""
    echo -e "${YELLOW}Commands:${NC}"
    echo "  connect               Open interactive SQLite shell"
    echo "  status                Show database status and table info"
    echo "  backup [path]         Create backup (default: /home/bun/data/backups/)"
    echo "  restore <path>        Restore from backup"
    echo "  query '<sql>'         Execute a single SQL query"
    echo "  schema [table]        Show schema for all tables or specific table"
    echo "  tables                List all tables"
    echo "  vacuum                Optimize database (VACUUM)"
    echo "  integrity             Check database integrity"
    echo "  migrate               Run safe migration"
    echo "  help                  Show this help"
    echo ""
    echo -e "${YELLOW}Examples:${NC}"
    echo "  $0 status"
    echo "  $0 query 'SELECT COUNT(*) FROM user;'"
    echo "  $0 schema user"
    echo "  $0 backup /tmp/my-backup.db"
}

check_db_exists() {
    if [ ! -f "$DB_FILE" ]; then
        echo -e "${RED}❌ Database file not found: $DB_FILE${NC}"
        echo -e "${YELLOW}💡 Run '$0 migrate' to initialize the database${NC}"
        exit 1
    fi
}

show_status() {
    check_db_exists
    
    echo -e "${BLUE}📊 Database Status${NC}"
    echo -e "Path: $DB_FILE"
    echo -e "Size: $(du -h "$DB_FILE" | cut -f1)"
    echo ""
    
    # Get table count and row counts
    echo -e "${YELLOW}📋 Tables:${NC}"
    sqlite3 "$DB_FILE" "
    SELECT 
        name as table_name,
        (SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND tbl_name=m.name) as indexes,
        CASE 
            WHEN name LIKE 'sqlite_%' THEN 'System'
            ELSE 'User'  
        END as type
    FROM sqlite_master m 
    WHERE type='table' 
    ORDER BY name;
    " -header -column
    
    echo ""
    echo -e "${YELLOW}💾 Database Settings:${NC}"
    sqlite3 "$DB_FILE" "
    PRAGMA journal_mode;
    PRAGMA synchronous;
    PRAGMA foreign_keys;
    " -header -column
}

list_tables() {
    check_db_exists
    echo -e "${BLUE}📋 Database Tables${NC}"
    sqlite3 "$DB_FILE" "
    SELECT 
        name,
        sql
    FROM sqlite_master 
    WHERE type='table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name;
    " -header -column
}

show_schema() {
    check_db_exists
    local table_name="$1"
    
    if [ -n "$table_name" ]; then
        echo -e "${BLUE}📋 Schema for table: $table_name${NC}"
        sqlite3 "$DB_FILE" ".schema $table_name"
    else
        echo -e "${BLUE}📋 Complete Database Schema${NC}"
        sqlite3 "$DB_FILE" ".schema"
    fi
}

execute_query() {
    check_db_exists
    local query="$1"
    
    if [ -z "$query" ]; then
        echo -e "${RED}❌ No query provided${NC}"
        exit 1
    fi
    
    echo -e "${BLUE}🔍 Executing: $query${NC}"
    sqlite3 "$DB_FILE" "$query" -header -column
}

create_backup() {
    check_db_exists
    local backup_path="$1"
    
    if [ -z "$backup_path" ]; then
        # Create timestamped backup in default location
        local timestamp=$(date +"%Y%m%d_%H%M%S")
        backup_path="/home/bun/data/backups/manual_backup_${timestamp}.db"
        mkdir -p "$(dirname "$backup_path")"
    fi
    
    echo -e "${BLUE}💾 Creating backup...${NC}"
    sqlite3 "$DB_FILE" "VACUUM INTO '$backup_path';"
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Backup created successfully: $backup_path${NC}"
        echo -e "Size: $(du -h "$backup_path" | cut -f1)"
    else
        echo -e "${RED}❌ Backup failed${NC}"
        exit 1
    fi
}

restore_backup() {
    local backup_path="$1"
    
    if [ -z "$backup_path" ]; then
        echo -e "${RED}❌ Backup path required${NC}"
        exit 1
    fi
    
    if [ ! -f "$backup_path" ]; then
        echo -e "${RED}❌ Backup file not found: $backup_path${NC}"
        exit 1
    fi
    
    echo -e "${YELLOW}⚠️  This will replace the current database!${NC}"
    read -p "Are you sure? (y/N): " -n 1 -r
    echo
    
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        # Create backup of current database first
        local current_backup="/home/bun/data/backups/pre_restore_$(date +"%Y%m%d_%H%M%S").db"
        mkdir -p "$(dirname "$current_backup")"
        
        if [ -f "$DB_FILE" ]; then
            cp "$DB_FILE" "$current_backup"
            echo -e "${GREEN}✅ Current database backed up to: $current_backup${NC}"
        fi
        
        # Restore from backup
        cp "$backup_path" "$DB_FILE"
        echo -e "${GREEN}✅ Database restored from: $backup_path${NC}"
    else
        echo -e "${YELLOW}❌ Restore cancelled${NC}"
    fi
}

check_integrity() {
    check_db_exists
    echo -e "${BLUE}🔍 Checking database integrity...${NC}"
    
    local result=$(sqlite3 "$DB_FILE" "PRAGMA integrity_check;")
    
    if [ "$result" = "ok" ]; then
        echo -e "${GREEN}✅ Database integrity check passed${NC}"
    else
        echo -e "${RED}❌ Database integrity issues found:${NC}"
        echo "$result"
    fi
}

vacuum_db() {
    check_db_exists
    echo -e "${BLUE}🧹 Optimizing database (VACUUM)...${NC}"
    
    local size_before=$(du -k "$DB_FILE" | cut -f1)
    sqlite3 "$DB_FILE" "VACUUM;"
    local size_after=$(du -k "$DB_FILE" | cut -f1)
    
    local saved=$((size_before - size_after))
    echo -e "${GREEN}✅ Database optimized${NC}"
    echo -e "Size before: ${size_before}KB"
    echo -e "Size after: ${size_after}KB"
    echo -e "Space saved: ${saved}KB"
}

run_migration() {
    echo -e "${BLUE}🚀 Running safe database migration...${NC}"
    
    if [ -f "db-migrate-safe.ts" ]; then
        bun --bun run db-migrate-safe.ts
    else
        echo -e "${YELLOW}⚠️  Safe migrator not found, using db-test...${NC}"
        bun --bun run db-test.ts
    fi
}

open_interactive() {
    check_db_exists
    echo -e "${BLUE}🔧 Opening interactive SQLite shell${NC}"
    echo -e "${YELLOW}Database: $DB_FILE${NC}"
    echo -e "${YELLOW}Type .help for SQLite commands, .quit to exit${NC}"
    echo ""
    
    sqlite3 "$DB_FILE"
}

# Main command dispatch
case "$1" in
    "status")
        show_status
        ;;
    "tables")
        list_tables
        ;;
    "schema")
        show_schema "$2"
        ;;
    "query")
        execute_query "$2"
        ;;
    "backup")
        create_backup "$2"
        ;;
    "restore")
        restore_backup "$2"
        ;;
    "integrity")
        check_integrity
        ;;
    "vacuum")
        vacuum_db
        ;;
    "migrate")
        run_migration
        ;;
    "connect")
        open_interactive
        ;;
    "help"|"--help"|"-h")
        show_help
        ;;
    "")
        show_help
        ;;
    *)
        echo -e "${RED}❌ Unknown command: $1${NC}"
        echo ""
        show_help
        exit 1
        ;;
esac