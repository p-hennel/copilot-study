import { defineConfig } from "drizzle-kit";

let dbUrl = process.env.DATABASE_URL
if (!dbUrl)
  dbUrl = "file:/data/config/main.db"

export default defineConfig({
  schema: "./src/lib/server/db/schema.ts",
  dialect: "sqlite",

  dbCredentials: {
    url: dbUrl
  },

  verbose: true,
  strict: true
});
