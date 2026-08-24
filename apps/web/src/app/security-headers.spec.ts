import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config.js";

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
});
