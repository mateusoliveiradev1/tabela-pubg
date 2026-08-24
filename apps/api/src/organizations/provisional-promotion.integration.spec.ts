import { createDatabase, type DatabaseConnection } from "@pubg-camp/database";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
describe.runIf(Boolean(databaseUrl && redisUrl))(
  "provisional OTP promotion through real PostgreSQL and Redis",
  () => {
    let database: DatabaseConnection;

    beforeAll(async () => {
      if (!databaseUrl || !redisUrl) throw new Error("real PostgreSQL and Redis are required");
      database = createDatabase(databaseUrl);
      await database.ping();
    }, 30_000);

    afterAll(async () => {
      if (database) await database.close();
    }, 30_000);

    it("denies provisional create/accept and unlocks only the committed replacement token", () => {
      expect(database.db).toBeDefined();
      throw new Error("RED: provisional promotion end-to-end scenario is not implemented");
    });
  },
);
