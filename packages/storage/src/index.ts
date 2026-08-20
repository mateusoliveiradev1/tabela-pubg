import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { z } from "zod";

export const UploadPolicySchema = z.object({
  maxBytes: z
    .int()
    .positive()
    .max(20 * 1024 * 1024),
  allowedMimeTypes: z.array(z.string().min(1)).min(1),
});

export type UploadPolicy = z.infer<typeof UploadPolicySchema>;

export interface StorageConfig {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
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
    async createUploadUrl(key: string, contentType: string, expiresIn = 300): Promise<string> {
      return getSignedUrl(
        client,
        new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: contentType }),
        { expiresIn },
      );
    },
    async createDownloadUrl(key: string, expiresIn = 300): Promise<string> {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn,
      });
    },
    close(): void {
      client.destroy();
    },
  };
}
