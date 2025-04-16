#!/bin/bash
# Test script to run the supervisor with all components

# Make sure necessary directories exist
mkdir -p tmp data.private/config data.private/logs data.private/archive

# Clean up any existing socket files
rm -f tmp/supervisor.sock tmp/auth-ipc.sock

# Create or initialize the database if it doesn't exist
touch data.private/config/main.db

# Set environment variables
export DATABASE_URL="$PWD/data.private/config/main.db"
export DATA_ROOT="$PWD/data.private"
export SETTINGS_FILE="$PWD/data.private/config/settings.yaml"
export GITLAB_TOKEN="placeholder_token_for_testing"
export GITLAB_CLIENT_ID="placeholder_client_id"
export GITLAB_CLIENT_SECRET="placeholder_client_secret"

# Run the supervisor
echo "Starting supervisor with all components..."
bun run supervisor start
