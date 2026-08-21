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
}

export type SessionAuthenticator = (opaqueToken: string) => Promise<AuthenticatedSession | null>;
export type AuthorizationSnapshotLoader = (input: {
  actorId: string;
  organizationId: string;
}) => Promise<AuthorizationSnapshot>;

export const SESSION_AUTHENTICATOR = Symbol("SESSION_AUTHENTICATOR");
export const AUTHORIZATION_SNAPSHOT_LOADER = Symbol("AUTHORIZATION_SNAPSHOT_LOADER");

@Injectable()
export class AuthorizationService {
  constructor(
    @Inject(SESSION_AUTHENTICATOR)
    private readonly authenticateSession: SessionAuthenticator,
    @Inject(AUTHORIZATION_SNAPSHOT_LOADER)
    private readonly loadSnapshot: AuthorizationSnapshotLoader,
  ) {}

  authenticate(opaqueToken: string): Promise<AuthenticatedSession | null> {
    return this.authenticateSession(opaqueToken);
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
