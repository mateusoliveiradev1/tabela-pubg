import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission } from "@pubg-camp/authorization";
import type { FastifyRequest } from "fastify";
import { AuthorizationService } from "./authorization.service.js";
import {
  ALLOW_PROVISIONAL_KEY,
  type ApiPermission,
  PUBLIC_ROUTE_KEY,
  REQUIRED_PERMISSION_KEY,
} from "./decorators.js";

export type AuthorizationDenialReason =
  | "missing-route-context"
  | "invalid-route-context"
  | "missing-internal-context"
  | "invalid-internal-context"
  | "organization-context-mismatch"
  | "scope-context-mismatch"
  | "permission-denied";

export interface AuthorizationDenialRecord {
  category: "authorization-denied";
  reason: AuthorizationDenialReason;
  correlationId: string;
  actorId: string;
  sessionId: string;
  routeOrganizationId?: string;
  routeAuthorizationScopeId?: string;
  permission: ApiPermission;
}

export interface AuthorizationDenialRecorder {
  record(event: AuthorizationDenialRecord): void;
}

export const AUTHORIZATION_DENIAL_RECORDER = Symbol("AUTHORIZATION_DENIAL_RECORDER");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
    @Inject(AUTHORIZATION_DENIAL_RECORDER)
    private readonly denialRecorder: AuthorizationDenialRecorder,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ROUTE_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true
    ) {
      return true;
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.auth) throw new ForbiddenException();

    const permission = this.reflector.getAllAndOverride<ApiPermission>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) {
      this.denyUntrusted(request);
      throw new ForbiddenException();
    }

    if (request.auth.trust !== "trusted") {
      const allowProvisional =
        request.auth.trust === "provisional" &&
        permission === "authenticated" &&
        this.reflector.get<boolean>(ALLOW_PROVISIONAL_KEY, context.getHandler()) === true;
      if (!allowProvisional) {
        this.denyUntrusted(request);
        throw new ForbiddenException();
      }
    }

    const rawRouteOrganizationId = routeParam(request, "organizationId");
    const rawRouteAuthorizationScopeId = routeParam(request, "authorizationScopeId");
    const organizationId = canonicalUuid(rawRouteOrganizationId);
    const authorizationScopeId = canonicalUuid(rawRouteAuthorizationScopeId);

    if (!rawRouteOrganizationId) {
      if (permission === "identity:session-alerts:resolve" || permission === "authenticated") {
        return true;
      }
      return this.deny(
        request,
        permission,
        "missing-route-context",
        organizationId,
        authorizationScopeId,
      );
    }
    if (!organizationId || (rawRouteAuthorizationScopeId && !authorizationScopeId)) {
      return this.deny(
        request,
        permission,
        "invalid-route-context",
        organizationId,
        authorizationScopeId,
      );
    }

    const rawInternalOrganizationId = firstHeader(request.headers["x-organization-id"]);
    const internalOrganizationId = canonicalUuid(rawInternalOrganizationId);
    if (!rawInternalOrganizationId) {
      return this.deny(
        request,
        permission,
        "missing-internal-context",
        organizationId,
        authorizationScopeId,
      );
    }
    if (!internalOrganizationId) {
      return this.deny(
        request,
        permission,
        "invalid-internal-context",
        organizationId,
        authorizationScopeId,
      );
    }
    if (internalOrganizationId !== organizationId) {
      return this.deny(
        request,
        permission,
        "organization-context-mismatch",
        organizationId,
        authorizationScopeId,
      );
    }

    const requiresScope = permission.startsWith("tournament:");
    if (requiresScope && !rawRouteAuthorizationScopeId) {
      return this.deny(
        request,
        permission,
        "missing-route-context",
        organizationId,
        authorizationScopeId,
      );
    }
    if (rawRouteAuthorizationScopeId || requiresScope) {
      const internalScopeId = canonicalUuid(
        firstHeader(request.headers["x-authorization-scope-id"]),
      );
      if (!internalScopeId) {
        return this.deny(
          request,
          permission,
          "missing-internal-context",
          organizationId,
          authorizationScopeId,
        );
      }
      if (internalScopeId !== authorizationScopeId) {
        return this.deny(
          request,
          permission,
          "scope-context-mismatch",
          organizationId,
          authorizationScopeId,
        );
      }
    }

    if (permission === "identity:session-alerts:resolve" || permission === "authenticated") {
      return true;
    }

    const allowed = await this.authorization.can({
      actorId: request.auth.actorId,
      organizationId,
      ...(authorizationScopeId === undefined ? {} : { authorizationScopeId }),
      permission: permission as Permission,
    });
    if (!allowed) {
      return this.deny(
        request,
        permission,
        "permission-denied",
        organizationId,
        authorizationScopeId,
      );
    }
    return true;
  }

  private deny(
    request: FastifyRequest,
    permission: ApiPermission,
    reason: AuthorizationDenialReason,
    routeOrganizationId?: string,
    routeAuthorizationScopeId?: string,
  ): never {
    try {
      this.denialRecorder.record({
        category: "authorization-denied",
        reason,
        correlationId: correlationId(request.headers["x-correlation-id"]),
        actorId: request.auth?.actorId ?? "unavailable",
        sessionId: request.auth?.sessionId ?? "unavailable",
        ...(routeOrganizationId ? { routeOrganizationId } : {}),
        ...(routeAuthorizationScopeId ? { routeAuthorizationScopeId } : {}),
        permission,
      });
    } catch {
      // Security telemetry is best-effort; authorization remains fail-closed.
    }
    throw new ForbiddenException();
  }

  private denyUntrusted(request: FastifyRequest): void {
    if (request.auth?.trust !== "provisional") return;
    try {
      this.authorization.recordProvisionalDenied({
        correlationId: correlationId(request.headers["x-correlation-id"]),
        actorId: request.auth.actorId,
        sessionId: request.auth.sessionId,
      });
    } catch {
      // Logging must never turn a fail-closed authorization denial into a server error.
    }
  }
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function routeParam(request: FastifyRequest, name: string): string | undefined {
  if (!request.params || typeof request.params !== "object") return undefined;
  const value = (request.params as Record<string, unknown>)[name];
  return typeof value === "string" ? value : undefined;
}

function canonicalUuid(value: string | undefined): string | undefined {
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : undefined;
}

function correlationId(value: string | string[] | undefined): string {
  const candidate = firstHeader(value);
  return UUID_PATTERN.test(candidate ?? "") ? (candidate as string) : "unavailable";
}
