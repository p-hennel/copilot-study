import { drizzle, type LibSQLDatabase } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import * as schema from "./schema";
import AppSettings from "../settings"; // Import the class itself
import path from "node:path";

let client: Client | null = null;
let dbInstance: LibSQLDatabase<typeof schema> | null = null;

function getDbClient(): Client {
  if (!client) {
    // Get settings *inside* this function, ensuring AppSettings is initialized
    let dbUrl = AppSettings().paths.database;
    if (!dbUrl) {
      throw new Error("Database path is not defined in settings.");
    }
    console.log(`Initializing database client with URL: ${dbUrl}`);
    if (dbUrl.indexOf("://") < 0) {
      dbUrl = `file://${path.resolve(dbUrl)}`;
      console.log(`Fixed url to ${dbUrl}`);
    }
    client = createClient({ url: dbUrl });
  }
  return client;
}

// Export a function to get the initialized drizzle instance
export function getDb(): LibSQLDatabase<typeof schema> {
  if (!dbInstance) {
    const dbClient = getDbClient(); // Ensure client is initialized
    dbInstance = drizzle(dbClient, { schema });
  }
  return dbInstance;
}

// Ensure the db instance is accessible for other potential top-level needs if any
// (Though ideally, consumers should call getDb())
export const db = getDb();

// Handle graceful shutdown
process.on("SIGINT", function () {
  console.log("Received SIGINT, closing database client...");
  // Check if client was initialized before trying to close
  if (client) {
    client.close();
    console.log("Database client closed.");
  } else {
    console.log("Database client was not initialized, nothing to close.");
  }
  process.exit(0);
});

// Optional: Export client getter if direct client access is needed elsewhere
// export { getDbClient };
