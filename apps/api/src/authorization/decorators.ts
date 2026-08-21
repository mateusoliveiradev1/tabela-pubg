import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@pubg-camp/authorization";

export const PUBLIC_ROUTE_KEY = "auth.public";
export const REQUIRED_PERMISSION_KEY = "auth.permission";

export type ApiPermission = Permission | "identity:session-alerts:resolve";

export const Public = () => SetMetadata(PUBLIC_ROUTE_KEY, true);
export const RequirePermission = (permission: ApiPermission) =>
  SetMetadata(REQUIRED_PERMISSION_KEY, permission);
