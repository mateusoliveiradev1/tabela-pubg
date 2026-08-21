import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

export const UploadPolicySchema = z.object({
  maxBytes: z
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  allowedMimeTypes: z.array(z.string().min(1)).min(1),
});

export const StorageNamespaceSchema = z.enum(["branding", "receipts", "exports"]);
export const ObjectKeySchema = z
  .string()
  .regex(
    /^(branding|receipts|exports)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    "Storage key must use a known namespace and opaque UUID segments",
  );

export type UploadPolicy = z.infer<typeof UploadPolicySchema>;
export type StorageNamespace = z.infer<typeof StorageNamespaceSchema>;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

export interface PutObjectInput {
  key: string;
  body: Uint8Array;
  contentType: string;
}

export function validateUpload(size: number, mimeType: string, policy: UploadPolicy): void {
  const parsed = UploadPolicySchema.parse(policy);
  if (size <= 0 || size > parsed.maxBytes) {
    throw new Error("Upload size is outside the allowed range");
  }
  if (!parsed.allowedMimeTypes.includes(mimeType)) {
    throw new Error("Upload MIME type is not allowed");
  }
}

export function createObjectKey(
  namespace: StorageNamespace,
  organizationId: string,
  objectId = crypto.randomUUID(),
): string {
  return ObjectKeySchema.parse(
    `${StorageNamespaceSchema.parse(namespace)}/${organizationId}/${objectId}`,
  );
}

export function createStorage(config: StorageConfig) {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  return {
    async putObject(input: PutObjectInput): Promise<void> {
      const safeKey = ObjectKeySchema.parse(input.key);
      await client.send(
        new PutObjectCommand({
          Bucket: config.bucket,
          Key: safeKey,
          Body: input.body,
          ContentType: input.contentType,
        }),
      );
    },
    async deleteObject(key: string): Promise<void> {
      const safeKey = ObjectKeySchema.parse(key);
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: safeKey }));
    },
    async createUploadUrl(key: string, contentType: string, expiresIn = 300): Promise<string> {
      const safeKey = ObjectKeySchema.parse(key);
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: config.bucket, Key: safeKey, ContentType: contentType }),
        { expiresIn },
      );
    },
    async createDownloadUrl(key: string, expiresIn = 300): Promise<string> {
      const safeKey = ObjectKeySchema.parse(key);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: safeKey }), {
        expiresIn,
      });
    },
    close(): void {
      client.destroy();
    },
  };
}

export * from "./organization-logo.js";
