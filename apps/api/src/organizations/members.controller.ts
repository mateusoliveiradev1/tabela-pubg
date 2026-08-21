import { Body, Controller, Get, Headers, Inject, Param, Patch, Post, Req } from "@nestjs/common";
import {
  RevokeMembershipRequestSchema,
  TransferOwnershipRequestSchema,
  UpdateMembershipRequestSchema,
} from "@pubg-camp/contracts";
import { z } from "zod";
import { RequirePermission } from "../authorization/decorators.js";
import type { SessionAlertRequest } from "../identity/identity.controller.js";
import type { MembersService } from "./members.service.js";
import { safeCorrelationId } from "./organizations.controller.js";

export const MEMBERS_SERVICE = Symbol("MEMBERS_SERVICE");
const IdSchema = z.uuid();

@Controller("platform/organizations/:organizationId")
export class MembersController {
  constructor(
    @Inject(MEMBERS_SERVICE)
    private readonly members: MembersService,
  ) {}

  @Get("members")
  @RequirePermission("authenticated")
  list(@Param("organizationId") organizationId: string, @Req() request: SessionAlertRequest) {
    return this.members.list(request.auth.actorId, IdSchema.parse(organizationId));
  }

  @Patch("members/:membershipId")
  @RequirePermission("organization:roles:manage")
  update(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    return this.members.update({
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      organizationId: IdSchema.parse(organizationId),
      membershipId: IdSchema.parse(membershipId),
      body: UpdateMembershipRequestSchema.parse(rawBody),
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Post("members/:membershipId/revoke")
  @RequirePermission("organization:members:manage")
  revoke(
    @Param("organizationId") organizationId: string,
    @Param("membershipId") membershipId: string,
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    const body = RevokeMembershipRequestSchema.parse(rawBody);
    return this.members.revoke({
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      organizationId: IdSchema.parse(organizationId),
      membershipId: IdSchema.parse(membershipId),
      reason: body.reason,
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Post("ownership/transfer")
  @RequirePermission("organization:ownership:transfer")
  transferOwnership(
    @Param("organizationId") organizationId: string,
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    return this.members.transferOwnership({
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      organizationId: IdSchema.parse(organizationId),
      body: TransferOwnershipRequestSchema.parse(rawBody),
      correlationId: safeCorrelationId(correlationId),
    });
  }
}
