import { describe, expect, it } from "vitest";
import {
  CreateOrganizationMultipartRequestSchema,
  ORGANIZATION_LOGO_MAX_BYTES,
  OrganizationLogoCleanupJobSchema,
  OrganizationLogoResponseSchema,
  UpdateOrganizationLogoMultipartRequestSchema,
} from "./organizations.js";

const organizationId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2320";
const logoId = "018f0ce7-98e3-7b27-bf2d-6eeac51d2324";

describe("organization logo contracts", () => {
  it("accepts multipart metadata without modeling file bytes or storage internals", () => {
    const logo = { declaredMime: "image/png", byteSize: 128 };

    expect(
      CreateOrganizationMultipartRequestSchema.safeParse({
        name: "Camps da Comunidade",
        logo,
      }).success,
    ).toBe(true);
    expect(UpdateOrganizationLogoMultipartRequestSchema.safeParse({ logo }).success).toBe(true);
    expect(
      UpdateOrganizationLogoMultipartRequestSchema.safeParse({ logo, extraLogo: logo }).success,
    ).toBe(false);
    expect(
      CreateOrganizationMultipartRequestSchema.safeParse({
        name: "Camps da Comunidade",
        logo: { ...logo, bytesBase64: "c2VjcmV0", filename: "../../logo.png" },
      }).success,
    ).toBe(false);
    expect(
      CreateOrganizationMultipartRequestSchema.safeParse({
        name: "Camps da Comunidade",
        logo: { ...logo, byteSize: ORGANIZATION_LOGO_MAX_BYTES + 1 },
      }).success,
    ).toBe(false);
  });

  it("returns only recoverable public metadata", () => {
    const response = {
      id: logoId,
      detectedMime: "image/webp",
      byteSize: 512,
      url: `https://cdn.example.test/organizations/${organizationId}/logo`,
    };

    expect(OrganizationLogoResponseSchema.safeParse(response).success).toBe(true);
    expect(
      OrganizationLogoResponseSchema.safeParse({
        ...response,
        objectKey: `branding/${organizationId}/${logoId}`,
        bucket: "private-assets",
      }).success,
    ).toBe(false);
  });

  it("accepts cleanup jobs containing only an opaque cleanup id", () => {
    expect(OrganizationLogoCleanupJobSchema.safeParse({ cleanupId: logoId }).success).toBe(true);
    for (const forbidden of [
      { objectKey: `branding/${organizationId}/${logoId}` },
      { provider: "s3" },
      { organizationId },
    ]) {
      expect(
        OrganizationLogoCleanupJobSchema.safeParse({ cleanupId: logoId, ...forbidden }).success,
      ).toBe(false);
    }
  });
});
