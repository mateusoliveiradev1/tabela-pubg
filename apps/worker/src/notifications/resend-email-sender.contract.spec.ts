import { afterEach, describe, expect, it, vi } from "vitest";
import { ResendEmailSender } from "./resend-email-sender.js";

describe("ResendEmailSender HTTP contract", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the exact body and idempotency header through the SDK without real network", async () => {
    const captured: Array<{ url: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        captured.push({ url: String(input), init: init ?? {} });
        return new Response(JSON.stringify({ id: "email_captured" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const sender = new ResendEmailSender({
      apiKey: "re_test_not_real",
      from: "PUBG Camp <no-reply@example.com>",
    });

    await expect(
      sender.send({
        idempotencyKey: "notification/delivery-01",
        message: {
          to: "player@example.com",
          subject: "Seu código temporário",
          html: "<p>12345678</p>",
          text: "12345678",
        },
      }),
    ).resolves.toEqual({ providerMessageId: "email_captured" });

    expect(captured).toHaveLength(1);
    const request = captured[0];
    expect(request?.url).toBe("https://api.resend.com/emails");
    expect(new Headers(request?.init.headers).get("idempotency-key")).toBe(
      "notification/delivery-01",
    );
    expect(new Headers(request?.init.headers).get("authorization")).toBe("Bearer re_test_not_real");
    expect(JSON.parse(String(request?.init.body))).toEqual({
      from: "PUBG Camp <no-reply@example.com>",
      to: ["player@example.com"],
      subject: "Seu código temporário",
      html: "<p>12345678</p>",
      text: "12345678",
    });
  });

  it("throws a redacted provider error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              name: "rate_limit_exceeded",
              message: "request contained player@example.com",
              statusCode: 429,
            }),
            { status: 429, headers: { "content-type": "application/json" } },
          ),
      ),
    );
    const sender = new ResendEmailSender({
      apiKey: "re_test_not_real",
      from: "PUBG Camp <no-reply@example.com>",
    });

    await expect(
      sender.send({
        idempotencyKey: "notification/delivery-01",
        message: {
          to: "player@example.com",
          subject: "Seu código temporário",
          html: "<p>12345678</p>",
          text: "12345678",
        },
      }),
    ).rejects.toThrow("Resend delivery failed (rate_limit_exceeded)");
  });
});
