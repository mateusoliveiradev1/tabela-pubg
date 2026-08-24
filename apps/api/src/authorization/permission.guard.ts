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

@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
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

    if (permission === "identity:session-alerts:resolve" || permission === "authenticated") {
      return true;
    }

    const organizationId = firstHeader(request.headers["x-organization-id"]);
    const authorizationScopeId = firstHeader(request.headers["x-authorization-scope-id"]);
    if (!organizationId) throw new ForbiddenException();
    if (permission.startsWith("tournament:") && !authorizationScopeId) {
      throw new ForbiddenException();
    }

    const allowed = await this.authorization.can({
      actorId: request.auth.actorId,
      organizationId,
      ...(authorizationScopeId === undefined ? {} : { authorizationScopeId }),
      permission: permission as Permission,
    });
    if (!allowed) throw new ForbiddenException();
    return true;
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

function correlationId(value: string | string[] | undefined): string {
  const candidate = firstHeader(value);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    candidate ?? "",
  )
    ? (candidate as string)
    : "unavailable";
}
