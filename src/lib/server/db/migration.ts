import { createRequire } from "module";
import * as schema from "./schema";
import { createClient } from "@libsql/client";
import { getLogger } from "@logtape/logtape";
import path from "path";

global.require = createRequire(import.meta.url);

const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");

const [previous, current]: Awaited<ReturnType<typeof generateSQLiteDrizzleJson>>[] =
  await Promise.all([{}, schema].map((schemaObject) => generateSQLiteDrizzleJson(schemaObject)));

let statements = await generateSQLiteMigration(previous || {} as any, current as any);

// Make statements idempotent by adding IF NOT EXISTS clauses
statements = statements.map(statement => {
  // Handle CREATE TABLE statements
  if (statement.trim().toUpperCase().startsWith('CREATE TABLE')) {
    return statement.replace(/CREATE TABLE\s+/i, 'CREATE TABLE IF NOT EXISTS ');
  }
  // Handle CREATE INDEX statements
  if (statement.trim().toUpperCase().startsWith('CREATE INDEX')) {
    return statement.replace(/CREATE INDEX\s+/i, 'CREATE INDEX IF NOT EXISTS ');
  }
  // Handle CREATE UNIQUE INDEX statements
  if (statement.trim().toUpperCase().startsWith('CREATE UNIQUE INDEX')) {
    return statement.replace(/CREATE UNIQUE INDEX\s+/i, 'CREATE UNIQUE INDEX IF NOT EXISTS ');
  }
  return statement;
});

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
    for (const migrationStatement of statements) {
      await client.execute(migrationStatement);
    }
    logger.info("finished migration");
  } catch (err: any) {
    logger.error("Error during migration: {error}", { error: err });
  }
}
