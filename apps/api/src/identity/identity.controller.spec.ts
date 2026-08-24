import { BadRequestException } from "@nestjs/common";
import { describe, expect, it, vi } from "vitest";
import type { AuthenticatedSession } from "../authorization/authorization.service.js";
import { PUBLIC_ROUTE_KEY } from "../authorization/decorators.js";
import type { CsrfService } from "../security/csrf.service.js";
import { IdentityController } from "./identity.controller.js";
import type { IdentityService } from "./identity.service.js";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";
import type { SessionService } from "./session.service.js";

const authenticated: AuthenticatedSession = {
  actorId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  trust: "trusted",
};

function setup() {
  const events: string[] = [];
  const oauth = {
    start: vi.fn(async () => ({ authorizationUrl: "https://discord.test/authorize?state=secret" })),
    callback: vi.fn(async () => ({
      status: "authenticated" as const,
      nextPath: "/dashboard",
      sessionId: "internal-session-secret",
      sessionToken: "opaque-session-token",
    })),
  } as unknown as OAuthService;
  const otp = {
    request: vi.fn(async () => ({
      response: { status: "accepted" as const, retryAfterSeconds: 60 as const },
      challengeId: "33333333-3333-4333-8333-333333333333",
    })),
    verify: vi.fn(async () => {
      events.push("otp");
      return { status: "authenticated" as const, userId: authenticated.actorId };
    }),
  } as unknown as OtpService;
  const identity = {
    startEmailSession: vi.fn(async () => {
      events.push("session");
      return {
        sessionId: authenticated.sessionId,
        sessionToken: "opaque-email-session-token",
        isNewDevice: true,
        notificationScheduled: true,
      };
    }),
    applyEmailSecurityChange: vi.fn(async () => {
      events.push("change");
      return {
        sessionId: authenticated.sessionId,
        sessionToken: "opaque-replacement-token",
        otherSessionsRevoked: 1,
      };
    }),
  } as unknown as IdentityService;
  const sessions = {
    confirmStepUp: vi.fn(async () => {
      events.push("step-up");
    }),
  } as unknown as SessionService;
  const csrf = {
    browserBindingFor: vi.fn(() => "server-browser-binding"),
    rotateToSession: vi.fn(() => {
      events.push("csrf-session");
      return { csrfToken: "rotated" };
    }),
    rotateCurrent: vi.fn(() => {
      events.push("csrf-current");
      return { csrfToken: "rotated" };
    }),
  } as unknown as CsrfService;
  return {
    controller: new IdentityController(oauth, otp, identity, sessions, csrf),
    oauth,
    otp,
    identity,
    sessions,
    csrf,
    events,
  };
}

function request(auth: AuthenticatedSession = authenticated) {
  return {
    auth,
    cookies: { "__Host-preauth": "opaque-preauth", "__Host-session": "old-session-token" },
    headers: { "user-agent": "Mozilla/5.0 Chrome/140 Windows NT 10.0" },
  } as never;
}

function reply() {
  return { header: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() } as never;
}

describe("IdentityController", () => {
  it("keeps public sign-in routes explicit and protected OTP routes non-public", () => {
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, IdentityController.prototype.requestEmailSignInOtp),
    ).toBe(true);
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, IdentityController.prototype.verifyEmailSignInOtp),
    ).toBe(true);
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, IdentityController.prototype.requestEmailStepUpOtp),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(PUBLIC_ROUTE_KEY, IdentityController.prototype.verifyProvisionalEmailOtp),
    ).toBeUndefined();
  });

  it("returns only the public Discord redirect contract", async () => {
    const { controller, oauth } = setup();
    const response = reply();
    const result = await controller.startDiscord(
      { purpose: "sign-in", returnPath: "/dashboard" },
      "browser-binding-secret",
      response,
    );
    expect(oauth.start).toHaveBeenCalledWith({
      purpose: "sign-in",
      returnPath: "/dashboard",
      browserBinding: "browser-binding-secret",
    });
    expect(result).toEqual({ status: "redirect-required" });
    expect(response.header).toHaveBeenCalledWith(
      "location",
      "https://discord.test/authorize?state=secret",
    );
    expect(response.status).toHaveBeenCalledWith(302);
  });

  it("maps unavailable callback state to a stable public error", async () => {
    const { controller, oauth } = setup();
    vi.mocked(oauth.callback).mockRejectedValueOnce(new Error("provider secret response"));
    const thrown = await controller
      .callbackDiscord(
        { code: "provider-code", state: "oauth-state-long-enough", purpose: "sign-in" },
        "browser-binding",
      )
      .catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).getResponse()).toEqual({ status: "cancelled" });
  });

  it("accepts only sign-in on the public OTP contract", async () => {
    const { controller, otp } = setup();
    const response = reply();
    const result = await controller.requestEmailSignInOtp(
      { email: "player@example.com" },
      "203.0.113.8",
      "corr-1",
      response,
    );
    expect(otp.request).toHaveBeenCalledWith({
      email: "player@example.com",
      purpose: "sign-in",
      trustedIp: "203.0.113.8",
      correlationId: "corr-1",
    });
    expect(result).toEqual({ status: "accepted", retryAfterSeconds: 60 });
    await expect(
      controller.requestEmailSignInOtp(
        { email: "player@example.com", purpose: "step-up" },
        "203.0.113.8",
        "corr-1",
        response,
      ),
    ).rejects.toThrow();
  });

  it("persists a device session before publishing cookie and CSRF", async () => {
    const { controller, otp, identity, csrf, events } = setup();
    const req = request();
    const response = reply();
    const result = await controller.verifyEmailSignInOtp(
      {
        challengeId: "33333333-3333-4333-8333-333333333333",
        email: "player@example.com",
        code: "12345678",
      },
      "203.0.113.8",
      "corr-sign-in",
      req,
      response,
    );
    expect(otp.verify).toHaveBeenCalledWith(expect.objectContaining({ purpose: "sign-in" }));
    expect(identity.startEmailSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: authenticated.actorId,
        email: "player@example.com",
        deviceFingerprint: "server-browser-binding",
        correlationId: "corr-sign-in",
      }),
    );
    expect(csrf.rotateToSession).toHaveBeenCalledWith(
      req,
      response,
      authenticated.sessionId,
      "opaque-email-session-token",
    );
    expect(events).toEqual(["otp", "session", "csrf-session"]);
    expect(result).toEqual({ status: "authenticated", nextPath: "/" });
  });

  it("derives protected OTP actor and session exclusively from request.auth", async () => {
    const { controller, otp } = setup();
    await controller.requestEmailStepUpOtp(
      { email: "player@example.com" },
      "203.0.113.8",
      "corr-step",
      request(),
      reply(),
    );
    expect(otp.request).toHaveBeenCalledWith({
      email: "player@example.com",
      purpose: "step-up",
      actorId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      trustedIp: "203.0.113.8",
      correlationId: "corr-step",
    });
    await expect(
      controller.requestEmailStepUpOtp(
        { email: "player@example.com", actorId: "attacker", sessionId: "other" },
        "203.0.113.8",
        "corr-step",
        request(),
        reply(),
      ),
    ).rejects.toThrow();
  });

  it("persists email step-up before rotating current CSRF", async () => {
    const { controller, otp, sessions, csrf, events } = setup();
    const confirmedAt = new Date("2026-08-24T12:00:00.000Z");
    vi.mocked(otp.verify).mockResolvedValueOnce({
      status: "step-up-confirmed",
      actorId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      confirmedAt,
      validUntil: new Date("2026-08-24T12:10:00.000Z"),
    });
    const req = request();
    const response = reply();
    const result = await controller.verifyEmailStepUpOtp(
      {
        challengeId: "33333333-3333-4333-8333-333333333333",
        email: "player@example.com",
        code: "12345678",
      },
      "203.0.113.8",
      "corr-step",
      req,
      response,
    );
    expect(sessions.confirmStepUp).toHaveBeenCalledWith({
      userId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      method: "email",
      confirmedAt,
    });
    expect(csrf.rotateCurrent).toHaveBeenCalledWith(req, response);
    expect(events).toEqual(["step-up", "csrf-current"]);
    expect(result).toEqual({
      status: "step-up-confirmed",
      validUntil: "2026-08-24T12:10:00.000Z",
    });
  });

  it("passes the unconsumed proof once to D-08 and publishes replacement credentials after commit", async () => {
    const { controller, otp, identity, csrf, events } = setup();
    vi.mocked(otp.verify).mockResolvedValueOnce({
      status: "identity-link-ready",
      proofId: "44444444-4444-4444-8444-444444444444",
      actorId: authenticated.actorId,
      sessionId: authenticated.sessionId,
    });
    const req = request();
    const response = reply();
    const result = await controller.verifyLinkEmailOtp(
      {
        challengeId: "33333333-3333-4333-8333-333333333333",
        email: "player@example.com",
        code: "12345678",
      },
      "203.0.113.8",
      "corr-link",
      req,
      response,
    );
    expect(identity.applyEmailSecurityChange).toHaveBeenCalledTimes(1);
    expect(identity.applyEmailSecurityChange).toHaveBeenCalledWith({
      actorId: authenticated.actorId,
      sessionId: authenticated.sessionId,
      proofId: "44444444-4444-4444-8444-444444444444",
      purpose: "link-email",
      email: "player@example.com",
      correlationId: "corr-link",
    });
    expect(csrf.rotateToSession).toHaveBeenCalledWith(
      req,
      response,
      authenticated.sessionId,
      "opaque-replacement-token",
    );
    expect(events).toEqual(["change", "csrf-session"]);
    expect(result).toEqual({ status: "identity-link-ready" });
  });

  it("emits no cookie or CSRF when D-08 rolls back", async () => {
    const { controller, otp, identity, csrf } = setup();
    vi.mocked(otp.verify).mockResolvedValueOnce({
      status: "identity-link-ready",
      proofId: "44444444-4444-4444-8444-444444444444",
      actorId: authenticated.actorId,
      sessionId: authenticated.sessionId,
    });
    vi.mocked(identity.applyEmailSecurityChange).mockRejectedValueOnce(new Error("rolled back"));
    await expect(
      controller.verifyLinkEmailOtp(
        {
          challengeId: "33333333-3333-4333-8333-333333333333",
          email: "player@example.com",
          code: "12345678",
        },
        "203.0.113.8",
        "corr-link",
        request(),
        reply(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(csrf.rotateToSession).not.toHaveBeenCalled();
    expect(csrf.rotateCurrent).not.toHaveBeenCalled();
  });

  it("promotes only request.auth provisional session to the committed replacement token", async () => {
    const { controller, otp, csrf, events } = setup();
    const provisional = { ...authenticated, trust: "provisional" as const };
    vi.mocked(otp.verify).mockResolvedValueOnce({
      status: "provisional-email-verified",
      userId: provisional.actorId,
      sessionId: provisional.sessionId,
      sessionToken: "opaque-promoted-token",
      trust: "trusted",
    });
    const req = request(provisional);
    const response = reply();
    const result = await controller.verifyProvisionalEmailOtp(
      {
        challengeId: "33333333-3333-4333-8333-333333333333",
        email: "confirmed@example.com",
        code: "12345678",
      },
      "203.0.113.8",
      "corr-promote",
      req,
      response,
    );
    expect(otp.verify).toHaveBeenCalledWith(
      expect.objectContaining({
        purpose: "verify-provisional-email",
        actorId: provisional.actorId,
        sessionId: provisional.sessionId,
      }),
    );
    expect(csrf.rotateToSession).toHaveBeenCalledWith(
      req,
      response,
      provisional.sessionId,
      "opaque-promoted-token",
    );
    expect(events).toEqual(["csrf-session"]);
    expect(result).toEqual({ status: "authenticated", nextPath: "/" });
  });
});
