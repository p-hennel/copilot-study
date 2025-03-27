import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import { env } from "$env/dynamic/private";

let dbUrl = env.DATABASE_URL
if (!dbUrl)
  dbUrl = "file:/home/bun/data/config/main.db"

const client = createClient({ url: dbUrl });

export const db = drizzle(client, { schema });

process.on('SIGINT', function() {
  client.close()
  process.exit(0)
})