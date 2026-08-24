import { describe, expect, it } from "vitest";
import { renderNotificationTemplate } from "./templates.js";

const createdAt = new Date("2026-08-24T03:48:00.000Z");
const appBaseUrl = "https://camp.example.com";

function render(template: string, payload: Record<string, unknown>) {
  return renderNotificationTemplate({ template, payload, createdAt, appBaseUrl });
}

describe("DROP MANIFEST transactional email system", () => {
  it.each([
    [
      "otp",
      {
        recipient: "player@example.com",
        code: "12345678",
        expiresAt: "2026-08-24T04:00:00.000Z",
      },
    ],
    [
      "invitation",
      {
        recipient: "captain@example.com",
        invitationToken: "invite-token-preview",
        organizationName: "Arena TLS Sandbox",
        expiresAt: "2026-08-31T03:48:00.000Z",
      },
    ],
    [
      "new-device",
      {
        recipient: "player@example.com",
        alertToken: "alert-token-preview",
        sessionId: "internal-session-id",
        device: {
          label: "Notebook de transmissão",
          browser: "Firefox",
          operatingSystem: "Windows 11",
          approximateLocation: "São Paulo, BR",
          summarizedUserAgent: "Firefox on Windows",
        },
      },
    ],
  ])("renders %s as the documented 640px email-safe manifesto", (template, payload) => {
    const message = render(template, payload);

    expect(message.html).toMatch(
      /<body[^>]*>\s*<!-- impeccable:design-contract[\s\S]*?seed ca30eaa3[\s\S]*?unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN\.md[\s\S]*?-->/,
    );
    expect(message.html).toContain('role="presentation"');
    expect(message.html).toContain('width="640"');
    expect(message.html).toContain('class="preheader"');
    expect(message.html).toContain('<meta name="color-scheme" content="light dark">');
    expect(message.html).toContain('<meta name="supported-color-schemes" content="light dark">');
    expect(message.html).toContain("@media only screen and (max-width:680px)");
    expect(message.html).toContain("PUBG CAMP");
    expect(message.html).toContain("Ver endereço completo");
    expect(message.html).toContain("<!--[if mso]>");
    expect(message.html).toContain("<![endif]-->");
    expect(message.html).not.toMatch(/linear-gradient|radial-gradient|box-shadow|text-shadow/i);
    expect(message.html).not.toMatch(/border-radius\s*:/i);
  });

  it("makes the OTP the dominant, copyable datum without leaking it into the subject or URL", () => {
    const message = render("otp", {
      recipient: "player@example.com",
      code: "12345678",
      expiresAt: "2026-08-24T04:00:00.000Z",
    });

    expect(message.subject).toBe("Seu código temporário");
    expect(message.subject).not.toContain("12345678");
    expect(message.html).toContain('aria-label="Código temporário: 1 2 3 4 5 6 7 8"');
    expect(message.html).toContain("user-select:all");
    expect(message.html).toContain("12345678");
    expect(message.html).not.toMatch(/href="[^"]*12345678/);
    expect(message.text).toContain("12345678");
  });

  it("uses signal orange for operations and reserves red for the security alert", () => {
    const invitation = render("invitation", {
      recipient: "captain@example.com",
      invitationToken: "invite-token-preview",
      organizationName: "Arena TLS Sandbox",
      expiresAt: "2026-08-31T03:48:00.000Z",
    });
    const newDevice = render("new-device", {
      recipient: "player@example.com",
      alertToken: "alert-token-preview",
      sessionId: "internal-session-id",
      device: {
        label: "Notebook",
        browser: "Firefox",
        operatingSystem: "Windows 11",
        approximateLocation: null,
        summarizedUserAgent: null,
      },
    });

    expect(invitation.html).toContain("#f4a21d");
    expect(invitation.html).not.toContain("#c64242");
    expect(newDevice.html).toContain("#c64242");
    expect(newDevice.html).toContain("ALERTA DE SEGURANÇA");
  });

  it("escapes untrusted organization and device copy while keeping secrets out of the visible hierarchy", () => {
    const invitation = render("invitation", {
      recipient: "captain@example.com",
      invitationToken: "token-<unsafe>",
      organizationName: '<img src=x onerror="alert(1)">',
      expiresAt: "2026-08-31T03:48:00.000Z",
    });
    const newDevice = render("new-device", {
      recipient: "player@example.com",
      alertToken: "opaque-alert-context",
      sessionId: "internal-session-id",
      device: {
        label: "Notebook <script>",
        browser: "Firefox <unsafe>",
        operatingSystem: "Windows 11",
        approximateLocation: null,
        summarizedUserAgent: "private-user-agent",
      },
    });

    expect(invitation.html).not.toContain("<img src=x");
    expect(invitation.html).not.toContain('onerror="alert(1)"');
    expect(invitation.html).toContain("%3Cunsafe%3E");
    expect(newDevice.html).not.toContain("<unsafe>");
    expect(newDevice.html).not.toContain("internal-session-id");
    expect(newDevice.html).not.toContain("private-user-agent");
  });
});
