import { createRequire } from "module";
import * as schema from "./schema";
import { createClient } from "@libsql/client";
import { getLogger } from "@logtape/logtape";
import path from "path";

global.require = createRequire(import.meta.url);

const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");

const [previous, current]: Awaited<ReturnType<typeof generateSQLiteDrizzleJson>>[] =
  await Promise.all([{}, schema].map((schemaObject) => generateSQLiteDrizzleJson(schemaObject)));

const statements = await generateSQLiteMigration(previous || {} as any, current as any);
const migration = statements.join("\n");

export default async function doMigration(filePath: string) {
  const logger = getLogger(["backend", "migration"]);
  try {
    logger.debug("migrating: {filePath}", { filePath });
    logger.debug("migration: {migration}", { migration });
    if (!filePath.startsWith("file:")) {
      filePath = `file:${path.resolve(filePath)}`;
    }
    const client = createClient({ url: filePath });
    
    // Execute migration statements one by one with error handling
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (!statement) {
        logger.warn(`Skipping empty migration statement at index ${i}`);
        continue;
      }
      
      try {
        logger.debug(`Executing migration statement ${i + 1}/${statements.length}: ${statement.substring(0, 100)}...`);
        await client.execute(statement);
        logger.debug(`Successfully executed statement ${i + 1}`);
      } catch (statementError: any) {
        // Handle "table already exists" errors gracefully
        if (statementError.code === "SQLITE_ERROR" &&
            statementError.message?.includes("already exists")) {
          logger.info(`Table already exists, skipping: ${statement.substring(0, 100)}...`);
          continue;
        }
        // Re-throw other errors
        throw statementError;
      }
    }
    logger.info("finished migration");
  } catch (err: any) {
    logger.error("Error during migration: {error}", { error: err });
    // Don't throw to prevent application startup failure on migration issues
  }
}
