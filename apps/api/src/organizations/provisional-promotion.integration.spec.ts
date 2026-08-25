import { createHash, createHmac, randomBytes, randomInt, randomUUID } from "node:crypto";
import { type ExecutionContext, ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  createDatabase,
  type DatabaseConnection,
  issueIdentitySession,
  replaceAuthChallengeDigest,
  resolveSession,
} from "@pubg-camp/database";
import { users } from "@pubg-camp/database/schema";
import type { FastifyReply, FastifyRequest } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type AuthenticatedSession,
  AuthorizationService,
} from "../authorization/authorization.service.js";
import { PermissionGuard } from "../authorization/permission.guard.js";
import { IdentityController } from "../identity/identity.controller.js";
import { createIdentityRuntime, type IdentityRuntime } from "../identity/identity.runtime.js";
import type { TokenGenerator } from "../identity/ports/token-generator.js";
import type { CsrfService } from "../security/csrf.service.js";
import { InvitationsController } from "./invitations.controller.js";
import { InvitationsService, PostgresInvitationRepository } from "./invitations.service.js";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService, PostgresOrganizationRepository } from "./organizations.service.js";

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
const now = new Date("2026-08-24T12:00:00.000Z");
const otpPepper = Buffer.from("phase2-02-36-isolated-otp-pepper-2026", "utf8");
const encryptionKey = { version: "v1", key: Buffer.alloc(32, 23) };

function tokens(): TokenGenerator {
  return {
    id: randomUUID,
    opaque: (bytes) => randomBytes(bytes).toString("base64url"),
    numericCode: (digits) =>
      Array.from({ length: digits }, () => randomInt(0, 10).toString()).join(""),
    digest: (value) => createHash("sha256").update(value, "utf8").digest("hex"),
  };
}

function codeDigest(purpose: string, email: string, code: string): string {
  return createHmac("sha256", otpPepper)
    .update(`${purpose}\0${email.trim().toLowerCase()}\0${code}`, "utf8")
    .digest("hex");
}

describe.runIf(Boolean(databaseUrl && redisUrl))(
  "provisional OTP promotion through real PostgreSQL and Redis",
  () => {
    let database: DatabaseConnection;
    let runtime: IdentityRuntime;
    const rotatedTokens: string[] = [];
    const csrf = {
      browserBindingFor: () => "server-owned-device-binding",
      rotateToSession: (
        _request: FastifyRequest,
        _reply: FastifyReply,
        _sessionId: string,
        sessionToken: string,
      ) => {
        rotatedTokens.push(sessionToken);
        return { csrfToken: "rotated" };
      },
      rotateCurrent: () => ({ csrfToken: "rotated" }),
    } as unknown as CsrfService;

    beforeAll(async () => {
      if (!databaseUrl || !redisUrl) throw new Error("real PostgreSQL and Redis are required");
      database = createDatabase(databaseUrl);
      await database.ping();
      runtime = await createIdentityRuntime({
        database: database.db,
        redisUrl,
        discord: {
          clientId: "123456789012345678",
          clientSecret: "integration-secret-not-used-02-36-0001",
          redirectUri: "https://app.example.test/identity/callback",
          pkceMode: "required",
        },
        csrf,
        tokens: tokens(),
        otpPepper,
        encryptionKey,
        policies: {
          session: {
            idleMs: 30 * 24 * 60 * 60_000,
            absoluteMs: 90 * 24 * 60 * 60_000,
            activityWriteIntervalMs: 5 * 60_000,
          },
          otp: { lifetimeMs: 10 * 60_000, maxAttempts: 5, cooldownSeconds: 60 },
        },
        clock: { now: () => now },
      });
    }, 30_000);

    afterAll(async () => {
      if (runtime) await runtime.close();
      if (database) await database.close();
      rotatedTokens.length = 0;
    }, 30_000);

    function identityController(): IdentityController {
      return new IdentityController(
        runtime.services.oauth,
        runtime.services.otp,
        runtime.services.identity,
        runtime.services.session,
        csrf,
      );
    }

    async function seedUser(displayName: string): Promise<string> {
      const actorId = randomUUID();
      await database.db.insert(users).values({
        id: actorId,
        displayName,
        createdAt: now,
        updatedAt: now,
      });
      return actorId;
    }

    async function seedSession(input: {
      actorId: string;
      trust: "provisional" | "trusted";
      token: string;
    }): Promise<string> {
      const sessionId = randomUUID();
      await issueIdentitySession(database.db, {
        id: sessionId,
        userId: input.actorId,
        token: input.token,
        trust: input.trust,
        issuedAt: now,
        absoluteExpiresAt: new Date(now.getTime() + 15 * 60_000),
        deviceId: randomUUID(),
      });
      return sessionId;
    }

    async function seedChallenge(input: {
      email: string;
      purpose: "sign-in" | "verify-provisional-email";
      code: string;
      actorId?: string;
      sessionId?: string;
    }): Promise<string> {
      const challengeId = randomUUID();
      await replaceAuthChallengeDigest(database.db, {
        id: challengeId,
        emailDigest: createHash("sha256")
          .update(input.email.trim().toLowerCase(), "utf8")
          .digest("hex"),
        purpose: input.purpose,
        codeDigest: codeDigest(input.purpose, input.email, input.code),
        attemptsRemaining: 5,
        expiresAt: new Date(now.getTime() + 10 * 60_000),
        now,
        ...(input.actorId ? { actorId: input.actorId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
      return challengeId;
    }

    function request(auth?: AuthenticatedSession, cookie?: string): FastifyRequest {
      return {
        ...(auth ? { auth } : {}),
        cookies: {
          "__Host-preauth": "preauth-browser-context",
          ...(cookie ? { "__Host-session": cookie } : {}),
        },
        headers: { "user-agent": "Mozilla/5.0 Chrome/140 Windows NT 10.0" },
        params: {},
      } as unknown as FastifyRequest;
    }

    function executionContext(
      controller: object,
      handler: (...args: never[]) => unknown,
      authenticatedRequest: FastifyRequest,
    ): ExecutionContext {
      return {
        getClass: () => controller.constructor as never,
        getHandler: () => handler,
        switchToHttp: () => ({
          getRequest: () => authenticatedRequest,
          getResponse: () => ({}),
          getNext: () => undefined,
        }),
      } as unknown as ExecutionContext;
    }

    function permissionGuard(): PermissionGuard {
      return new PermissionGuard(
        new Reflector(),
        new AuthorizationService(
          async () => null,
          async ({ actorId, organizationId }) => ({
            actorId: actorId as never,
            organizationId: organizationId as never,
            membershipStatus: "revoked",
            organizationRole: null,
            assignments: [],
          }),
          { record: () => undefined },
        ),
        { record: () => undefined },
      );
    }

    function organizationsService(): OrganizationsService {
      return new OrganizationsService(
        new PostgresOrganizationRepository(database.db),
        tokens(),
        { now: () => now },
        {
          store: async () => {
            throw new Error("logo storage is outside this scenario");
          },
          deleteObject: async () => undefined,
          createDownloadUrl: async () => "https://app.example.test/logo",
        },
        {
          fallbackUrl: "https://app.example.test/images/organization-fallback.svg",
          signedUrlTtlSeconds: 300,
        },
      );
    }

    it("persists sign-in session/new-device event before publishing its opaque cookie", async () => {
      const email = `signin-${randomUUID()}@example.com`;
      const code = "19374628";
      const challengeId = await seedChallenge({ email, purpose: "sign-in", code });
      const controller = identityController();
      const deliveriesBefore = await database.db.query.notificationDeliveries.findMany({
        where: (delivery, operators) => operators.eq(delivery.template, "new-device"),
      });
      const response = await controller.verifyEmailSignInOtp(
        { challengeId, email, code },
        "127.0.0.1",
        randomUUID(),
        request(),
        {} as FastifyReply,
      );
      expect(response).toEqual({ status: "authenticated", nextPath: "/" });
      const sessionToken = rotatedTokens.at(-1);
      expect(sessionToken).toBeTruthy();
      const resolved = await resolveSession(database.db, sessionToken as string, () => now);
      expect(resolved?.trust).toBe("trusted");
      const deliveries = await database.db.query.notificationDeliveries.findMany({
        where: (delivery, operators) => operators.eq(delivery.template, "new-device"),
      });
      expect(deliveries).toHaveLength(deliveriesBefore.length + 1);
      const priorIds = new Set(deliveriesBefore.map((delivery) => delivery.id));
      expect(deliveries.find((delivery) => !priorIds.has(delivery.id))?.status).toBe("pending");
      expect(JSON.stringify(deliveries)).not.toContain(sessionToken);
    }, 30_000);

    it("denies provisional create/accept and unlocks only the committed replacement token", async () => {
      const provisionalActorId = await seedUser("Provisional player");
      const oldToken = `provisional-${randomUUID()}`;
      const otherToken = `other-${randomUUID()}`;
      const provisionalSessionId = await seedSession({
        actorId: provisionalActorId,
        trust: "provisional",
        token: oldToken,
      });
      await seedSession({ actorId: provisionalActorId, trust: "provisional", token: otherToken });
      const provisionalAuth: AuthenticatedSession = {
        actorId: provisionalActorId,
        sessionId: provisionalSessionId,
        trust: "provisional",
      };
      const provisionalRequest = request(provisionalAuth, oldToken);
      const organizationController = new OrganizationsController(organizationsService());
      const invitationControllerPlaceholder = new InvitationsController({} as InvitationsService);
      const guard = permissionGuard();

      await expect(
        guard.canActivate(
          executionContext(
            organizationController,
            OrganizationsController.prototype.create,
            provisionalRequest,
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        guard.canActivate(
          executionContext(
            invitationControllerPlaceholder,
            InvitationsController.prototype.accept,
            provisionalRequest,
          ),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const confirmedEmail = `confirmed-${randomUUID()}@example.com`;
      const code = "82736491";
      const challengeId = await seedChallenge({
        email: confirmedEmail,
        purpose: "verify-provisional-email",
        code,
        actorId: provisionalActorId,
        sessionId: provisionalSessionId,
      });
      const response = await identityController().verifyProvisionalEmailOtp(
        { challengeId, email: confirmedEmail, code },
        "127.0.0.1",
        randomUUID(),
        provisionalRequest as never,
        {} as FastifyReply,
      );
      expect(response).toEqual({ status: "authenticated", nextPath: "/" });
      const replacementToken = rotatedTokens.at(-1) as string;
      const resolvedReplacement = await resolveSession(database.db, replacementToken, () => now);
      expect(resolvedReplacement).toMatchObject({
        trust: "trusted",
        session: { id: provisionalSessionId, userId: provisionalActorId },
      });
      expect(await resolveSession(database.db, oldToken, () => now)).toBeNull();
      expect(await resolveSession(database.db, otherToken, () => now)).toBeNull();

      const trustedRequest = request(
        {
          actorId: provisionalActorId,
          sessionId: provisionalSessionId,
          trust: "trusted",
        },
        replacementToken,
      );
      expect(
        await guard.canActivate(
          executionContext(
            organizationController,
            OrganizationsController.prototype.create,
            trustedRequest,
          ),
        ),
      ).toBe(true);
      const created = await organizationController.create(
        { name: "Promoted Player Organization" },
        trustedRequest as never,
        undefined,
        randomUUID(),
      );
      expect(created.organization.membershipRole).toBe("owner");

      const ownerActorId = await seedUser("Invitation owner");
      const ownerOrganization = await organizationsService().create({
        actorId: ownerActorId,
        body: { name: "Invitation Organization" },
        correlationId: randomUUID(),
      });
      const issuedInvitationTokens = [`exact-${randomUUID()}`, `wrong-${randomUUID()}`];
      let opaqueIndex = 0;
      const invitationTokens: TokenGenerator = {
        ...tokens(),
        opaque: () => issuedInvitationTokens[opaqueIndex++] as string,
      };
      const invitations = new InvitationsService(
        new PostgresInvitationRepository(database.db, encryptionKey, randomUUID),
        invitationTokens,
        { now: () => now },
      );
      await invitations.create({
        actorId: ownerActorId,
        organizationId: ownerOrganization.organization.id,
        body: { email: confirmedEmail, organizationRole: "member", assignments: [] },
        correlationId: randomUUID(),
      });
      await invitations.create({
        actorId: ownerActorId,
        organizationId: ownerOrganization.organization.id,
        body: {
          email: `wrong-${randomUUID()}@example.com`,
          organizationRole: "member",
          assignments: [],
        },
        correlationId: randomUUID(),
      });
      const invitationController = new InvitationsController(invitations);
      expect(
        await guard.canActivate(
          executionContext(
            invitationController,
            InvitationsController.prototype.accept,
            trustedRequest,
          ),
        ),
      ).toBe(true);
      const accepted = await invitationController.accept(
        { confirmation: true },
        issuedInvitationTokens[0],
        trustedRequest as never,
        randomUUID(),
      );
      expect(accepted.status).toBe("accepted");
      await expect(
        invitationController.accept(
          { confirmation: true },
          issuedInvitationTokens[1],
          trustedRequest as never,
          randomUUID(),
        ),
      ).rejects.toThrow("invitation action unavailable");
    }, 30_000);
  },
);
