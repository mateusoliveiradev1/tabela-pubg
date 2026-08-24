import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileEmailSender, resolveWorkerProviderMode } from "./file-email-sender.js";

const runId = "run-0123456789abcdef01234567";
const roots: string[] = [];

async function createRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "pubg-camp-phase2-e2e-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("worker E2E provider mode", () => {
  it("fails closed for every partial, production, broad or non-owned fake scope", async () => {
    const root = await createRoot();
    const partials = [
      { E2E_PROVIDER_MODE: "fake" },
      { NODE_ENV: "test", E2E_RUN_ID: runId, E2E_OBJECT_ROOT: root },
      {
        NODE_ENV: "production",
        E2E_PROVIDER_MODE: "fake",
        E2E_RUN_ID: runId,
        E2E_OBJECT_ROOT: root,
      },
      {
        NODE_ENV: "test",
        E2E_PROVIDER_MODE: "fake",
        E2E_RUN_ID: "run-shared-0123456789",
        E2E_OBJECT_ROOT: root,
      },
      { NODE_ENV: "test", E2E_PROVIDER_MODE: "fake", E2E_RUN_ID: runId, E2E_OBJECT_ROOT: tmpdir() },
    ];

    for (const environment of partials) {
      await expect(resolveWorkerProviderMode(environment)).rejects.toThrow(/E2E|fake|root|scope/i);
    }
  });

  it("derives mailbox, object and BullMQ namespaces from one validated run id", async () => {
    const root = await createRoot();
    await expect(
      resolveWorkerProviderMode({
        NODE_ENV: "test",
        E2E_PROVIDER_MODE: "fake",
        E2E_RUN_ID: runId,
        E2E_OBJECT_ROOT: root,
      }),
    ).resolves.toMatchObject({
      mode: "fake",
      runId,
      runRoot: path.join(root, runId),
      mailRoot: path.join(root, runId, "mail"),
      objectRoot: path.join(root, runId),
      queuePrefix: `pubg-camp:${runId}:bullmq`,
    });

    await expect(resolveWorkerProviderMode({ NODE_ENV: "production" })).resolves.toEqual({
      mode: "production",
      queuePrefix: "bull",
    });
  });
});

describe("FileEmailSender", () => {
  it("writes an idempotent, opaque mailbox entry beneath the run root with restrictive permissions", async () => {
    const root = await createRoot();
    const sender = await FileEmailSender.create({ root, runId });
    const request = {
      idempotencyKey: "otp:opaque-delivery-id",
      message: {
        to: "player@example.test",
        subject: "Seu código",
        html: "<p>12345678</p>",
        text: "12345678",
      },
    };

    const first = await sender.send(request);
    const second = await sender.send(request);
    const files = await readdir(path.join(root, runId, "mail"));

    expect(second).toEqual(first);
    expect(files).toHaveLength(1);
    expect(files[0]).not.toContain("player");
    expect(files[0]).not.toContain("opaque-delivery-id");
    const mailboxPath = path.join(root, runId, "mail", files[0] ?? "missing");
    expect(JSON.parse(await readFile(mailboxPath, "utf8"))).toEqual({
      idempotencyKey: request.idempotencyKey,
      message: request.message,
    });
    const mailboxMode = (await stat(mailboxPath)).mode;
    const directoryMode = (await stat(path.dirname(mailboxPath))).mode;
    if (process.platform === "win32") {
      expect(mailboxMode & 0o111).toBe(0);
      expect(directoryMode & 0o111).toBe(0);
    } else {
      expect(mailboxMode & 0o077).toBe(0);
      expect(directoryMode & 0o077).toBe(0);
    }
  });
});
