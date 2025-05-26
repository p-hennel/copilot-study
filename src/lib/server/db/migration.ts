import { createRequire } from "module";
import * as schema from "./schema";
import { createClient } from "@libsql/client";
import { getLogger } from "nodemailer/lib/shared";

global.require = createRequire(import.meta.url);

const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import("drizzle-kit/api");

const [previous, current]: Awaited<ReturnType<typeof generateSQLiteDrizzleJson>>[] =
  await Promise.all([{}, schema].map((schemaObject) => generateSQLiteDrizzleJson(schemaObject)));

const statements = await generateSQLiteMigration(previous, current);
const migration = statements.join("\n");

export default async function doMigration(filePath: string) {
  let logger
  try {
    logger = getLogger(["backend", "migration"]);
    logger.debug(`migrating: ${filePath}`)
    logger.trace(migration);
    const client = createClient({ url: filePath });
    for (const migration of statements) {
      await client.execute(migration);
    }
    //const result = await .execute(migration)
    logger.info('finished migration')
    //return result
  } catch (err: any) {
    if (logger) {
      logger.error("Error during migration", {
        error: err
      })
    } else {
      console.error("Error during migration", {
        error: err
      })
    }
  }
}
