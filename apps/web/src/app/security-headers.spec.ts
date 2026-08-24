import { afterEach, describe, expect, it, vi } from "vitest";
import nextConfig from "../../next.config.js";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browser security headers", () => {
  it("allows OAuth form redirects only to the exact Discord authorization origin", async () => {
    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === "/(.*)");
    const csp = globalRule?.headers.find(
      (header) => header.key.toLowerCase() === "content-security-policy",
    )?.value;

    const formAction = csp
      ?.split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("form-action "));
    expect(formAction).toBe("form-action 'self' https://discord.com");
  });

  it("adds only normalized exact configured origins to production img-src", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS",
      "https://logos.example.test:443, https://assets.example.test:8443,https://logos.example.test",
    );

    const rules = await nextConfig.headers?.();
    const globalRule = rules?.find((rule) => rule.source === "/(.*)");
    const csp = globalRule?.headers.find(
      (header) => header.key.toLowerCase() === "content-security-policy",
    )?.value;
    const imageSource = csp
      ?.split(";")
      .map((directive) => directive.trim())
      .find((directive) => directive.startsWith("img-src "));

    expect(imageSource).toBe(
      "img-src 'self' data: blob: https://logos.example.test https://assets.example.test:8443",
    );
    expect(imageSource?.split(/\s+/)).not.toContain("*");
    expect(imageSource).not.toContain("https:");
  });

  it("rejects the complete production origin configuration when one entry is unsafe", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "NEXT_PUBLIC_ORGANIZATION_LOGO_ORIGINS",
      "https://logos.example.test,https://*.example.test",
    );

    await expect(nextConfig.headers?.()).rejects.toThrow(/organization logo origin/i);
  });
});
