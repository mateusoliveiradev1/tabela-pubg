import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  inspectOrganizationLogo,
  ORGANIZATION_LOGO_POLICY,
  storeOrganizationLogo,
} from "./organization-logo.js";

const organizationId = "2cd2130b-7cae-4cce-8869-b6e9b45d14f5";

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01, 0x03, 0x01, 0x11, 0x00, 0x02,
  0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
]);
const webp = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x16, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x58,
  0x0a, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

describe("organization logo inspection", () => {
  it.each([
    ["image/png", png],
    ["image/jpeg", jpeg],
    ["image/webp", webp],
  ] as const)("accepts bounded %s bytes with a matching declared MIME", (mime, bytes) => {
    expect(inspectOrganizationLogo(bytes, mime)).toEqual({
      detectedMime: mime,
      byteSize: bytes.byteLength,
    });
  });

  it("rejects empty, oversized, executable, spoofed and trailing polyglot bytes", () => {
    expect(() => inspectOrganizationLogo(Buffer.alloc(0), "image/png")).toThrow();
    expect(() =>
      inspectOrganizationLogo(
        Buffer.alloc(ORGANIZATION_LOGO_POLICY.maxBytes + 1, 0x89),
        "image/png",
      ),
    ).toThrow();
    expect(() => inspectOrganizationLogo(Buffer.from("<svg></svg>"), "image/svg+xml")).toThrow();
    expect(() => inspectOrganizationLogo(Buffer.from("<html></html>"), "image/png")).toThrow();
    expect(() => inspectOrganizationLogo(png, "image/jpeg")).toThrow(/match/i);
    expect(() =>
      inspectOrganizationLogo(
        Buffer.concat([png, Buffer.from("<script>alert(1)</script>")]),
        "image/png",
      ),
    ).toThrow(/structure|trailing|polyglot/i);
  });

  it("stores valid bytes under a server-generated opaque branding key", async () => {
    const putObject = vi.fn(async () => undefined);
    const result = await storeOrganizationLogo(
      { putObject },
      { organizationId, declaredMime: "image/png", bytes: png },
    );

    expect(result.objectKey).toMatch(new RegExp(`^branding/${organizationId}/[0-9a-f-]{36}$`, "i"));
    expect(result).toMatchObject({
      detectedMime: "image/png",
      byteSize: png.byteLength,
      sha256: createHash("sha256").update(png).digest("hex"),
    });
    expect(putObject).toHaveBeenCalledWith({
      key: result.objectKey,
      body: png,
      contentType: "image/png",
    });
    expect(JSON.stringify(result)).not.toContain("filename");
    expect(JSON.stringify(result)).not.toContain("bucket");
  });
});
