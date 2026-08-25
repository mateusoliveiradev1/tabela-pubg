import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { describe, expect, it, vi } from "vitest";
import { AuditController } from "../audit/audit.controller.js";
import { MembersController } from "../organizations/members.controller.js";
import { OrganizationsController } from "../organizations/organizations.controller.js";
import { type ApiPermission, REQUIRED_PERMISSION_KEY } from "./decorators.js";
import { PermissionGuard } from "./permission.guard.js";

const ACTOR_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2301";
const SESSION_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2304";
const ORGANIZATION_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2302";
const CORRELATION_ID = "55555555-5555-4555-8555-555555555555";

interface TenantReadRoute {
  name: string;
  controller: abstract new (...args: never[]) => unknown;
  handler: (...args: never[]) => unknown;
  permission: ApiPermission;
}

const tenantReadRoutes: readonly TenantReadRoute[] = [
  {
    name: "members",
    controller: MembersController,
    handler: MembersController.prototype.list,
    permission: "organization:read" as ApiPermission,
  },
  {
    name: "logo",
    controller: OrganizationsController,
    handler: OrganizationsController.prototype.getLogo,
    permission: "organization:read" as ApiPermission,
  },
  {
    name: "audit",
    controller: AuditController,
    handler: AuditController.prototype.query,
    permission: "organization:audit:self:read",
  },
];

function pipeline(route: TenantReadRoute, allowed: boolean) {
  const authorization = {
    can: vi.fn(async () => allowed),
    recordProvisionalDenied: vi.fn(),
  };
  const recorder = { record: vi.fn() };
  const repository = vi.fn(async () => ({ status: "ok" }));
  const handler = vi.fn(async () => repository());
  const request = {
    auth: { actorId: ACTOR_ID, sessionId: SESSION_ID, trust: "trusted" },
    params: { organizationId: ORGANIZATION_ID },
    headers: {
      authorization: "Bearer must-not-be-recorded",
      cookie: "session=must-not-be-recorded",
      "x-correlation-id": CORRELATION_ID,
      "x-organization-id": ORGANIZATION_ID,
    },
  };
  const context = {
    getHandler: () => route.handler,
    getClass: () => route.controller,
    switchToHttp: () => ({ getRequest: () => request }),
  };
  const guard = new PermissionGuard(new Reflector(), authorization as never, recorder as never);

  return {
    authorization,
    context,
    guard,
    handler,
    permission: new Reflector().get<ApiPermission>(REQUIRED_PERMISSION_KEY, route.handler),
    recorder,
    repository,
  };
}

describe("tenant-scoped read authorization", () => {
  it.each(tenantReadRoutes)(
    "denies a non-member before the $name handler and repository and records one redacted event",
    async (route) => {
      const test = pipeline(route, false);

      expect(test.permission).toBe(route.permission);
      const denied = await test.guard.canActivate(test.context as never).catch((error) => error);
      expect(denied).toBeInstanceOf(ForbiddenException);
      expect((denied as ForbiddenException).getStatus()).toBe(403);
      expect(test.authorization.can).toHaveBeenCalledOnce();
      expect(test.authorization.can).toHaveBeenCalledWith({
        actorId: ACTOR_ID,
        organizationId: ORGANIZATION_ID,
        permission: route.permission,
      });
      expect(test.handler).not.toHaveBeenCalled();
      expect(test.repository).not.toHaveBeenCalled();
      expect(test.recorder.record).toHaveBeenCalledOnce();
      expect(test.recorder.record).toHaveBeenCalledWith({
        category: "authorization-denied",
        reason: "permission-denied",
        correlationId: CORRELATION_ID,
        actorId: ACTOR_ID,
        sessionId: SESSION_ID,
        routeOrganizationId: ORGANIZATION_ID,
        permission: route.permission,
      });
      expect(JSON.stringify(test.recorder.record.mock.calls)).not.toMatch(
        /Bearer|session=|role|must-not-be-recorded/,
      );
    },
  );

  it.each(tenantReadRoutes)(
    "allows a live member through the $name handler and repository without denial telemetry",
    async (route) => {
      const test = pipeline(route, true);

      expect(test.permission).toBe(route.permission);
      await expect(test.guard.canActivate(test.context as never)).resolves.toBe(true);
      await test.handler();

      expect(test.authorization.can).toHaveBeenCalledOnce();
      expect(test.handler).toHaveBeenCalledOnce();
      expect(test.repository).toHaveBeenCalledOnce();
      expect(test.recorder.record).not.toHaveBeenCalled();
    },
  );
});
