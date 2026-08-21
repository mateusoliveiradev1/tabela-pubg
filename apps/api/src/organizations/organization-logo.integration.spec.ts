import type { OrganizationSummary } from "@pubg-camp/contracts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TokenGenerator } from "../identity/ports/token-generator.js";
import { type InvitationRepositoryPort, InvitationsService } from "./invitations.service.js";
import { parseOrganizationMultipart } from "./organizations.controller.js";
import { type OrganizationRepositoryPort, OrganizationsService } from "./organizations.service.js";
import type { OrganizationLogoStorage } from "./ports/organization-logo-storage.js";

const actorId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const membershipId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-08-21T12:00:00.000Z");
const fallbackUrl = "https://camp.example.com/images/organization-fallback.svg";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function ownerSummary(): OrganizationSummary {
  return {
    id: organizationId,
    slug: "arena-alpha-222222222222",
    name: "Arena Alpha",
    logoUrl: null,
    membershipRole: "owner",
  };
}

function tokens(): TokenGenerator {
  let value = 0;
  return {
    id: vi.fn(() => {
      value += 1;
      return `${`${value}`.padStart(8, "0")}-0000-4000-8000-000000000000`;
    }),
    opaque: vi.fn(() => "opaque"),
    numericCode: vi.fn(() => "12345678"),
    digest: vi.fn((input) => `digest:${input}`),
  };
}

function setup() {
  const repository: OrganizationRepositoryPort = {
    create: vi.fn(async () => ownerSummary()),
    listForUser: vi.fn(async () => [ownerSummary()]),
    authorizeLogoMutation: vi.fn(async () => ({ membershipId, role: "owner" as const })),
    getActiveLogoForActor: vi.fn(async () => null),
    getActiveLogo: vi.fn(async () => null),
    replaceLogo: vi.fn(async (input) => ({ logo: input.logo, previousObjectKey: null })),
    enqueueOrphanCleanup: vi.fn(async () => undefined),
  };
  const storage: OrganizationLogoStorage = {
    store: vi.fn(async (input) => ({
      objectKey: `branding/${input.organizationId}/44444444-4444-4444-8444-444444444444`,
      sha256: "a".repeat(64),
      detectedMime: "image/png" as const,
      byteSize: png.byteLength,
    })),
    deleteObject: vi.fn(async () => undefined),
    createDownloadUrl: vi.fn(async () => "https://storage.example.com/logo?expires=300"),
  };
  return {
    repository,
    storage,
    service: new OrganizationsService(repository, tokens(), { now: () => now }, storage, {
      fallbackUrl,
      signedUrlTtlSeconds: 300,
    }),
  };
}

describe("organization logo application flow", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("stores inspected bytes before atomically creating the organization and active asset", async () => {
    const { repository, service, storage } = setup();

    const response = await service.create({
      actorId,
      body: { name: "Arena Alpha", logo: { declaredMime: "image/png", byteSize: png.byteLength } },
      logoBytes: png,
      correlationId: "55555555-5555-4555-8555-555555555555",
    });

    expect(storage.store).toHaveBeenCalledWith({
      organizationId: expect.any(String),
      declaredMime: "image/png",
      bytes: png,
    });
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        logo: expect.objectContaining({
          objectKey: expect.stringMatching(/^branding\//),
          detectedMime: "image/png",
          byteSize: png.byteLength,
        }),
      }),
    );
    expect(response.organization.logoUrl).toContain("expires=300");
    expect(JSON.stringify(response)).not.toMatch(/objectKey|bucket|sha256/);
  });

  it("removes a newly stored object when the organization transaction rolls back", async () => {
    const { repository, service, storage } = setup();
    vi.mocked(repository.create).mockRejectedValueOnce(new Error("database unavailable"));

    await expect(
      service.create({
        actorId,
        body: {
          name: "Arena Alpha",
          logo: { declaredMime: "image/png", byteSize: png.byteLength },
        },
        logoBytes: png,
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow("database unavailable");

    expect(storage.deleteObject).toHaveBeenCalledWith(expect.stringMatching(/^branding\//));
    expect(repository.enqueueOrphanCleanup).not.toHaveBeenCalled();
  });

  it("rejects spoofed bytes and cross-organization mutation before writing storage", async () => {
    const { repository, service, storage } = setup();
    vi.mocked(storage.store).mockRejectedValueOnce(new Error("Declared MIME must match bytes"));

    await expect(
      service.create({
        actorId,
        body: {
          name: "Arena Alpha",
          logo: { declaredMime: "image/jpeg", byteSize: png.byteLength },
        },
        logoBytes: png,
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow(/match/i);
    expect(repository.create).not.toHaveBeenCalled();

    vi.mocked(repository.authorizeLogoMutation).mockResolvedValueOnce(null);
    await expect(
      service.updateLogo({
        actorId,
        organizationId,
        body: { logo: { declaredMime: "image/png", byteSize: png.byteLength } },
        logoBytes: png,
        correlationId: "55555555-5555-4555-8555-555555555555",
      }),
    ).rejects.toThrow("organization action unavailable");
    expect(storage.store).toHaveBeenCalledTimes(1);
    expect(repository.replaceLogo).not.toHaveBeenCalled();
  });

  it("returns a short signed URL and a safe fallback when signing or metadata is unavailable", async () => {
    const { repository, service, storage } = setup();
    const activeLogo = {
      id: "44444444-4444-4444-8444-444444444444",
      objectKey: `branding/${organizationId}/55555555-5555-4555-8555-555555555555`,
      detectedMime: "image/png" as const,
      byteSize: png.byteLength,
    };
    vi.mocked(repository.getActiveLogoForActor).mockResolvedValue(activeLogo);

    await expect(service.getLogo(actorId, organizationId)).resolves.toEqual({
      id: "44444444-4444-4444-8444-444444444444",
      detectedMime: "image/png",
      byteSize: png.byteLength,
      url: "https://storage.example.com/logo?expires=300",
    });
    expect(storage.createDownloadUrl).toHaveBeenCalledWith(expect.any(String), 300);

    vi.mocked(repository.getActiveLogo).mockResolvedValueOnce(activeLogo);
    vi.mocked(storage.createDownloadUrl).mockRejectedValueOnce(new Error("object missing"));
    await expect(service.publicLogoUrl(organizationId)).resolves.toBe(fallbackUrl);
    vi.mocked(repository.getActiveLogo).mockResolvedValueOnce(null);
    await expect(service.publicLogoUrl(organizationId)).resolves.toBe(fallbackUrl);
  });
});

describe("strict multipart parsing", () => {
  it("extracts only name, claimed MIME and logo bytes without trusting filename or keys", () => {
    const boundary = "camp-boundary";
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="name"\r\n\r\nArena Alpha\r\n` +
          `--${boundary}\r\nContent-Disposition: form-data; name="logo"; filename="../../evil.png"\r\nContent-Type: image/png\r\n\r\n`,
      ),
      png,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);

    const parsed = parseOrganizationMultipart(body, `multipart/form-data; boundary=${boundary}`);

    expect(parsed).toEqual({
      name: "Arena Alpha",
      logo: { declaredMime: "image/png", byteSize: png.byteLength, bytes: png },
    });
    expect(JSON.stringify(parsed)).not.toContain("evil.png");
  });

  it("rejects unknown fields, duplicate parts and bodies beyond the hard limit", () => {
    const boundary = "camp-boundary";
    const unknown = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="objectKey"\r\n\r\nbranding/evil\r\n--${boundary}--\r\n`,
    );
    expect(() =>
      parseOrganizationMultipart(unknown, `multipart/form-data; boundary=${boundary}`),
    ).toThrow(/multipart/i);
    expect(() =>
      parseOrganizationMultipart(
        Buffer.alloc(2 * 1024 * 1024 + 16_385),
        `multipart/form-data; boundary=${boundary}`,
      ),
    ).toThrow(/large|limit/i);
  });
});

describe("invitation logo projection", () => {
  it("resolves a short logo URL only after the opaque invitation preview is valid", async () => {
    const preview = vi.fn(async () => ({
      status: "valid" as const,
      organization: { id: organizationId, name: "Arena Alpha", logoUrl: null },
      invitedBy: "Capitão",
      maskedEmail: "p***@example.com",
      organizationRole: "member" as const,
      assignments: [],
      expiresAt: "2026-08-28T12:00:00.000Z",
      emailMatches: true,
    }));
    const repository = {
      preview,
    } as unknown as InvitationRepositoryPort;
    const logos = { resolve: vi.fn(async () => "https://storage.example.com/logo?expires=300") };
    const service = new InvitationsService(repository, tokens(), { now: () => now }, logos);

    const result = await service.preview(actorId, "opaque-invitation-context");

    expect(preview).toHaveBeenCalledWith({ actorId, token: "opaque-invitation-context", now });
    expect(logos.resolve).toHaveBeenCalledWith(organizationId);
    expect(result).toMatchObject({
      status: "valid",
      organization: { logoUrl: "https://storage.example.com/logo?expires=300" },
    });
    expect(JSON.stringify(result)).not.toMatch(/objectKey|bucket/);
  });
});
