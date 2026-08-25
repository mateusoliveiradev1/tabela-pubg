import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { z } from "zod";
import { RequirePermission } from "../authorization/decorators.js";
import type { SessionAlertRequest } from "../identity/identity.controller.js";
import type { AuditService } from "./audit.service.js";

export const AUDIT_SERVICE = Symbol("AUDIT_SERVICE");

@Controller("platform/organizations/:organizationId/audit")
export class AuditController {
  constructor(
    @Inject(AUDIT_SERVICE)
    private readonly audit: AuditService,
  ) {}

  @Get()
  @RequirePermission("organization:audit:self:read")
  query(
    @Param("organizationId") organizationId: string,
    @Query() query: Record<string, unknown>,
    @Req() request: SessionAlertRequest,
  ) {
    return this.audit.query(request.auth.actorId, {
      ...query,
      organizationId: z.uuid().parse(organizationId),
      visibility: query.visibility ?? "self",
    });
  }
}
