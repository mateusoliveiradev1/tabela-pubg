import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { FastifyRequest } from "fastify";
import { type AuthenticatedSession, AuthorizationService } from "./authorization.service.js";
import { PUBLIC_ROUTE_KEY } from "./decorators.js";

export const SESSION_COOKIE_NAME = Symbol("SESSION_COOKIE_NAME");

declare module "fastify" {
  interface FastifyRequest {
    auth?: AuthenticatedSession;
  }
}

@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    @Inject(Reflector)
    private readonly reflector: Reflector,
    @Inject(AuthorizationService)
    private readonly authorization: AuthorizationService,
    @Inject(SESSION_COOKIE_NAME)
    private readonly sessionCookieName: string,
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
    const cookies = (request as FastifyRequest & { cookies?: Record<string, string> }).cookies;
    const token =
      cookies?.[this.sessionCookieName] ??
      parseCookie(request.headers.cookie)[this.sessionCookieName];
    if (!token) throw new UnauthorizedException();
    const authenticated = await this.authorization.authenticate(token);
    if (!authenticated) throw new UnauthorizedException();
    request.auth = authenticated;
    return true;
  }
}

function parseCookie(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").flatMap((part) => {
      const separator = part.indexOf("=");
      if (separator < 1) return [];
      return [[part.slice(0, separator).trim(), part.slice(separator + 1).trim()]];
    }),
  );
}
