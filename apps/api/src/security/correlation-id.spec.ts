import Fastify from "fastify";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerCorrelationIdHook } from "./correlation-id.js";

const GENERATED_ID = "018f1f3d-7b8c-4fb0-9d5a-7a77d7f4f4a1";

describe("trusted API correlation boundary", () => {
  const apps: ReturnType<typeof Fastify>[] = [];

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each([
    ["missing", undefined],
    ["invalid", "browser-controlled-value"],
  ])("replaces a %s browser correlation value with a generated UUID", async (_name, value) => {
    const generate = vi.fn(() => GENERATED_ID);
    const app = Fastify();
    apps.push(app);
    registerCorrelationIdHook(app, generate);
    app.get("/probe", async (request) => ({ correlationId: request.headers["x-correlation-id"] }));

    const response = await app.inject({
      method: "GET",
      url: "/probe",
      ...(value === undefined ? {} : { headers: { "x-correlation-id": value } }),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ correlationId: GENERATED_ID });
    expect(response.headers["x-correlation-id"]).toBe(GENERATED_ID);
    expect(generate).toHaveBeenCalledOnce();
  });

  it("normalizes a valid UUID and propagates it without generating a replacement", async () => {
    const generate = vi.fn(() => GENERATED_ID);
    const app = Fastify();
    apps.push(app);
    registerCorrelationIdHook(app, generate);
    app.get("/probe", async (request) => ({ correlationId: request.headers["x-correlation-id"] }));

    const response = await app.inject({
      method: "GET",
      url: "/probe",
      headers: { "x-correlation-id": "A8E7D957-32CC-4B51-9A90-4D72AD0C51F2" },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ correlationId: "a8e7d957-32cc-4b51-9a90-4d72ad0c51f2" });
    expect(response.headers["x-correlation-id"]).toBe("a8e7d957-32cc-4b51-9a90-4d72ad0c51f2");
    expect(generate).not.toHaveBeenCalled();
  });
});
