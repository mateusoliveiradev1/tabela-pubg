import { Body, Controller, Get, Headers, Inject, Post, Req } from "@nestjs/common";
import type { CreateOrganizationResponse, OrganizationListResponse } from "@pubg-camp/contracts";
import { RequirePermission } from "../authorization/decorators.js";
import type { SessionAlertRequest } from "../identity/identity.controller.js";
import type { OrganizationsService } from "./organizations.service.js";

export const ORGANIZATIONS_SERVICE = Symbol("ORGANIZATIONS_SERVICE");

@Controller("platform/organizations")
export class OrganizationsController {
  constructor(
    @Inject(ORGANIZATIONS_SERVICE)
    private readonly organizations: OrganizationsService,
  ) {}

  @Post()
  @RequirePermission("authenticated")
  create(
    @Body() body: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ): Promise<CreateOrganizationResponse> {
    return this.organizations.create({
      actorId: request.auth.actorId,
      body: body as never,
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Get()
  @RequirePermission("authenticated")
  list(@Req() request: SessionAlertRequest): Promise<OrganizationListResponse> {
    return this.organizations.list(request.auth.actorId);
  }
}

export function safeCorrelationId(value: string | undefined): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value ?? "",
  )
    ? (value as string)
    : "00000000-0000-4000-8000-000000000000";
}
