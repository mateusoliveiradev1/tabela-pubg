import { describe, expect, it } from "vitest";
import { createRedisConnection } from "./index.js";

describe("redis adapter", () => {
  it("creates a lazy connection without network access", () => {
    const connection = createRedisConnection("redis://127.0.0.1:6379");
    expect(connection.status).toBe("wait");
    connection.disconnect();
  });
});
