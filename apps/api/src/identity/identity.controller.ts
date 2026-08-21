import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Ip,
  Post,
  Query,
  Res,
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
  VerifyEmailOtpRequestSchema,
  type VerifyEmailOtpResponse,
  VerifyEmailOtpResponseSchema,
} from "@pubg-camp/contracts";
import type { FastifyReply } from "fastify";
import { z } from "zod";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";

export const IDENTITY_OAUTH_SERVICE = Symbol("IDENTITY_OAUTH_SERVICE");
export const IDENTITY_OTP_SERVICE = Symbol("IDENTITY_OTP_SERVICE");

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
  ) {}

  @Post("oauth/discord/start")
  async startDiscord(
    @Body() rawBody: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
    @Res({ passthrough: true }) reply?: Pick<FastifyReply, "header" | "status">,
  ): Promise<OAuthStartResponse> {
    const body = OAuthStartRequestSchema.parse(rawBody);
    if (!browserBinding) throw stableCancelled();
    try {
      const started = await this.oauth.start({
        purpose: body.purpose,
        browserBinding,
        ...(body.returnPath === undefined ? {} : { returnPath: body.returnPath }),
      });
      reply?.header("location", started.authorizationUrl).status(302);
      return OAuthStartResponseSchema.parse({ status: "redirect-required" });
    } catch {
      throw stableCancelled();
    }
  }

  @Get("oauth/discord/callback")
  async callbackDiscord(
    @Query() rawQuery: unknown,
    @Headers("x-auth-browser-binding") browserBinding: string | undefined,
  ): Promise<OAuthCallbackResponse> {
    if (!browserBinding) throw stableCancelled();
    try {
      const query = OAuthCallbackQuerySchema.parse(rawQuery);
      const result = await this.oauth.callback({
        code: query.code,
        state: query.state,
        purpose: query.purpose,
        browserBinding,
      });
      if (result.status === "step-up-confirmed") {
        return OAuthCallbackResponseSchema.parse({
          status: "authenticated",
          nextPath: result.nextPath,
        });
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
  ): Promise<EmailOtpResponse> {
    const body = EmailOtpRequestSchema.parse(rawBody);
    const result = await this.otp.request({
      email: body.email,
      purpose: body.purpose,
      trustedIp,
      correlationId: normalizeCorrelationId(correlationId),
    });
    return EmailOtpResponseSchema.parse(result.response);
  }

  @Post("email/otp/verify")
  async verifyEmailOtp(
    @Body() rawBody: unknown,
    @Ip() trustedIp: string,
    @Headers("x-correlation-id") correlationId: string | undefined,
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

function stableCancelled(): BadRequestException {
  return new BadRequestException({ status: "cancelled" });
}

function normalizeCorrelationId(value: string | undefined): string {
  const normalized = value?.trim();
  return normalized && normalized.length <= 120 ? normalized : "unavailable";
}
