import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";
import AppSettings from "../settings/index";

const client = createClient({ url: AppSettings.paths.database });

export const db = drizzle(client, { schema });

process.on('SIGINT', function() {
  client.close()
  process.exit(0)
})