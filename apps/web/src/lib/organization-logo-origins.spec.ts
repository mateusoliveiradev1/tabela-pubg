import { describe, expect, it } from "vitest";
import {
  organizationLogoImageSourceDirective,
  parseOrganizationLogoOrigins,
} from "./organization-logo-origins";

describe("organization logo origins", () => {
  it("accepts HTTPS origins, normalizes duplicates and preserves exact non-default ports", () => {
    expect(
      parseOrganizationLogoOrigins(
        "https://LOGOS.example.test:443, https://logos.example.test,https://assets.example.test:8443/",
        "production",
      ),
    ).toEqual(["https://logos.example.test", "https://assets.example.test:8443"]);
  });

  it("accepts exact IPv6 origins with ports", () => {
    expect(parseOrganizationLogoOrigins("https://[2001:db8::1]:8443", "production")).toEqual([
      "https://[2001:db8::1]:8443",
    ]);
  });

  it.each([
    "https://user@logos.example.test",
    "https://user:secret@logos.example.test",
    "https://logos.example.test/path",
    "https://logos.example.test/?query=value",
    "https://logos.example.test/#fragment",
    "https://*.example.test",
    "https:",
    "",
  ])("rejects a non-origin entry atomically: %s", (entry) => {
    expect(() =>
      parseOrganizationLogoOrigins(`https://approved.example.test,${entry}`, "production"),
    ).toThrow(/organization logo origin/i);
  });

  it("rejects HTTP in production", () => {
    expect(() => parseOrganizationLogoOrigins("http://localhost:9000", "production")).toThrow(
      /organization logo origin/i,
    );
  });

  it("accepts only exact loopback HTTP origins in development", () => {
    expect(
      parseOrganizationLogoOrigins(
        "http://localhost:9000,http://127.0.0.1:9000,http://[::1]:9000",
        "development",
      ),
    ).toEqual(["http://localhost:9000", "http://127.0.0.1:9000", "http://[::1]:9000"]);
    expect(() =>
      parseOrganizationLogoOrigins("http://storage.internal:9000", "development"),
    ).toThrow(/organization logo origin/i);
  });

  it("serializes the narrow image policy without wildcard or scheme-wide sources", () => {
    expect(
      organizationLogoImageSourceDirective(
        "https://logos.example.test,https://assets.example.test:8443",
        "production",
      ),
    ).toBe(
      "img-src 'self' data: blob: https://logos.example.test https://assets.example.test:8443",
    );
  });
});
