import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileLogoStorage } from "./file-logo-storage.js";

const runId = "run-fedcba9876543210fedcba98";
const objectKey = "branding/00000000-0000-4000-8000-000000000111/11111111-1111-4111-8111-111111111111";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("FileLogoStorage", () => {
  it("deletes only the exact object and mime sidecar inside its validated run root", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "pubg-camp-phase2-e2e-"));
    roots.push(root);
    const objectPath = path.join(root, runId, ...objectKey.split("/"));
    await mkdir(path.dirname(objectPath), { recursive: true, mode: 0o700 });
    await writeFile(objectPath, "image", { mode: 0o600 });
    await writeFile(`${objectPath}.mime`, "image/png", { mode: 0o600 });
    const foreignPath = path.join(root, "run-aaaaaaaaaaaaaaaaaaaaaaaa", "sentinel");
    await mkdir(path.dirname(foreignPath), { recursive: true, mode: 0o700 });
    await writeFile(foreignPath, "foreign", { mode: 0o600 });

    const storage = await FileLogoStorage.create({ root, runId });
    await storage.deleteObject(objectKey);
    await storage.deleteObject(objectKey);

    await expect(stat(objectPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(`${objectPath}.mime`)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(foreignPath)).resolves.toBeDefined();
  });

  it.each(["../outside", "branding/../../outside", "branding/not-a-valid-key"]) (
    "rejects %s before touching the filesystem",
    async (candidate) => {
      const root = await mkdtemp(path.join(tmpdir(), "pubg-camp-phase2-e2e-"));
      roots.push(root);
      const storage = await FileLogoStorage.create({ root, runId });
      await expect(storage.deleteObject(candidate)).rejects.toThrow(/object key/i);
    },
  );
});
