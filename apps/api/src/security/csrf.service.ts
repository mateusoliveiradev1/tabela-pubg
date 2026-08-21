import { createHash, randomBytes } from "node:crypto";
import type {} from "@fastify/cookie";
import type {} from "@fastify/csrf-protection";
import { type CanActivate, type ExecutionContext, Injectable } from "@nestjs/common";
import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from "fastify";

export interface CsrfServiceOptions {
  appOrigin: string;
  csrfSecret: string;
  cookieSigningKey: string;
  secureCookies: boolean;
  preauthCookieName?: string;
  sessionCookieName?: string;
  csrfSecretCookieName?: string;
}

interface CookieAwareRequest extends FastifyRequest {
  cookies: Record<string, string | undefined>;
  auth?: { actorId: string; sessionId: string };
}

interface SecureCookieOptions {
  path: string;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
}

type CookieReply = FastifyReply & {
  generateCsrf(options?: { userInfo?: string }): string;
  setCookie(name: string, value: string, options: SecureCookieOptions): FastifyReply;
  clearCookie(name: string, options: SecureCookieOptions): FastifyReply;
};

type CsrfFastifyInstance = FastifyInstance & {
  csrfProtection(request: FastifyRequest, reply: FastifyReply, done: (error?: Error) => void): void;
};

type CookiePlugin = Parameters<FastifyInstance["register"]>[0];

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

@Injectable()
export class CsrfService {
  readonly preauthCookieName: string;
  readonly sessionCookieName: string;
  readonly csrfSecretCookieName: string;

  constructor(readonly options: CsrfServiceOptions) {
    this.preauthCookieName = options.preauthCookieName ?? "__Host-preauth";
    this.sessionCookieName = options.sessionCookieName ?? "__Host-session";
    this.csrfSecretCookieName = options.csrfSecretCookieName ?? "__Host-csrf";
  }

  acquire(request: FastifyRequest, reply: FastifyReply): { csrfToken: string } {
    const cookieRequest = request as CookieAwareRequest;
    let context = cookieRequest.cookies[this.sessionCookieName];
    if (!context) {
      context = cookieRequest.cookies[this.preauthCookieName];
      if (!context) {
        context = randomBytes(32).toString("base64url");
        cookieRequest.cookies[this.preauthCookieName] = context;
        (reply as CookieReply).setCookie(this.preauthCookieName, context, this.cookieOptions());
      }
    }
    return { csrfToken: this.generate(request, reply) };
  }

  rotateToSession(
    request: FastifyRequest,
    reply: FastifyReply,
    sessionReference: string,
  ): { csrfToken: string } {
    if (sessionReference.trim().length === 0) {
      throw new Error("session reference required");
    }
    const cookieRequest = request as CookieAwareRequest;
    this.clearContextCookie(reply, this.preauthCookieName);
    this.clearContextCookie(reply, this.csrfSecretCookieName);
    delete cookieRequest.cookies[this.preauthCookieName];
    delete cookieRequest.cookies[this.csrfSecretCookieName];
    cookieRequest.cookies[this.sessionCookieName] = sessionReference;
    (reply as CookieReply).setCookie(
      this.sessionCookieName,
      sessionReference,
      this.cookieOptions(),
    );
    return { csrfToken: this.generate(request, reply) };
  }

  rotateCurrent(request: FastifyRequest, reply: FastifyReply): { csrfToken: string } {
    const cookieRequest = request as CookieAwareRequest;
    const sessionReference =
      cookieRequest.auth?.sessionId ?? cookieRequest.cookies[this.sessionCookieName];
    if (!sessionReference) {
      throw new Error("authenticated session required");
    }
    return this.rotateToSession(request, reply, sessionReference);
  }

  invalidate(request: FastifyRequest, reply: FastifyReply): void {
    const cookieRequest = request as CookieAwareRequest;
    for (const name of [
      this.preauthCookieName,
      this.sessionCookieName,
      this.csrfSecretCookieName,
    ]) {
      delete cookieRequest.cookies[name];
      this.clearContextCookie(reply, name);
    }
  }

  bindingFor(request: FastifyRequest): string {
    const cookieRequest = request as CookieAwareRequest;
    const session = cookieRequest.auth?.sessionId ?? cookieRequest.cookies[this.sessionCookieName];
    if (session) return this.digest(`session\0${session}`);
    const preauth = cookieRequest.cookies[this.preauthCookieName];
    return preauth ? this.digest(`preauth\0${preauth}`) : this.digest("missing-context");
  }

  protectHook(): preHandlerHookHandler {
    return async (request, reply) => {
      await this.protect(request, reply);
    };
  }

  async protect(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    if (SAFE_METHODS.has(request.method)) return;
    this.assertSameOrigin(request);
    await new Promise<void>((resolve, reject) => {
      const callback = (error?: Error) => (error ? reject(error) : resolve());
      (request.server as CsrfFastifyInstance).csrfProtection(request, reply, callback);
    });
  }

  private generate(request: FastifyRequest, reply: FastifyReply): string {
    return (reply as CookieReply).generateCsrf({ userInfo: this.bindingFor(request) });
  }

  private assertSameOrigin(request: FastifyRequest): void {
    const origin = firstHeader(request.headers.origin);
    if (origin !== undefined) {
      if (origin === "null" || origin !== this.options.appOrigin) throw forbiddenOrigin();
      return;
    }

    const referer = firstHeader(request.headers.referer);
    if (!referer) throw forbiddenOrigin();
    try {
      if (new URL(referer).origin !== this.options.appOrigin) throw forbiddenOrigin();
    } catch {
      throw forbiddenOrigin();
    }
  }

  private digest(value: string): string {
    return createHash("sha256").update(value, "utf8").digest("base64url");
  }

  private cookieOptions(): SecureCookieOptions {
    return {
      path: "/",
      httpOnly: true,
      secure: this.options.secureCookies,
      sameSite: "lax" as const,
    };
  }

  private clearContextCookie(reply: FastifyReply, name: string): void {
    (reply as CookieReply).clearCookie(name, {
      path: "/",
      httpOnly: true,
      secure: this.options.secureCookies,
      sameSite: "lax",
    });
  }
}

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrf: CsrfService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    await this.csrf.protect(http.getRequest<FastifyRequest>(), http.getResponse<FastifyReply>());
    return true;
  }
}

export async function registerCsrfPlugins(
  server: FastifyInstance,
  service: CsrfService,
  plugins: { cookie: unknown; csrfProtection: unknown },
): Promise<void> {
  await server.register(plugins.cookie as CookiePlugin, {
    secret: service.options.cookieSigningKey,
    hook: "onRequest",
  });
  await server.register(plugins.csrfProtection as CookiePlugin, {
    sessionPlugin: "@fastify/cookie",
    cookieKey: service.csrfSecretCookieName,
    cookieOpts: {
      path: "/",
      httpOnly: true,
      secure: service.options.secureCookies,
      sameSite: "lax",
      signed: true,
    },
    csrfOpts: {
      hmacKey: service.options.csrfSecret,
      userInfo: true,
    },
    getToken: (request: FastifyRequest) => firstHeader(request.headers["x-csrf-token"]),
    getUserInfo: (request: FastifyRequest) => service.bindingFor(request),
  });
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function forbiddenOrigin(): Error {
  const error = new Error("request origin is not allowed") as Error & { statusCode?: number };
  error.statusCode = 403;
  return error;
}
