#!/bin/sh

if [[ -n "$SOCKET_PATH" ]]; then
  if [ ! -e "$SOCKET_PATH" ]; then
    touch "$SOCKET_PATH"
  fi
fi

if [[ -n "$SUPERVISOR_SOCKET_PATH" ]]; then
  if [ ! -e "$SUPERVISOR_SOCKET_PATH" ]; then
    touch "$SUPERVISOR_SOCKET_PATH"
  fi
fi

export PATH=$HOME/.bun/bin:$PATH

# to generate: echo "$(openssl enc -base64 -in storagebox.private | tr -d '\n')"
#$(openssl enc -base64 -d <<< "${BACKUP_PRIVATE_KEY}") > ~/.ssh/storagebox
#ssh-keyscan "${BACKUP_USER}.your-storagebox.de" >> ~/.ssh/known_hosts

#cron
#autorestic check

bun --bun run db-test.ts

if [ "$SUPERVISOR" == "pm2" ]; then
  bun pm2-runtime start ecosystem.config.cjs
elif [ -f "$1" ]; then
  bun --bun "$1"
elif [ -f "index.js" ]; then
  bun --bun index.js
elif [ -f "build/index.js" ]; then
  bun --bun build/index.js
elif [ -f "web/index.js" ]; then
  bun --bun web/index.js
else
  echo "No index.js or build/index.js or file at first parameter ($1) found. Please provide a valid entry point."
  exit 1
fi
