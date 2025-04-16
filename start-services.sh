#!/bin/bash
set -e

# Create required directories
mkdir -p tmp
mkdir -p data.private/config data.private/archive data.private/logs

# Kill any existing processes
pkill -f "simple-supervisor" || true
pkill -f "mock-cli" || true
sleep 1

# Remove old socket files
rm -f tmp/supervisor.sock tmp/auth-ipc.sock

# Set environment variables for testing
export GITLAB_TOKEN="test-token"
export GITLAB_CLIENT_ID="test-client-id"
export GITLAB_CLIENT_SECRET="test-client-secret"

# Start website (in background)
echo "Starting website in separate terminal..."
bun run dev > website.log 2>&1 &
WEBSITE_PID=$!

# Wait a moment for the website to initialize
sleep 2

# Start the crawler directly
echo "Starting crawler directly..."
bun run crawler:start > crawler.log 2>&1 &
CRAWLER_PID=$!

echo "Services started."
echo "Website PID: $WEBSITE_PID"
echo "Crawler PID: $CRAWLER_PID"
echo "Logs in website.log and crawler.log"

# Keep script running
echo "Press Ctrl+C to stop all services"
trap "kill $WEBSITE_PID $CRAWLER_PID; echo 'Services stopped.'" INT
wait
