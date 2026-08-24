import { ForbiddenException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import {
  type AuthorizationDenialRecorder,
  PermissionGuard,
} from "./permission.guard.js";

const ACTOR_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2301";
const SESSION_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2304";
const ORGANIZATION_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2302";
const OTHER_ORGANIZATION_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2399";
const SCOPE_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2303";
const OTHER_SCOPE_ID = "018f0ce7-98e3-7b27-bf2d-6eeac51d2398";
const CORRELATION_ID = "55555555-5555-4555-8555-555555555555";

function harness(options: {
  permission?: "organization:members:manage" | "tournament:broadcast:manage";
  params?: Record<string, string>;
  headers?: Record<string, string>;
  allowed?: boolean;
  recorder?: AuthorizationDenialRecorder;
}) {
  const permission = options.permission ?? "organization:members:manage";
  const authorization = {
    can: vi.fn(async () => options.allowed ?? true),
    recordProvisionalDenied: vi.fn(),
  };
  const recorder = options.recorder ?? { record: vi.fn() };
  const request = {
    auth: { actorId: ACTOR_ID, sessionId: SESSION_ID, trust: "trusted" },
    params: options.params ?? { organizationId: ORGANIZATION_ID },
    headers: {
      "x-correlation-id": CORRELATION_ID,
      "x-organization-id": ORGANIZATION_ID,
      ...options.headers,
    },
  };
  const reflector = {
    getAllAndOverride: vi.fn((_key: string | symbol, targets: unknown[]) =>
      targets.length === 2 && targets[0] === "handler" ? permission : false,
    ),
    get: vi.fn(() => false),
  };
  const context = {
    getHandler: () => "handler",
    getClass: () => "controller",
    switchToHttp: () => ({ getRequest: () => request }),
  };
  const guard = new PermissionGuard(
    reflector as never,
    authorization as never,
    recorder as never,
  );
  return { authorization, context, guard, recorder };
}

describe("PermissionGuard tenant context", () => {
  it("allows matching route and internal organization context through the live snapshot", async () => {
    const test = harness({});

    await expect(test.guard.canActivate(test.context as never)).resolves.toBe(true);
    expect(test.authorization.can).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      organizationId: ORGANIZATION_ID,
      permission: "organization:members:manage",
    });
    expect(test.recorder.record).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "missing internal organization",
      params: { organizationId: ORGANIZATION_ID },
      headers: { "x-organization-id": "" },
      reason: "missing-internal-context",
    },
    {
      name: "organization mismatch",
      params: { organizationId: ORGANIZATION_ID },
      headers: { "x-organization-id": OTHER_ORGANIZATION_ID },
      reason: "organization-context-mismatch",
    },
    {
      name: "scope mismatch",
      permission: "tournament:broadcast:manage" as const,
      params: { organizationId: ORGANIZATION_ID, authorizationScopeId: SCOPE_ID },
      headers: {
        "x-organization-id": ORGANIZATION_ID,
        "x-authorization-scope-id": OTHER_SCOPE_ID,
      },
      reason: "scope-context-mismatch",
    },
  ])("denies $name before RBAC and records one bounded event", async (testCase) => {
    const recorder = { record: vi.fn() };
    const test = harness({ ...testCase, recorder });

    await expect(test.guard.canActivate(test.context as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(test.authorization.can).not.toHaveBeenCalled();
    expect(recorder.record).toHaveBeenCalledOnce();
    expect(recorder.record).toHaveBeenCalledWith({
      category: "authorization-denied",
      reason: testCase.reason,
      correlationId: CORRELATION_ID,
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      routeOrganizationId: ORGANIZATION_ID,
      ...(testCase.params.authorizationScopeId
        ? { routeAuthorizationScopeId: testCase.params.authorizationScopeId }
        : {}),
      permission: testCase.permission ?? "organization:members:manage",
    });
  });

  it("records a stale live permission denial without disclosing roles or request data", async () => {
    const recorder = { record: vi.fn() };
    const test = harness({ allowed: false, recorder });

    await expect(test.guard.canActivate(test.context as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(recorder.record).toHaveBeenCalledOnce();
    expect(recorder.record).toHaveBeenCalledWith({
      category: "authorization-denied",
      reason: "permission-denied",
      correlationId: CORRELATION_ID,
      actorId: ACTOR_ID,
      sessionId: SESSION_ID,
      routeOrganizationId: ORGANIZATION_ID,
      permission: "organization:members:manage",
    });
    expect(JSON.stringify(recorder.record.mock.calls)).not.toContain("role");
  });

  it("fails closed when the recorder throws", async () => {
    const test = harness({
      headers: { "x-organization-id": OTHER_ORGANIZATION_ID },
      recorder: {
        record: vi.fn(() => {
          throw new Error("security sink unavailable");
        }),
      },
    });

    await expect(test.guard.canActivate(test.context as never)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(test.authorization.can).not.toHaveBeenCalled();
  });
});
