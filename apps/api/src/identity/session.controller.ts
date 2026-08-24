import { Body, Controller, Get, Inject, Param, Post, Req, Res } from "@nestjs/common";
import {
  RevokeOtherSessionsResponseSchema,
  RevokeSessionRequestSchema,
  RevokeSessionResponseSchema,
  SessionListResponseSchema,
} from "@pubg-camp/contracts";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { RequirePermission } from "../authorization/decorators.js";
import type { CsrfService } from "../security/csrf.service.js";
import {
  IDENTITY_CSRF_SERVICE,
  IDENTITY_SESSION_SERVICE,
  type SessionAlertRequest,
} from "./identity.controller.js";
import type { SessionService } from "./session.service.js";

const EmptyBodySchema = z.object({}).strict();
const SessionIdSchema = z.uuid();

@Controller("identity/sessions")
export class SessionController {
  constructor(
    @Inject(IDENTITY_SESSION_SERVICE)
    private readonly sessions: SessionService,
    @Inject(IDENTITY_CSRF_SERVICE)
    private readonly csrf: CsrfService,
  ) {}

  @Get()
  @RequirePermission("authenticated")
  async list(@Req() request: SessionAlertRequest) {
    const sessions = await this.sessions.list(request.auth.actorId, request.auth.sessionId);
    return SessionListResponseSchema.parse({
      sessions: sessions.map((session) => ({
        ...session,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        idleExpiresAt: session.idleExpiresAt.toISOString(),
        absoluteExpiresAt: session.absoluteExpiresAt.toISOString(),
      })),
    });
  }

  @Post(":sessionId/revoke")
  @RequirePermission("authenticated")
  async revoke(
    @Param("sessionId") rawSessionId: string,
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const sessionId = SessionIdSchema.parse(rawSessionId);
    const body = RevokeSessionRequestSchema.parse(rawBody);
    if (body.sessionId !== sessionId) throw new Error("session target mismatch");
    await this.sessions.revoke(request.auth.actorId, sessionId);
    if (sessionId === request.auth.sessionId) this.csrf.invalidate(request, reply);
    return RevokeSessionResponseSchema.parse({ status: "revoked", revokedSessionId: sessionId });
  }

  @Post("revoke-others")
  @RequirePermission("authenticated")
  async revokeOthers(@Body() rawBody: unknown, @Req() request: SessionAlertRequest) {
    EmptyBodySchema.parse(rawBody);
    const revokedCount = await this.sessions.revokeOthers(
      request.auth.actorId,
      request.auth.sessionId,
    );
    return RevokeOtherSessionsResponseSchema.parse({ status: "revoked", revokedCount });
  }

  @Post("logout")
  @RequirePermission("authenticated")
  async logout(
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    EmptyBodySchema.parse(rawBody);
    await this.sessions.logout(request.auth.actorId, request.auth.sessionId);
    this.csrf.invalidate(request, reply);
    return RevokeSessionResponseSchema.parse({
      status: "revoked",
      revokedSessionId: request.auth.sessionId,
    });
  }
}
