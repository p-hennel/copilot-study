import { defineConfig } from "drizzle-kit";

let dbUrl = process.env.DATABASE_URL;
if (!dbUrl) dbUrl = "/home/bun/data/config/main.db";
export default defineConfig({
  // Revert back to main schema export file
  schema: "./schema/schema.ts",
  dialect: "sqlite",
  out: "./drizzle",

  dbCredentials: {
    url: dbUrl
  },

  verbose: true,
  strict: true
});
