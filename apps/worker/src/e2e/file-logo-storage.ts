import { rm } from "node:fs/promises";
import { ObjectKeySchema } from "@pubg-camp/storage";
import type { StorageObjectDeleter } from "../storage/logo-cleanup.processor.js";
import { resolveInside, resolveWorkerProviderMode } from "./file-email-sender.js";

export class FileLogoStorage implements StorageObjectDeleter {
  private constructor(private readonly runRoot: string) {}

  static async create(options: { root: string; runId: string }): Promise<FileLogoStorage> {
    const scope = await resolveWorkerProviderMode({
      NODE_ENV: "test",
      E2E_PROVIDER_MODE: "fake",
      E2E_RUN_ID: options.runId,
      E2E_OBJECT_ROOT: options.root,
    });
    if (scope.mode !== "fake") throw new Error("E2E object scope is unavailable");
    return new FileLogoStorage(scope.objectRoot);
  }

  async deleteObject(candidate: string): Promise<void> {
    const parsed = ObjectKeySchema.safeParse(candidate);
    if (!parsed.success || !parsed.data.startsWith("branding/")) {
      throw new Error("E2E logo object key is invalid");
    }
    const objectPath = resolveInside(this.runRoot, ...parsed.data.split("/"));
    await Promise.all([rm(objectPath, { force: true }), rm(`${objectPath}.mime`, { force: true })]);
  }

  close(): void {}
}
