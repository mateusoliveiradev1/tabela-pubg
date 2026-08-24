import { Body, Controller, Get, Headers, Inject, Param, Post, Req, Res } from "@nestjs/common";
import {
  ConfirmIdentityLinkRequestSchema,
  ConfirmIdentityLinkResponseSchema,
  IdentityListResponseSchema,
  RemoveIdentityRequestSchema,
  RemoveIdentityResponseSchema,
} from "@pubg-camp/contracts";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import { RequirePermission } from "../authorization/decorators.js";
import type { CsrfService } from "../security/csrf.service.js";
import {
  IDENTITY_CSRF_SERVICE,
  IDENTITY_SERVICE,
  type SessionAlertRequest,
} from "./identity.controller.js";
import type { IdentityService } from "./identity.service.js";

const IdentityIdSchema = z.uuid();

@Controller("identity/identities")
export class IdentityManagementController {
  constructor(
    @Inject(IDENTITY_SERVICE)
    private readonly identity: IdentityService,
    @Inject(IDENTITY_CSRF_SERVICE)
    private readonly csrf: CsrfService,
  ) {}

  @Get()
  @RequirePermission("authenticated")
  async list(@Req() request: SessionAlertRequest) {
    const identities = await this.identity.listIdentities(request.auth.actorId);
    return IdentityListResponseSchema.parse({
      identities: identities.map((identity) => ({
        ...identity,
        linkedAt: identity.linkedAt.toISOString(),
      })),
    });
  }

  @Post("link/confirm")
  @RequirePermission("authenticated")
  async confirmLink(
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    const body = ConfirmIdentityLinkRequestSchema.parse(rawBody);
    const committed = await this.identity.confirmIdentityLink({
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      proofId: body.candidateIdentityId,
      correlationId: safeCorrelationId(correlationId),
    });
    this.csrf.rotateToSession(request, reply, committed.sessionId, committed.sessionToken);
    return ConfirmIdentityLinkResponseSchema.parse({
      status: "linked",
      provider: committed.provider,
      otherSessionsRevoked: committed.otherSessionsRevoked,
    });
  }

  @Post(":identityId/remove")
  @RequirePermission("authenticated")
  async remove(
    @Param("identityId") rawIdentityId: string,
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    const identityId = IdentityIdSchema.parse(rawIdentityId);
    const body = RemoveIdentityRequestSchema.parse(rawBody);
    if (body.identityId !== identityId) throw new Error("identity target mismatch");
    const committed = await this.identity.removeIdentity({
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      identityId,
      correlationId: safeCorrelationId(correlationId),
    });
    this.csrf.rotateToSession(request, reply, committed.sessionId, committed.sessionToken);
    return RemoveIdentityResponseSchema.parse({ status: "removed" });
  }
}

function safeCorrelationId(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 120 ? normalized : "unavailable";
}
