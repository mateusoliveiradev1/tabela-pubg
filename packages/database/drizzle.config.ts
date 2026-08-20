import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://pubg:pubg@127.0.0.1:5432/pubg_camp",
  },
  strict: true,
  verbose: true,
});
