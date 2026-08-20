import { describe, expect, it } from "vitest";
import { createObjectKey, ObjectKeySchema, validateUpload } from "./index.js";

const policy = { maxBytes: 1024, allowedMimeTypes: ["image/png"] };

describe("upload policy", () => {
  it("accepts a file inside the allowlist", () => {
    expect(() => validateUpload(512, "image/png", policy)).not.toThrow();
  });

  it("rejects oversized or unlisted files", () => {
    expect(() => validateUpload(2048, "image/png", policy)).toThrow("size");
    expect(() => validateUpload(512, "text/html", policy)).toThrow("MIME");
  });

  it("creates opaque keys and rejects arbitrary paths", () => {
    const organizationId = "2cd2130b-7cae-4cce-8869-b6e9b45d14f5";
    const objectId = "6d56a6fb-c7da-4fc2-8deb-26cb62d03fed";

    expect(createObjectKey("receipts", organizationId, objectId)).toBe(
      `receipts/${organizationId}/${objectId}`,
    );
    expect(ObjectKeySchema.safeParse("receipts/../../config").success).toBe(false);
  });
});
