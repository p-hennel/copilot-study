#!/bin/bash

mkdir -p /home/bun/data/logs /home/bun/data/archive /home/bun/data/config
chown -R bun:bun /home/bun/data

export PATH=$HOME/.bun/bin:$PATH

bun pm2-runtime start ecosystem.config.cjs --only web