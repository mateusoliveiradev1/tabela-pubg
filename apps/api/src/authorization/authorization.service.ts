import { Inject, Injectable } from "@nestjs/common";
import {
  type AuthorizationInput,
  type AuthorizationSnapshot,
  can,
  type Permission,
} from "@pubg-camp/authorization";

export interface AuthenticatedSession {
  actorId: string;
  sessionId: string;
  trust: "provisional" | "trusted";
}

export interface AuthorizationSecurityEvent {
  category: "authorization-provisional-denied";
  correlationId: string;
  actorId: string;
  sessionId: string;
}

export interface AuthorizationSecurityLog {
  record(event: AuthorizationSecurityEvent): void;
}

export type SessionAuthenticator = (opaqueToken: string) => Promise<AuthenticatedSession | null>;
export type AuthorizationSnapshotLoader = (input: {
  actorId: string;
  organizationId: string;
}) => Promise<AuthorizationSnapshot>;

export const SESSION_AUTHENTICATOR = Symbol("SESSION_AUTHENTICATOR");
export const AUTHORIZATION_SNAPSHOT_LOADER = Symbol("AUTHORIZATION_SNAPSHOT_LOADER");
export const AUTHORIZATION_SECURITY_LOG = Symbol("AUTHORIZATION_SECURITY_LOG");

@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(SESSION_AUTHENTICATOR)
    private readonly authenticateSession: SessionAuthenticator,
    @Inject(AUTHORIZATION_SNAPSHOT_LOADER)
    private readonly loadSnapshot: AuthorizationSnapshotLoader,
    @Inject(AUTHORIZATION_SECURITY_LOG)
    private readonly securityLog: AuthorizationSecurityLog,
  ) {}

  authenticate(opaqueToken: string): Promise<AuthenticatedSession | null> {
    return this.authenticateSession(opaqueToken);
  }

  recordProvisionalDenied(input: Omit<AuthorizationSecurityEvent, "category">): void {
    this.securityLog.record({
      category: "authorization-provisional-denied",
      correlationId: input.correlationId,
      actorId: input.actorId,
      sessionId: input.sessionId,
    });
  }

  async can(input: {
    actorId: string;
    organizationId: string;
    authorizationScopeId?: string;
    permission: Permission;
  }): Promise<boolean> {
    const snapshot = await this.loadSnapshot({
      actorId: input.actorId,
      organizationId: input.organizationId,
    });
    return can(input as AuthorizationInput, snapshot);
  }
}
