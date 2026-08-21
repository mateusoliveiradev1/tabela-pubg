import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import { IdentityController } from "./identity.controller.js";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";

function setup() {
  const oauth = {
    start: vi.fn(async () => ({ authorizationUrl: "https://discord.test/authorize?state=secret" })),
    callback: vi.fn(async () => ({
      status: "authenticated" as const,
      nextPath: "/dashboard",
      sessionId: "internal-session-secret",
    })),
  } as unknown as OAuthService;
  const otp = {
    request: vi.fn(async () => ({
      response: { status: "accepted" as const, retryAfterSeconds: 60 as const },
      challengeId: "internal-challenge-secret",
    })),
    verify: vi.fn(async () => ({ status: "authenticated" as const })),
  } as unknown as OtpService;
  return { controller: new IdentityController(oauth, otp), oauth, otp };
}

describe("IdentityController", () => {
  it("returns only the public redirect contract while preserving browser binding", async () => {
    const { controller, oauth } = setup();
    const reply = {
      header: vi.fn().mockReturnThis(),
      status: vi.fn().mockReturnThis(),
    };

    const result = await controller.startDiscord(
      { purpose: "sign-in", returnPath: "/dashboard" },
      "browser-binding-secret",
      reply,
    );

    expect(oauth.start).toHaveBeenCalledWith({
      purpose: "sign-in",
      returnPath: "/dashboard",
      browserBinding: "browser-binding-secret",
    });
    expect(result).toEqual({ status: "redirect-required" });
    expect(reply.header).toHaveBeenCalledWith(
      "location",
      "https://discord.test/authorize?state=secret",
    );
    expect(reply.status).toHaveBeenCalledWith(302);
    expect(JSON.stringify(result)).not.toContain("state=secret");
  });

  it("maps unavailable callback state/browser binding to a stable public error", async () => {
    const { controller, oauth } = setup();
    vi.mocked(oauth.callback).mockRejectedValueOnce(new Error("provider secret response"));

    const thrown = await controller
      .callbackDiscord(
        { code: "provider-code", state: "oauth-state", purpose: "sign-in" },
        "browser-binding",
      )
      .catch((error: unknown) => error);

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toEqual({ status: "cancelled" });
    expect(JSON.stringify((thrown as BadRequestException).getResponse())).not.toContain("secret");
  });

  it("keeps OTP request body and status uniform without exposing challenge data", async () => {
    const { controller, otp } = setup();
    const reply = { header: vi.fn() };

    const result = await controller.requestEmailOtp(
      { email: "player@example.com", purpose: "sign-in" },
      "203.0.113.8",
      "corr-1",
      reply,
    );

    expect(otp.request).toHaveBeenCalledWith({
      email: "player@example.com",
      purpose: "sign-in",
      trustedIp: "203.0.113.8",
      correlationId: "corr-1",
    });
    expect(result).toEqual({ status: "accepted", retryAfterSeconds: 60 });
    expect(result).not.toHaveProperty("challengeId");
    expect(reply.header).toHaveBeenCalledWith("x-otp-challenge-id", "internal-challenge-secret");
  });

  it("maps successful provider output without returning provider or session tokens", async () => {
    const { controller } = setup();

    const result = await controller.callbackDiscord(
      { code: "provider-code", state: "oauth-state-long-enough", purpose: "sign-in" },
      "browser-binding",
    );

    expect(result).toEqual({ status: "authenticated", nextPath: "/dashboard" });
    expect(JSON.stringify(result)).not.toContain("internal-session-secret");
    expect(JSON.stringify(result)).not.toContain("provider-code");
  });
});
