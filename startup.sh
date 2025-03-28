#!/bin/bash

mkdir -p /home/bun/data/logs /home/bun/data/archive /home/bun/data/config
chown -R bun:bun /home/bun/data

export PATH=$HOME/.bun/bin:$PATH

# to generate: echo "$(openssl enc -base64 -in storagebox.private | tr -d '\n')"
$(openssl enc -base64 -d <<< "${BACKUP_PRIVATE_KEY}") > ~/.ssh/storagebox
ssh-keyscan "${BACKUP_USER}.your-storagebox.de" >> ~/.ssh/known_hosts

cron
autorestic check

bun pm2-runtime start ecosystem.config.cjs