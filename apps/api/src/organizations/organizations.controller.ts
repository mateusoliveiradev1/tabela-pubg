import { Body, Controller, Get, Headers, Inject, Param, Post, Put, Req } from "@nestjs/common";
import type {
  CreateOrganizationResponse,
  OrganizationListResponse,
  OrganizationLogoMime,
  OrganizationLogoResponse,
} from "@pubg-camp/contracts";
import { ORGANIZATION_LOGO_MAX_BYTES } from "@pubg-camp/contracts";
import { RequirePermission } from "../authorization/decorators.js";
import type { SessionAlertRequest } from "../identity/identity.controller.js";
import type { OrganizationsService } from "./organizations.service.js";

export const ORGANIZATIONS_SERVICE = Symbol("ORGANIZATIONS_SERVICE");
export const ORGANIZATION_LOGO_MULTIPART_MAX_BYTES = ORGANIZATION_LOGO_MAX_BYTES + 16 * 1024;

export interface ParsedOrganizationMultipart {
  name?: string;
  logo?: {
    declaredMime: OrganizationLogoMime;
    byteSize: number;
    bytes: Buffer;
  };
}

@Controller("platform/organizations")
export class OrganizationsController {
  constructor(
    @Inject(ORGANIZATIONS_SERVICE)
    private readonly organizations: OrganizationsService,
  ) {}

  @Post()
  @RequirePermission("authenticated")
  create(
    @Body() body: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("content-type") contentType: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ): Promise<CreateOrganizationResponse> {
    if (isMultipart(contentType)) {
      if (!Buffer.isBuffer(body)) throw new Error("multipart body is unavailable");
      const parsed = parseOrganizationMultipart(body, contentType);
      if (!parsed.name) throw new Error("organization multipart name is required");
      return this.organizations.create({
        actorId: request.auth.actorId,
        body: {
          name: parsed.name,
          ...(parsed.logo
            ? {
                logo: {
                  declaredMime: parsed.logo.declaredMime,
                  byteSize: parsed.logo.byteSize,
                },
              }
            : {}),
        },
        ...(parsed.logo ? { logoBytes: parsed.logo.bytes } : {}),
        correlationId: safeCorrelationId(correlationId),
      });
    }
    return this.organizations.create({
      actorId: request.auth.actorId,
      body: body as never,
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Put(":organizationId/logo")
  @RequirePermission("organization:settings:manage")
  updateLogo(
    @Param("organizationId") organizationId: string,
    @Body() body: unknown,
    @Req() request: SessionAlertRequest,
    @Headers("content-type") contentType: string | undefined,
    @Headers("x-correlation-id") correlationId: string | undefined,
  ): Promise<OrganizationLogoResponse> {
    if (!isMultipart(contentType) || !Buffer.isBuffer(body)) {
      throw new Error("organization logo requires multipart/form-data");
    }
    const parsed = parseOrganizationMultipart(body, contentType);
    if (!parsed.logo || parsed.name !== undefined) {
      throw new Error("organization logo multipart must contain only one logo part");
    }
    return this.organizations.updateLogo({
      actorId: request.auth.actorId,
      organizationId,
      body: {
        logo: {
          declaredMime: parsed.logo.declaredMime,
          byteSize: parsed.logo.byteSize,
        },
      },
      logoBytes: parsed.logo.bytes,
      correlationId: safeCorrelationId(correlationId),
    });
  }

  @Get(":organizationId/logo")
  @RequirePermission("organization:read")
  getLogo(@Param("organizationId") organizationId: string, @Req() request: SessionAlertRequest) {
    return this.organizations.getLogo(request.auth.actorId, organizationId);
  }

  @Get()
  @RequirePermission("authenticated")
  list(@Req() request: SessionAlertRequest): Promise<OrganizationListResponse> {
    return this.organizations.list(request.auth.actorId);
  }
}

export async function collectOrganizationMultipartBody(
  payload: AsyncIterable<Uint8Array>,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of payload) {
    const bytes = Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > ORGANIZATION_LOGO_MULTIPART_MAX_BYTES) {
      throw new Error("organization multipart body exceeds the hard limit");
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, total);
}

export function parseOrganizationMultipart(
  body: Buffer,
  contentType: string,
): ParsedOrganizationMultipart {
  if (body.byteLength > ORGANIZATION_LOGO_MULTIPART_MAX_BYTES) {
    throw new Error("organization multipart body exceeds the hard limit");
  }
  const boundary = parseBoundary(contentType);
  const delimiter = Buffer.from(`--${boundary}`, "ascii");
  const nextDelimiter = Buffer.from(`\r\n--${boundary}`, "ascii");
  if (!body.subarray(0, delimiter.byteLength).equals(delimiter)) {
    throw new Error("invalid multipart opening boundary");
  }

  const result: ParsedOrganizationMultipart = {};
  let cursor = delimiter.byteLength;
  while (cursor < body.byteLength) {
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from("--"))) {
      const tail = body.subarray(cursor + 2);
      if (tail.byteLength !== 0 && !tail.equals(Buffer.from("\r\n"))) {
        throw new Error("invalid multipart closing boundary");
      }
      return result;
    }
    if (!body.subarray(cursor, cursor + 2).equals(Buffer.from("\r\n"))) {
      throw new Error("invalid multipart boundary separator");
    }
    cursor += 2;
    const headersEnd = body.indexOf(Buffer.from("\r\n\r\n"), cursor);
    if (headersEnd < 0 || headersEnd - cursor > 8 * 1024) {
      throw new Error("invalid multipart headers");
    }
    const headers = parsePartHeaders(body.toString("ascii", cursor, headersEnd));
    const contentStart = headersEnd + 4;
    const contentEnd = body.indexOf(nextDelimiter, contentStart);
    if (contentEnd < 0) throw new Error("unterminated multipart part");
    const content = body.subarray(contentStart, contentEnd);
    applyPart(result, headers, content);
    cursor = contentEnd + 2 + delimiter.byteLength;
  }
  throw new Error("multipart closing boundary is required");
}

function isMultipart(contentType: string | undefined): contentType is string {
  return /^multipart\/form-data(?:;|$)/i.test(contentType ?? "");
}

function parseBoundary(contentType: string): string {
  const match =
    /(?:^|;)\s*boundary=(?:"([A-Za-z0-9'()+_,./:=?-]{1,70})"|([A-Za-z0-9'()+_,./:=?-]{1,70}))(?:;|$)/i.exec(
      contentType,
    );
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary) throw new Error("multipart boundary is missing or invalid");
  return boundary;
}

function parsePartHeaders(source: string): { name: string; contentType?: string } {
  const lines = source.split("\r\n");
  const headerMap = new Map<string, string>();
  for (const line of lines) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error("invalid multipart header");
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (headerMap.has(key) || !["content-disposition", "content-type"].includes(key)) {
      throw new Error("duplicate or unsupported multipart header");
    }
    headerMap.set(key, value);
  }
  const disposition = headerMap.get("content-disposition");
  if (!disposition?.toLowerCase().startsWith("form-data;")) {
    throw new Error("multipart part must use form-data disposition");
  }
  const name = /(?:^|;)\s*name="([A-Za-z][A-Za-z0-9_-]{0,31})"(?:;|$)/i.exec(disposition)?.[1];
  if (!name) throw new Error("multipart part name is missing");
  const contentType = headerMap.get("content-type")?.toLowerCase();
  return { name, ...(contentType ? { contentType } : {}) };
}

function applyPart(
  result: ParsedOrganizationMultipart,
  headers: { name: string; contentType?: string },
  content: Buffer,
): void {
  if (headers.name === "name") {
    if (result.name !== undefined || headers.contentType !== undefined) {
      throw new Error("invalid duplicate organization name multipart part");
    }
    const name = new TextDecoder("utf-8", { fatal: true }).decode(content).trim();
    if (name.length < 2 || name.length > 120) throw new Error("invalid organization name");
    result.name = name;
    return;
  }
  if (headers.name === "logo") {
    if (result.logo !== undefined) throw new Error("duplicate organization logo multipart part");
    if (
      !(["image/png", "image/jpeg", "image/webp"] as const).includes(headers.contentType as never)
    ) {
      throw new Error("unsupported organization logo multipart MIME");
    }
    if (content.byteLength < 1 || content.byteLength > ORGANIZATION_LOGO_MAX_BYTES) {
      throw new Error("organization logo multipart part exceeds the hard limit");
    }
    result.logo = {
      declaredMime: headers.contentType as OrganizationLogoMime,
      byteSize: content.byteLength,
      bytes: Buffer.from(content),
    };
    return;
  }
  throw new Error("unsupported organization multipart field");
}

export function safeCorrelationId(value: string | undefined): string {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value ?? "",
  )
    ? (value as string)
    : "00000000-0000-4000-8000-000000000000";
}
