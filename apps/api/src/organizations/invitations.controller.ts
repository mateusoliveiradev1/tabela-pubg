import { Body, Controller, Get, Headers, Inject, Param, Post, Req } from "@nestjs/common";
import {
  AcceptInvitationRequestSchema,
  type AcceptInvitationResponse,
  InvitationActionRequestSchema,
  type InvitationActionResponse,
  InvitationContextRequestSchema,
  type InvitationListItem,
  type InvitationPreviewResponse,
} from "@pubg-camp/contracts";
import { z } from "zod";
import { RequirePermission } from "../authorization/decorators.js";
import type { SessionAlertRequest } from "../identity/identity.controller.js";
import type { InvitationsService } from "./invitations.service.js";
import { safeCorrelationId } from "./organizations.controller.js";

export const INVITATIONS_SERVICE = Symbol("INVITATIONS_SERVICE");
const IdSchema = z.uuid();

@Controller("platform")
export class InvitationsController {
  constructor(
    @Inject(INVITATIONS_SERVICE)
    private readonly invitations: InvitationsService,
  ) {}

  @Post("organizations/:organizationId/invitations")
  @RequirePermission("organization:members:manage")
  create(
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ) {
    return this.invitations.create({
      actorId: request.auth.actorId,
      organizationId: IdSchema.parse(organizationId),
      body: body as never,
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Get("organizations/:organizationId/invitations")
  @RequirePermission("organization:members:manage")
  list(
    @Param("organizationId") organizationId: string,
    @Req() request: SessionAlertRequest,
  ): Promise<{ invitations: InvitationListItem[] }> {
    return this.invitations.list(request.auth.actorId, IdSchema.parse(organizationId));
  }

  @Post("organizations/:organizationId/invitations/:invitationId/revoke")
  @RequirePermission("organization:members:manage")
  revoke(
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ): Promise<InvitationActionResponse> {
    const body = InvitationActionRequestSchema.parse(rawBody);
    return this.invitations.revoke({
      actorId: request.auth.actorId,
      organizationId: IdSchema.parse(organizationId),
      invitationId: IdSchema.parse(invitationId),
      reason: body.reason,
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Post("organizations/:organizationId/invitations/:invitationId/resend")
  @RequirePermission("organization:members:manage")
  resend(
    @Param("organizationId") organizationId: string,
    @Param("invitationId") invitationId: string,
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ): Promise<InvitationActionResponse> {
    const body = InvitationActionRequestSchema.parse(rawBody);
    return this.invitations.resend({
      actorId: request.auth.actorId,
      organizationId: IdSchema.parse(organizationId),
      invitationId: IdSchema.parse(invitationId),
      reason: body.reason,
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Post("invitations/preview")
  @RequirePermission("authenticated")
  preview(
    @Body() rawBody: unknown,
    @Req() request: SessionAlertRequest,
  ): Promise<InvitationPreviewResponse> {
    const body = InvitationContextRequestSchema.parse(rawBody);
    return this.invitations.preview(request.auth.actorId, body.context);
  }

  @Post("invitations/accept")
  @RequirePermission("authenticated")
  accept(
    @Body() rawBody: unknown,
    @Headers("x-invitation-context") context: string | undefined,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ): Promise<AcceptInvitationResponse> {
    const body = AcceptInvitationRequestSchema.parse(rawBody);
    const token = InvitationContextRequestSchema.shape.context.parse(context);
    return this.invitations.accept({
      actorId: request.auth.actorId,
      token,
      confirmation: body.confirmation,
      correlationId: safeCorrelationId(correlationId),
    });
  }
}
