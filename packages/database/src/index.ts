import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema.js";

export * from "./outbox.js";
export * from "./repositories/index.js";
export * from "./schema.js";

export function createDatabase(databaseUrl: string) {
  const client = postgres(databaseUrl, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 5,
    prepare: false,
  });
  const db = drizzle(client, { schema });

  return {
    db,
    async ping(): Promise<void> {
      await client`select 1`;
    },
    async close(): Promise<void> {
      await client.end({ timeout: 5 });
    },
  };
}

export type DatabaseConnection = ReturnType<typeof createDatabase>;
