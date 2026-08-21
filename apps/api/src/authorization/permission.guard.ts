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
import { type ApiPermission, PUBLIC_ROUTE_KEY, REQUIRED_PERMISSION_KEY } from "./decorators.js";

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

    const permission = this.reflector.getAllAndOverride<ApiPermission>(REQUIRED_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) throw new ForbiddenException();

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.auth) throw new ForbiddenException();
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
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
