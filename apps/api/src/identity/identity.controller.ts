import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpException,
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
  type VerifyEmailOtpResponse,
  VerifyEmailOtpResponseSchema,
} from "@pubg-camp/contracts";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { AuthenticatedSession } from "../authorization/authorization.service.js";
import { AllowProvisional, Public, RequirePermission } from "../authorization/decorators.js";
import type { CsrfService } from "../security/csrf.service.js";
import { type IdentityService, ReauthenticationRequiredException } from "./identity.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";
import type { SessionService } from "./session.service.js";

export const IDENTITY_OAUTH_SERVICE = Symbol("IDENTITY_OAUTH_SERVICE");
export const IDENTITY_OTP_SERVICE = Symbol("IDENTITY_OTP_SERVICE");
export const IDENTITY_SERVICE = Symbol("IDENTITY_SERVICE");
export const IDENTITY_SESSION_SERVICE = Symbol("IDENTITY_SESSION_SERVICE");
export const IDENTITY_CSRF_SERVICE = Symbol("IDENTITY_CSRF_SERVICE");

export interface SessionAlertRequest extends FastifyRequest {
  auth: AuthenticatedSession;
}

type AuthenticatedIdentityRequest = FastifyRequest & { auth: AuthenticatedSession };

const EmailOnlySchema = z.object({ email: z.email().trim().max(254) }).strict();
const EmailOtpCodeSchema = z
  .object({
    challengeId: z.uuid(),
    email: z.email().trim().max(254),
    code: z.string().regex(/^\d{8}$/),
  })
  .strict();
const ChangeEmailOtpCodeSchema = EmailOtpCodeSchema.extend({ identityId: z.uuid() }).strict();

const OAuthCallbackQuerySchema = z
  .object({
    code: z.string().trim().min(1).max(2_048),
    state: z.string().trim().min(16).max(1_024),
    purpose: OAuthPurposeSchema.default("sign-in"),
  })
  .strict();

@Controller("identity")
export class IdentityController {
  constructor(
    @Inject(IDENTITY_OAUTH_SERVICE)
    private readonly oauth: OAuthService,
    @Inject(IDENTITY_OTP_SERVICE)
    private readonly otp: OtpService,
    @Inject(IDENTITY_SERVICE)
    private readonly identity: IdentityService,
    @Optional()
    @Inject(IDENTITY_CSRF_SERVICE)
    private readonly csrf?: CsrfService,
  ) {}

  @Post("oauth/discord/sign-in/start")
  @Public()
  startDiscordSignIn(
    @Body() rawBody: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header" | "status">,
    @Req() request?: FastifyRequest,
  ): Promise<OAuthStartResponse> {
    return this.startDiscordForPurpose(
      "sign-in",
      rawBody,
      browserBinding,
      undefined,
      reply,
      request,
    );
  }

  @Post("oauth/discord/link-identity/start")
  @RequirePermission("authenticated")
  startDiscordIdentityLink(
    @Body() rawBody: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header" | "status">,
  ): Promise<OAuthStartResponse> {
    return this.startDiscordForPurpose(
      "link-identity",
      rawBody,
      browserBinding,
      request,
      reply,
      request,
    );
  }

  @Post("oauth/discord/step-up/start")
  @RequirePermission("authenticated")
  startDiscordStepUp(
    @Body() rawBody: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header" | "status">,
  ): Promise<OAuthStartResponse> {
    return this.startDiscordForPurpose("step-up", rawBody, browserBinding, request, reply, request);
  }

  @Post("oauth/discord/sign-in/callback")
  @Public()
  callbackDiscordSignIn(
    @Body() rawQuery: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Req() request?: FastifyRequest,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ): Promise<OAuthCallbackResponse> {
    return this.callbackDiscordForPurpose(
      "sign-in",
      rawQuery,
      browserBinding,
      undefined,
      request,
      reply,
    );
  }

  @Post("oauth/discord/link-identity/callback")
  @RequirePermission("authenticated")
  callbackDiscordIdentityLink(
    @Body() rawQuery: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OAuthCallbackResponse> {
    return this.callbackDiscordForPurpose(
      "link-identity",
      rawQuery,
      browserBinding,
      request,
      request,
      reply,
    );
  }

  @Post("oauth/discord/step-up/callback")
  @RequirePermission("authenticated")
  callbackDiscordStepUp(
    @Body() rawQuery: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<OAuthCallbackResponse> {
    return this.callbackDiscordForPurpose(
      "step-up",
      rawQuery,
      browserBinding,
      request,
      request,
      reply,
    );
  }

  @Post("email/otp/sign-in/request")
  @Public()
  async requestEmailSignInOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header">,
  ): Promise<EmailOtpResponse> {
    const body = EmailOnlySchema.parse(rawBody);
    const result = await this.otp.request({
      email: body.email,
      purpose: "sign-in",
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    if (result.challengeId) reply?.header("x-otp-challenge-id", result.challengeId);
    return EmailOtpResponseSchema.parse(result.response);
  }

  @Post("email/otp/sign-in/verify")
  @Public()
  async verifyEmailSignInOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VerifyEmailOtpResponse> {
    const body = EmailOtpCodeSchema.parse(rawBody);
    const result = await this.otp.verify({
      challengeId: body.challengeId,
      email: body.email,
      purpose: "sign-in",
      code: body.code,
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    if (result.status !== "authenticated") throw stableCancelled();
    const deviceFingerprint = this.csrf?.browserBindingFor(request);
    if (!deviceFingerprint) throw stableCancelled();
    try {
      const issued = await this.identity.startEmailSession({
        userId: result.userId,
        email: body.email,
        deviceFingerprint,
        device: deviceMetadata(request),
        correlationId: normalizeCorrelationId(correlationId),
      });
      this.csrf?.rotateToSession(request, reply, issued.sessionId, issued.sessionToken);
      return VerifyEmailOtpResponseSchema.parse({ status: "authenticated", nextPath: "/" });
    } catch {
      throw stableCancelled();
    }
  }

  @Post("email/otp/link-email/request")
  @RequirePermission("authenticated")
  requestLinkEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header">,
  ): Promise<EmailOtpResponse> {
    return this.requestProtectedOtp(
      "link-email",
      rawBody,
      trustedIp,
      correlationId,
      request,
      reply,
    );
  }

  @Post("email/otp/change-email/request")
  @RequirePermission("authenticated")
  requestChangeEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header">,
  ): Promise<EmailOtpResponse> {
    return this.requestProtectedOtp(
      "change-email",
      rawBody,
      trustedIp,
      correlationId,
      request,
      reply,
    );
  }

  @Post("email/otp/step-up/request")
  @RequirePermission("authenticated")
  requestEmailStepUpOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header">,
  ): Promise<EmailOtpResponse> {
    return this.requestProtectedOtp("step-up", rawBody, trustedIp, correlationId, request, reply);
  }

  @Post("email/otp/verify-provisional-email/request")
  @RequirePermission("authenticated")
  @AllowProvisional()
  requestProvisionalEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header">,
  ): Promise<EmailOtpResponse> {
    if (request.auth.trust !== "provisional") throw stableCancelled();
    return this.requestProtectedOtp(
      "verify-provisional-email",
      rawBody,
      trustedIp,
      correlationId,
      request,
      reply,
    );
  }

  @Post("email/otp/link-email/verify")
  @RequirePermission("authenticated")
  async verifyLinkEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VerifyEmailOtpResponse> {
    return this.verifyEmailSecurityChange(
      "link-email",
      rawBody,
      trustedIp,
      correlationId,
      request,
      reply,
    );
  }

  @Post("email/otp/change-email/verify")
  @RequirePermission("authenticated")
  async verifyChangeEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VerifyEmailOtpResponse> {
    return this.verifyEmailSecurityChange(
      "change-email",
      rawBody,
      trustedIp,
      correlationId,
      request,
      reply,
    );
  }

  @Post("email/otp/step-up/verify")
  @RequirePermission("authenticated")
  async verifyEmailStepUpOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VerifyEmailOtpResponse> {
    const body = EmailOtpCodeSchema.parse(rawBody);
    const result = await this.otp.verify({
      ...body,
      purpose: "step-up",
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    if (
      result.status !== "step-up-confirmed" ||
      result.actorId !== request.auth.actorId ||
      result.sessionId !== request.auth.sessionId
    ) {
      throw stableCancelled();
    }
    this.csrf?.rotateCurrent(request, reply);
    return VerifyEmailOtpResponseSchema.parse({
      status: "step-up-confirmed",
      validUntil: result.validUntil.toISOString(),
    });
  }

  @Post("email/otp/verify-provisional-email/verify")
  @RequirePermission("authenticated")
  @AllowProvisional()
  async verifyProvisionalEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
    @Req() request: AuthenticatedIdentityRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<VerifyEmailOtpResponse> {
    if (request.auth.trust !== "provisional") throw stableCancelled();
    const body = EmailOtpCodeSchema.parse(rawBody);
    const result = await this.otp.verify({
      ...body,
      purpose: "verify-provisional-email",
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    if (
      result.status !== "provisional-email-verified" ||
      result.userId !== request.auth.actorId ||
      result.sessionId !== request.auth.sessionId ||
      result.trust !== "trusted"
    ) {
      throw stableCancelled();
    }
    this.csrf?.rotateToSession(request, reply, result.sessionId, result.sessionToken);
    return VerifyEmailOtpResponseSchema.parse({ status: "authenticated", nextPath: "/" });
  }

  private async requestProtectedOtp(
    purpose: "link-email" | "change-email" | "step-up" | "verify-provisional-email",
    rawBody: unknown,
    trustedIp: string,
    correlationId: string | undefined,
    request: AuthenticatedIdentityRequest,
    reply?: Pick<FastifyReply, "header">,
  ): Promise<EmailOtpResponse> {
    const body = EmailOnlySchema.parse(rawBody);
    if (purpose === "link-email" || purpose === "change-email") {
      await this.identity.assertFreshAuthentication(request.auth.actorId, request.auth.sessionId);
    }
    const result = await this.otp.request({
      email: body.email,
      purpose,
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    if (result.challengeId) reply?.header("x-otp-challenge-id", result.challengeId);
    return EmailOtpResponseSchema.parse(result.response);
  }

  private async startDiscordForPurpose(
    purpose: "sign-in" | "link-identity" | "step-up",
    rawBody: unknown,
    browserBinding: string | undefined,
    authRequest: AuthenticatedIdentityRequest | undefined,
    reply: Pick<FastifyReply, "header" | "status"> | undefined,
    request: FastifyRequest | undefined,
  ): Promise<OAuthStartResponse> {
    const resolvedBrowserBinding =
      browserBinding ?? (request ? this.csrf?.browserBindingFor(request) : undefined);
    if (!resolvedBrowserBinding) throw stableCancelled();
    try {
      const body = OAuthStartRequestSchema.parse(rawBody);
      if (body.purpose !== purpose) throw new Error("oauth purpose mismatch");
      if (purpose === "link-identity" && authRequest) {
        await this.identity.assertFreshAuthentication(
          authRequest.auth.actorId,
          authRequest.auth.sessionId,
        );
      }
      const started = await this.oauth.start({
        purpose,
        browserBinding: resolvedBrowserBinding,
        ...(body.returnPath === undefined ? {} : { returnPath: body.returnPath }),
        ...(authRequest === undefined
          ? {}
          : {
              actorId: authRequest.auth.actorId,
              sessionId: authRequest.auth.sessionId,
            }),
      });
      reply?.header("location", started.authorizationUrl).status(302);
      return OAuthStartResponseSchema.parse({ status: "redirect-required" });
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === 428) throw error;
      throw stableCancelled();
    }
  }

  private async callbackDiscordForPurpose(
    purpose: "sign-in" | "link-identity" | "step-up",
    rawBody: unknown,
    browserBinding: string | undefined,
    authRequest: AuthenticatedIdentityRequest | undefined,
    request: FastifyRequest | undefined,
    reply: FastifyReply | undefined,
  ): Promise<OAuthCallbackResponse> {
    const resolvedBrowserBinding =
      browserBinding ?? (request ? this.csrf?.browserBindingFor(request) : undefined);
    if (!resolvedBrowserBinding) throw stableCancelled();
    try {
      const query = OAuthCallbackQuerySchema.parse(rawBody);
      if (query.purpose !== purpose) throw new Error("oauth purpose mismatch");
      const result = await this.oauth.callback({
        code: query.code,
        state: query.state,
        purpose,
        browserBinding: resolvedBrowserBinding,
        ...(authRequest === undefined
          ? {}
          : {
              actorId: authRequest.auth.actorId,
              sessionId: authRequest.auth.sessionId,
            }),
      });
      if (purpose === "sign-in") {
        if (result.status !== "authenticated") throw new Error("oauth purpose mismatch");
        if (request && reply) {
          this.csrf?.rotateToSession(request, reply, result.sessionId, result.sessionToken);
        }
        return OAuthCallbackResponseSchema.parse({
          status: "authenticated",
          nextPath: result.nextPath,
        });
      }
      if (purpose === "step-up") {
        if (result.status !== "step-up-confirmed") throw new Error("oauth purpose mismatch");
        if (request && reply) this.csrf?.rotateCurrent(request, reply);
        return OAuthCallbackResponseSchema.parse({
          status: "authenticated",
          nextPath: result.nextPath,
        });
      }
      if (result.status !== "link-confirmation-required") {
        throw new Error("oauth purpose mismatch");
      }
      return OAuthCallbackResponseSchema.parse(result);
    } catch {
      throw stableCancelled();
    }
  }

  private async verifyEmailSecurityChange(
    purpose: "link-email" | "change-email",
    rawBody: unknown,
    trustedIp: string,
    correlationId: string | undefined,
    request: AuthenticatedIdentityRequest,
    reply: FastifyReply,
  ): Promise<VerifyEmailOtpResponse> {
    const body = EmailOtpCodeSchema.parse(rawBody);
    const identityId =
      purpose === "change-email" ? ChangeEmailOtpCodeSchema.parse(rawBody).identityId : undefined;
    const normalizedCorrelationId = normalizeCorrelationId(correlationId);
    await this.identity.assertFreshAuthentication(request.auth.actorId, request.auth.sessionId);
    const result = await this.otp.verify({
      challengeId: body.challengeId,
      email: body.email,
      code: body.code,
      purpose,
      actorId: request.auth.actorId,
      sessionId: request.auth.sessionId,
      trustedIp,
      correlationId: normalizedCorrelationId,
    });
    const expectedStatus = purpose === "link-email" ? "identity-link-ready" : "email-change-ready";
    if (
      result.status !== expectedStatus ||
      result.actorId !== request.auth.actorId ||
      result.sessionId !== request.auth.sessionId
    ) {
      throw stableCancelled();
    }
    try {
      const secured = await this.identity.applyEmailSecurityChange({
        actorId: request.auth.actorId,
        sessionId: request.auth.sessionId,
        proofId: result.proofId,
        purpose,
        email: body.email,
        ...(identityId === undefined ? {} : { identityId }),
        correlationId: normalizedCorrelationId,
      });
      this.csrf?.rotateToSession(request, reply, secured.sessionId, secured.sessionToken);
      return VerifyEmailOtpResponseSchema.parse({ status: expectedStatus });
    } catch (error) {
      if (error instanceof ReauthenticationRequiredException) throw error;
      throw stableCancelled();
    }
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

function deviceMetadata(request: FastifyRequest): {
  label: string;
  browser: string;
  operatingSystem: string;
  summarizedUserAgent: string;
} {
  const raw = firstHeader(request.headers["user-agent"])?.trim().slice(0, 512) || "Unknown client";
  const browser = /Edg\//.test(raw)
    ? "Edge"
    : /Firefox\//.test(raw)
      ? "Firefox"
      : /Chrome\//.test(raw)
        ? "Chrome"
        : /Safari\//.test(raw)
          ? "Safari"
          : "Unknown browser";
  const operatingSystem = /Windows/i.test(raw)
    ? "Windows"
    : /Android/i.test(raw)
      ? "Android"
      : /iPhone|iPad|iOS/i.test(raw)
        ? "iOS"
        : /Mac OS|Macintosh/i.test(raw)
          ? "macOS"
          : /Linux/i.test(raw)
            ? "Linux"
            : "Unknown OS";
  return {
    label: `${browser} on ${operatingSystem}`,
    browser,
    operatingSystem,
    summarizedUserAgent: raw,
  };
}

function firstHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
