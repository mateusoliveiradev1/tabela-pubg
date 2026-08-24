import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ObjectKeySchema } from "@pubg-camp/storage";
import {
  type StoredOrganizationLogo,
  type StoreOrganizationLogoInput,
  storeOrganizationLogo,
} from "@pubg-camp/storage/organization-logo";
import type { OrganizationLogoStorage } from "../ports/organization-logo-storage.js";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;

export interface E2EProviderEnvironment {
  E2E_PROVIDER_MODE?: string | undefined;
  NODE_ENV?: string | undefined;
  E2E_RUN_ID?: string | undefined;
}

export function assertE2EProviderEnvironment(environment: E2EProviderEnvironment): string {
  if (
    environment.E2E_PROVIDER_MODE !== "fake" ||
    environment.NODE_ENV !== "test" ||
    !environment.E2E_RUN_ID
  ) {
    throw new Error(
      "E2E fake providers require E2E_PROVIDER_MODE=fake, NODE_ENV=test and E2E_RUN_ID",
    );
  }
  if (!RUN_ID.test(environment.E2E_RUN_ID)) {
    throw new Error("E2E_RUN_ID must be an opaque run-scoped identifier");
  }
  return environment.E2E_RUN_ID;
}

export interface E2EOrganizationLogoStorageOptions {
  root: string;
  runId: string;
  publicBasePath: string;
}

export interface E2EStoredObject {
  bytes: Buffer;
  contentType: string;
  path: string;
}

export class E2EOrganizationLogoStorage implements OrganizationLogoStorage {
  private readonly runRoot: string;
  private readonly publicBasePath: string;

  constructor(options: E2EOrganizationLogoStorageOptions) {
    if (!RUN_ID.test(options.runId)) throw new Error("E2E_RUN_ID is invalid");
    if (!path.isAbsolute(options.root)) throw new Error("E2E object root must be absolute");
    assertE2EPublicBasePath(options.publicBasePath);
    this.runRoot = path.resolve(options.root, options.runId);
    this.publicBasePath = `${options.publicBasePath.replace(/\/$/, "")}/${options.runId}`;
  }

  store(input: StoreOrganizationLogoInput): Promise<StoredOrganizationLogo> {
    return storeOrganizationLogo(
      {
        putObject: async ({ key, body, contentType }) => {
          const objectPath = this.resolveObjectPath(key);
          await mkdir(path.dirname(objectPath), { recursive: true });
          await Promise.all([
            writeFile(objectPath, body, { flag: "wx" }),
            writeFile(`${objectPath}.mime`, contentType, { flag: "wx" }),
          ]);
        },
      },
      input,
    );
  }

  async deleteObject(objectKey: string): Promise<void> {
    const objectPath = this.resolveObjectPath(objectKey);
    await Promise.all([rm(objectPath, { force: true }), rm(`${objectPath}.mime`, { force: true })]);
  }

  async createDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    if (!Number.isInteger(expiresInSeconds) || expiresInSeconds < 1 || expiresInSeconds > 300) {
      throw new Error("E2E logo URL TTL is invalid");
    }
    this.resolveObjectPath(objectKey);
    return `${this.publicBasePath}/${Buffer.from(objectKey, "utf8").toString("base64url")}`;
  }

  async readObject(objectKey: string): Promise<E2EStoredObject | null> {
    const objectPath = this.resolveObjectPath(objectKey);
    try {
      const [bytes, contentType] = await Promise.all([
        readFile(objectPath),
        readFile(`${objectPath}.mime`, "utf8"),
      ]);
      return { bytes, contentType, path: objectPath };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  decodePublicObjectKey(encoded: string): string {
    if (!/^[A-Za-z0-9_-]{16,512}$/.test(encoded)) throw new Error("encoded object key is invalid");
    return ObjectKeySchema.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  }

  private resolveObjectPath(objectKey: string): string {
    const parsed = ObjectKeySchema.safeParse(objectKey);
    if (!parsed.success) throw new Error("E2E logo object key is invalid");
    const safeKey = parsed.data;
    const objectPath = path.resolve(this.runRoot, ...safeKey.split("/"));
    if (!objectPath.startsWith(`${this.runRoot}${path.sep}`)) {
      throw new Error("E2E logo object key escapes the run root");
    }
    return objectPath;
  }
}

function assertE2EPublicBasePath(candidate: string): void {
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return;
  const url = new URL(candidate);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" ||
    !url.port ||
    url.pathname !== "/objects" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("E2E public base path must be same-origin or exact loopback origin");
  }
}
