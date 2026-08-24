import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { describe, expect, it } from "vitest";
import { registerAppModule } from "./app.module.js";
import { IdentityController } from "./identity/identity.controller.js";
import { IdentityModule } from "./identity/identity.module.js";

describe("registerAppModule identity composition", () => {
  it("registers the Discord OAuth controllers in the composed Nest module", () => {
    const module = createModule();
    expect(module.imports).toContainEqual(
      expect.objectContaining({
        module: IdentityModule,
        controllers: expect.arrayContaining([IdentityController]),
      }),
    );
  });

  it("exposes Discord OAuth start and callback in the composed Fastify router", async () => {
    const module = createModule();
    const app = await NestFactory.create<NestFastifyApplication>(module, new FastifyAdapter(), {
      abortOnError: false,
      logger: false,
    });
    try {
      await app.init();
      const fastify = app.getHttpAdapter().getInstance();
      expect(fastify.hasRoute({ method: "POST", url: "/identity/oauth/discord/start" })).toBe(true);
      expect(fastify.hasRoute({ method: "POST", url: "/identity/oauth/discord/callback" })).toBe(
        true,
      );
    } finally {
      await app.close();
    }
  });
});

function createModule() {
  return registerAppModule({
    csrf: {} as never,
    authorization: {
      authenticate: async () => null,
      loadSnapshot: async () => ({
        actorId: "00000000-0000-4000-8000-000000000001" as never,
        organizationId: "00000000-0000-4000-8000-000000000002" as never,
        membershipStatus: "revoked",
        organizationRole: null,
        assignments: [],
      }),
      securityLog: { record: () => undefined },
    },
    organizations: {
      database: {} as never,
      encryptionKey: { version: "v1", key: new Uint8Array(32) },
      tokens: {} as never,
      sessions: {} as never,
      logoStorage: {} as never,
      logoFallbackUrl: "https://camp.test/fallback.svg",
    },
    audit: { database: {} as never },
    identity: {
      oauth: {} as never,
      otp: {} as never,
      session: {} as never,
      csrf: {} as never,
    },
  });
}
