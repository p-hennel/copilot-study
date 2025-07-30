#!/bin/sh

export PATH=$HOME/.bun/bin:$PATH

# to generate: echo "$(openssl enc -base64 -in storagebox.private | tr -d '\n')"
#$(openssl enc -base64 -d <<< "${BACKUP_PRIVATE_KEY}") > ~/.ssh/storagebox
#ssh-keyscan "${BACKUP_USER}.your-storagebox.de" >> ~/.ssh/known_hosts

#cron
#autorestic check

# Safe database initialization and migration
echo "🚀 Starting database initialization..."

# Check if we should use the safe migrator or fallback to db-test
if [ -f "db-migrate-safe.ts" ]; then
  echo "📦 Using safe migration system..."
  bun --bun run db-migrate-safe.ts
  MIGRATION_EXIT_CODE=$?
  
  if [ $MIGRATION_EXIT_CODE -eq 0 ]; then
    echo "✅ Safe migration completed successfully"
  else
    echo "❌ Safe migration failed with code $MIGRATION_EXIT_CODE"
    echo "🔄 Falling back to legacy db-test..."
    bun --bun run db-test.ts
  fi
else
  echo "⚠️ Safe migrator not found, using legacy db-test..."
  bun --bun run db-test.ts
fi

if [ "$SUPERVUSOR" -eq "pm2" ]; then
  bun pm2-runtime start ecosystem.config.cjs
elif [ -f "$1" ]; then
  bun --bun "$1"
elif [ -f "index.js" ]; then
  bun --bun index.js
elif [ -f "build/index.js" ]; then
  bun --bun build/index.js
else
  echo "No index.js or build/index.js or file at first parameter ($1) found. Please provide a valid entry point."
  exit 1
fi
