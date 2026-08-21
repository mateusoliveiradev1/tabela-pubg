import { createStorage, type StorageConfig } from "@pubg-camp/storage";
import {
  type StoredOrganizationLogo,
  type StoreOrganizationLogoInput,
  storeOrganizationLogo,
} from "@pubg-camp/storage/organization-logo";
import type { OrganizationLogoStorage } from "../ports/organization-logo-storage.js";

export class S3OrganizationLogoStorage implements OrganizationLogoStorage {
  private readonly storage: ReturnType<typeof createStorage>;

  constructor(config: StorageConfig) {
    this.storage = createStorage(config);
  }

  store(input: StoreOrganizationLogoInput): Promise<StoredOrganizationLogo> {
    return storeOrganizationLogo(this.storage, input);
  }

  deleteObject(objectKey: string): Promise<void> {
    return this.storage.deleteObject(objectKey);
  }

  createDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string> {
    return this.storage.createDownloadUrl(objectKey, expiresInSeconds);
  }

  close(): void {
    this.storage.close();
  }
}
