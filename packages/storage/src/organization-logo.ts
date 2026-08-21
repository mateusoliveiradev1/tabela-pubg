import { createHash } from "node:crypto";
import { createObjectKey, type PutObjectInput, validateUpload } from "./index.js";

export const ORGANIZATION_LOGO_POLICY = {
  maxBytes: 2 * 1024 * 1024,
  allowedMimeTypes: ["image/png", "image/jpeg", "image/webp"],
} as const;

export type OrganizationLogoMime = (typeof ORGANIZATION_LOGO_POLICY.allowedMimeTypes)[number];

export interface OrganizationLogoInspection {
  detectedMime: OrganizationLogoMime;
  byteSize: number;
}

export interface OrganizationLogoStorage {
  putObject(input: PutObjectInput): Promise<void>;
}

export interface StoreOrganizationLogoInput {
  organizationId: string;
  declaredMime: string;
  bytes: Uint8Array;
}

export interface StoredOrganizationLogo extends OrganizationLogoInspection {
  objectKey: string;
  sha256: string;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf,
]);

function hasKnownActiveContent(bytes: Buffer): boolean {
  const text = bytes.toString("latin1").toLowerCase();
  return text.includes("<html") || text.includes("<svg") || text.includes("<script");
}

function isPng(bytes: Buffer): boolean {
  if (bytes.length < 33 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  let chunkIndex = 0;
  while (offset + 12 <= bytes.length) {
    const chunkLength = bytes.readUInt32BE(offset);
    const chunkType = bytes.toString("ascii", offset + 4, offset + 8);
    const nextOffset = offset + 12 + chunkLength;
    if (nextOffset > bytes.length) return false;

    if (chunkIndex === 0) {
      if (chunkType !== "IHDR" || chunkLength !== 13) return false;
      if (bytes.readUInt32BE(offset + 8) === 0 || bytes.readUInt32BE(offset + 12) === 0) {
        return false;
      }
    }

    if (chunkType === "IEND") {
      return chunkLength === 0 && nextOffset === bytes.length;
    }

    offset = nextOffset;
    chunkIndex += 1;
  }
  return false;
}

function isJpeg(bytes: Buffer): boolean {
  if (
    bytes.length < 23 ||
    bytes[0] !== 0xff ||
    bytes[1] !== 0xd8 ||
    bytes.at(-2) !== 0xff ||
    bytes.at(-1) !== 0xd9
  ) {
    return false;
  }

  for (let offset = 2; offset + 9 < bytes.length - 2; offset += 1) {
    if (bytes[offset] !== 0xff || !JPEG_START_OF_FRAME_MARKERS.has(bytes[offset + 1] ?? -1)) {
      continue;
    }
    const segmentLength = bytes.readUInt16BE(offset + 2);
    if (segmentLength < 8 || offset + 2 + segmentLength > bytes.length) return false;
    return bytes.readUInt16BE(offset + 5) > 0 && bytes.readUInt16BE(offset + 7) > 0;
  }
  return false;
}

function isWebp(bytes: Buffer): boolean {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.readUInt32LE(4) + 8 !== bytes.length
  ) {
    return false;
  }

  const chunkType = bytes.toString("ascii", 12, 16);
  if (!new Set(["VP8 ", "VP8L", "VP8X"]).has(chunkType)) return false;
  const chunkLength = bytes.readUInt32LE(16);
  const paddedLength = chunkLength + (chunkLength % 2);
  return 20 + paddedLength === bytes.length;
}

function detectOrganizationLogoMime(bytes: Buffer): OrganizationLogoMime {
  if (hasKnownActiveContent(bytes)) {
    throw new Error("Organization logo structure contains active or polyglot content");
  }
  if (isPng(bytes)) return "image/png";
  if (isJpeg(bytes)) return "image/jpeg";
  if (isWebp(bytes)) return "image/webp";
  throw new Error("Organization logo bytes do not have a supported image structure");
}

export function inspectOrganizationLogo(
  bytesInput: Uint8Array,
  declaredMime: string,
): OrganizationLogoInspection {
  validateUpload(bytesInput.byteLength, declaredMime, ORGANIZATION_LOGO_POLICY);
  const bytes = Buffer.from(bytesInput.buffer, bytesInput.byteOffset, bytesInput.byteLength);
  const detectedMime = detectOrganizationLogoMime(bytes);
  if (detectedMime !== declaredMime) {
    throw new Error("Declared MIME must match the organization logo bytes");
  }
  return { detectedMime, byteSize: bytes.byteLength };
}

export async function storeOrganizationLogo(
  storage: OrganizationLogoStorage,
  input: StoreOrganizationLogoInput,
): Promise<StoredOrganizationLogo> {
  const inspection = inspectOrganizationLogo(input.bytes, input.declaredMime);
  const objectKey = createObjectKey("branding", input.organizationId);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");

  await storage.putObject({
    key: objectKey,
    body: input.bytes,
    contentType: inspection.detectedMime,
  });

  return { ...inspection, objectKey, sha256 };
}
