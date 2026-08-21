import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertE2EProviderEnvironment,
  E2EOrganizationLogoStorage,
} from "./e2e-organization-logo-storage.js";

const png = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010806000000000000000000000049454e4400000000",
  "hex",
);

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("E2E organization logo storage", () => {
  it("fails closed unless fake providers, test mode and a valid run id are present together", () => {
    expect(() => assertE2EProviderEnvironment({ E2E_PROVIDER_MODE: "fake" })).toThrow(
      "E2E fake providers require",
    );
    expect(() =>
      assertE2EProviderEnvironment({
        E2E_PROVIDER_MODE: "fake",
        NODE_ENV: "production",
        E2E_RUN_ID: "run-0123456789abcdef",
      }),
    ).toThrow("E2E fake providers require");
    expect(() =>
      assertE2EProviderEnvironment({
        E2E_PROVIDER_MODE: "fake",
        NODE_ENV: "test",
        E2E_RUN_ID: "../escape",
      }),
    ).toThrow("E2E_RUN_ID");
    expect(
      assertE2EProviderEnvironment({
        E2E_PROVIDER_MODE: "fake",
        NODE_ENV: "test",
        E2E_RUN_ID: "run-0123456789abcdef",
      }),
    ).toBe("run-0123456789abcdef");
  });

  it("persists exact bytes per run, exposes a same-origin test route and deletes idempotently", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pubg-camp-e2e-logo-"));
    roots.push(root);
    const storage = new E2EOrganizationLogoStorage({
      root,
      runId: "run-0123456789abcdef",
      publicBasePath: "/api/platform/__e2e/logos",
    });

    const stored = await storage.store({
      organizationId: "00000000-0000-4000-8000-000000000111",
      declaredMime: "image/png",
      bytes: png,
    });
    const object = await storage.readObject(stored.objectKey);
    expect(object?.bytes).toEqual(png);
    expect(object?.contentType).toBe("image/png");
    expect(await readFile(object?.path ?? "")).toEqual(png);
    await expect(storage.createDownloadUrl(stored.objectKey, 300)).resolves.toMatch(
      /^\/api\/platform\/__e2e\/logos\/run-0123456789abcdef\//,
    );

    await storage.deleteObject(stored.objectKey);
    await storage.deleteObject(stored.objectKey);
    await expect(storage.readObject(stored.objectKey)).resolves.toBeNull();
  });

  it("never reads objects outside its own run root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pubg-camp-e2e-logo-"));
    roots.push(root);
    const storage = new E2EOrganizationLogoStorage({
      root,
      runId: "run-fedcba9876543210",
      publicBasePath: "/api/platform/__e2e/logos",
    });
    await expect(storage.readObject("../../outside")).rejects.toThrow("object key");
  });
});
