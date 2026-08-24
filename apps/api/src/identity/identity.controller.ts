import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Ip,
  Optional,
  Post,
  Query,
  Req,
  Res,
  SetMetadata,
} from "@nestjs/common";
import {
  EmailOtpRequestSchema,
  type EmailOtpResponse,
  EmailOtpResponseSchema,
  type OAuthCallbackResponse,
  OAuthCallbackResponseSchema,
  OAuthPurposeSchema,
  OAuthStartRequestSchema,
  type OAuthStartResponse,
  OAuthStartResponseSchema,
  SessionAlertContextRequestSchema,
  type SessionAlertContextResponse,
  SessionAlertContextResponseSchema,
  VerifyEmailOtpRequestSchema,
  type VerifyEmailOtpResponse,
  VerifyEmailOtpResponseSchema,
} from "@pubg-camp/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthenticatedSession } from "../authorization/authorization.service.js";
import type { CsrfService } from "../security/csrf.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";
import type { SessionService } from "./session.service.js";

export const IDENTITY_OAUTH_SERVICE = Symbol("IDENTITY_OAUTH_SERVICE");
export const IDENTITY_OTP_SERVICE = Symbol("IDENTITY_OTP_SERVICE");
export const IDENTITY_SESSION_SERVICE = Symbol("IDENTITY_SESSION_SERVICE");
export const IDENTITY_CSRF_SERVICE = Symbol("IDENTITY_CSRF_SERVICE");

export interface SessionAlertRequest extends FastifyRequest {
  auth: AuthenticatedSession;
}

const OAuthCallbackQuerySchema = z
  .object({
    code: z.string().trim().min(1).max(2_048),
    state: z.string().trim().min(16).max(1_024),
    purpose: OAuthPurposeSchema.default("sign-in"),
  })
  .strict();

@Controller("identity")
@SetMetadata("auth.public", true)
export class IdentityController {
  constructor(
    @Inject(IDENTITY_OAUTH_SERVICE)
    private readonly oauth: OAuthService,
    @Inject(IDENTITY_OTP_SERVICE)
    private readonly otp: OtpService,
    @Optional()
    @Inject(IDENTITY_CSRF_SERVICE)
    private readonly csrf?: CsrfService,
  ) {}

  @Post("oauth/discord/start")
  async startDiscord(
    @Body() rawBody: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header" | "status">,
    @Req() request?: FastifyRequest,
  ): Promise<OAuthStartResponse> {
    const body = OAuthStartRequestSchema.parse(rawBody);
    const resolvedBrowserBinding =
      browserBinding ?? (request ? this.csrf?.browserBindingFor(request) : undefined);
    if (!resolvedBrowserBinding) throw stableCancelled();
    try {
      const started = await this.oauth.start({
        purpose: body.purpose,
        browserBinding: resolvedBrowserBinding,
        ...(body.returnPath === undefined ? {} : { returnPath: body.returnPath }),
      });
      reply?.header("location", started.authorizationUrl).status(302);
      return OAuthStartResponseSchema.parse({ status: "redirect-required" });
    } catch {
      throw stableCancelled();
    }
  }

  @Post("oauth/discord/callback")
  async callbackDiscord(
    @Body() rawQuery: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Req() request?: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ): Promise<OAuthCallbackResponse> {
    const resolvedBrowserBinding =
      browserBinding ?? (request ? this.csrf?.browserBindingFor(request) : undefined);
    if (!resolvedBrowserBinding) throw stableCancelled();
    try {
      const query = OAuthCallbackQuerySchema.parse(rawQuery);
      const result = await this.oauth.callback({
        code: query.code,
        state: query.state,
        purpose: query.purpose,
        browserBinding: resolvedBrowserBinding,
      });
      if (result.status === "step-up-confirmed") {
        if (request && reply) this.csrf?.rotateCurrent(request, reply);
        return OAuthCallbackResponseSchema.parse({
          status: "authenticated",
          nextPath: result.nextPath,
        });
      }
      if (request && reply) {
        this.csrf?.rotateToSession(request, reply, result.sessionId, result.sessionToken);
      }
      return OAuthCallbackResponseSchema.parse({
        status: result.status === "linked" ? "link-confirmation-required" : "authenticated",
        nextPath: result.nextPath,
      });
    } catch {
      throw stableCancelled();
    }
  }

  @Post("email/otp/request")
  async requestEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header">,
  ): Promise<EmailOtpResponse> {
    const body = EmailOtpRequestSchema.parse(rawBody);
    const result = await this.otp.request({
      email: body.email,
      purpose: body.purpose,
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    if (result.challengeId) reply?.header("x-otp-challenge-id", result.challengeId);
    return EmailOtpResponseSchema.parse(result.response);
  }

  @Post("email/otp/verify")
  async verifyEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request?: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ): Promise<VerifyEmailOtpResponse> {
    const body = VerifyEmailOtpRequestSchema.parse(rawBody);
    const result = await this.otp.verify({
      challengeId: body.challengeId,
      email: body.email,
      purpose: body.purpose,
      code: body.code,
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    if (result.status === "rejected") throw stableCancelled();
    if (result.status === "authenticated") {
      if (request && reply) {
        try {
          this.csrf?.rotateCurrent(request, reply);
        } catch {
          // OTP account/session establishment adapter will set the session cookie before rotating.
        }
      }
      return VerifyEmailOtpResponseSchema.parse({ status: "authenticated", nextPath: "/" });
    }
    if (result.status === "step-up-confirmed") {
      return VerifyEmailOtpResponseSchema.parse({
        status: result.status,
        validUntil: result.validUntil.toISOString(),
      });
    }
    return VerifyEmailOtpResponseSchema.parse(result);
  }
}

@Controller("identity/session-alerts")
export class SessionAlertContextController {
  constructor(
    @Inject(IDENTITY_SESSION_SERVICE)
    private readonly sessions: SessionService,
  ) {}

  @Get("resolve")
  @SetMetadata("auth.permission", "identity:session-alerts:resolve")
  async resolve(
    @Query() rawQuery: unknown,
    @Req() request: SessionAlertRequest,
  ): Promise<SessionAlertContextResponse> {
    const query = SessionAlertContextRequestSchema.parse(rawQuery);
    const result = await this.sessions.resolveAlertContext(request.auth.actorId, query.context);
    return SessionAlertContextResponseSchema.parse(result);
  }
}

function stableCancelled(): BadRequestException {
  return new BadRequestException({ status: "cancelled" });
}

function normalizeCorrelationId(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 120 ? normalized : "unavailable";
}
