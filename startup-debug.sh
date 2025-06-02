#!/bin/sh

export PATH=$HOME/.bun/bin:$PATH

bun install

#bun run build

#mkdir -p ./schema
#cp ./dual-server.js ./build/index.js
#cp /usr/src/app/src/lib/server/db/*schema.ts \
#  /usr/src/app/src/lib/types.ts \
#  ./schema/

bun --bun run db-test.ts

#./startup.sh ./build/index.js
bun run dev