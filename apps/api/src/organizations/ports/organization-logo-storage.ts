import type {
  StoredOrganizationLogo,
  StoreOrganizationLogoInput,
} from "@pubg-camp/storage/organization-logo";

export interface OrganizationLogoStorage {
  store(input: StoreOrganizationLogoInput): Promise<StoredOrganizationLogo>;
  deleteObject(objectKey: string): Promise<void>;
  createDownloadUrl(objectKey: string, expiresInSeconds: number): Promise<string>;
  close?(): void;
}
