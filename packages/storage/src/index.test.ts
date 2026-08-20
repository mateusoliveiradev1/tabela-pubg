import { describe, expect, it } from "vitest";
import { validateUpload } from "./index.js";

const policy = { maxBytes: 1024, allowedMimeTypes: ["image/png"] };

describe("upload policy", () => {
  it("accepts a file inside the allowlist", () => {
    expect(() => validateUpload(512, "image/png", policy)).not.toThrow();
  });

  it("rejects oversized or unlisted files", () => {
    expect(() => validateUpload(2048, "image/png", policy)).toThrow("size");
    expect(() => validateUpload(512, "text/html", policy)).toThrow("MIME");
  });
});
