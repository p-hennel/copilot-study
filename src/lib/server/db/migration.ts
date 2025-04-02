import { createRequire } from "module";
import * as schema from "./schema";
import { createClient } from "@libsql/client";

global.require = createRequire(import.meta.url);

const { generateSQLiteDrizzleJson, generateSQLiteMigration } = await import(
  "drizzle-kit/api"
);

const [previous, current]: Awaited<ReturnType<typeof generateSQLiteDrizzleJson>>[] = await Promise.all(
  [{}, schema].map((schemaObject) => generateSQLiteDrizzleJson(schemaObject))
);

const statements = await generateSQLiteMigration(previous, current);
const migration = statements.join("\n");

export default async function doMigration(filePath: string) {
  try {
    console.log(`migrating: ${filePath} with ${migration}`)
    const client = createClient({ url: filePath })
    for (const migration of statements) {
      await client.execute(migration)
    }
    //const result = await .execute(migration)
    console.log(`finished migration `) //${Bun.inspect(result)}
    //return result
  } catch (err:any) { /* empty */ }
}