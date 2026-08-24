import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveIdentityRedisPrefixes } from "../identity/identity.runtime.js";
import { createFakeDiscordFetch, resolveApiProviderMode } from "../main.js";

const runId = "run-abcdef0123456789abcdef01";
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pubg-camp-phase2-e2e-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("real API provider composition", () => {
  it("passes the validated run id to the 02-41 scope contract without rebuilding prefixes", async () => {
    const root = await createRoot();
    const mode = await resolveApiProviderMode({
      NODE_ENV: "test",
      E2E_PROVIDER_MODE: "fake",
      E2E_RUN_ID: runId,
      E2E_OBJECT_ROOT: root,
    });

    expect(mode).toMatchObject({ mode: "fake", runId, objectRoot: root });
    if (mode.mode !== "fake") throw new Error("expected fake provider mode");
    expect(mode.redisScope).toEqual({ mode: "run", runScopeId: runId });
    expect(resolveIdentityRedisPrefixes(mode.redisScope)).toEqual({
      authKeyPrefix: `pubg-camp:${runId}:auth`,
      oauthPkceKeyPrefix: `pubg-camp:${runId}:oauth:pkce`,
    });
    expect(JSON.stringify(resolveIdentityRedisPrefixes(mode.redisScope))).not.toContain(
      '"pubg-camp:auth"',
    );
    expect(`pubg-camp:${runId}:bullmq`).toContain(mode.redisScope.runScopeId);
  });

  it("keeps default production namespaces stable and exposes no fake provider", async () => {
    const mode = await resolveApiProviderMode({ NODE_ENV: "production" });
    expect(mode).toEqual({ mode: "production", redisScope: { mode: "production" } });
    expect(resolveIdentityRedisPrefixes(mode.redisScope)).toEqual({
      authKeyPrefix: "pubg-camp:auth",
      oauthPkceKeyPrefix: "pubg-camp:oauth:pkce",
    });
  });

  it("rejects absent, broad and mismatched fake scope before any Redis write", async () => {
    const root = await createRoot();
    const redisWrite = vi.fn();
    const invalid = [
      { E2E_PROVIDER_MODE: "fake" },
      {
        NODE_ENV: "test",
        E2E_PROVIDER_MODE: "fake",
        E2E_RUN_ID: "run-all-012345678901",
        E2E_OBJECT_ROOT: root,
      },
      { NODE_ENV: "test", E2E_PROVIDER_MODE: "fake", E2E_RUN_ID: runId, E2E_OBJECT_ROOT: tmpdir() },
      {
        NODE_ENV: "production",
        E2E_PROVIDER_MODE: "fake",
        E2E_RUN_ID: runId,
        E2E_OBJECT_ROOT: root,
      },
    ];

    for (const environment of invalid) {
      await expect(resolveApiProviderMode(environment)).rejects.toThrow(/E2E|fake|root|scope/i);
    }
    expect(redisWrite).not.toHaveBeenCalled();
  });

  it("provides a deterministic test-only Discord transport only after the complete conjunction", async () => {
    const fakeFetch = createFakeDiscordFetch(runId);
    const tokenResponse = await fakeFetch("https://discord.com/api/v10/oauth2/token", {
      method: "POST",
    });
    const profileResponse = await fakeFetch("https://discord.com/api/v10/users/@me", {
      headers: { authorization: "Bearer opaque-test-token" },
    });

    await expect(tokenResponse.json()).resolves.toMatchObject({ token_type: "Bearer" });
    await expect(profileResponse.json()).resolves.toMatchObject({ verified: true });
    await expect(fakeFetch("https://example.com/not-discord")).rejects.toThrow(/Discord/i);
  });
});
