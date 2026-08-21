import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import type { CsrfService } from "../security/csrf.service.js";
import { CsrfGuard } from "../security/csrf.service.js";
import {
  AUTHORIZATION_SNAPSHOT_LOADER,
  AuthorizationService,
  type AuthorizationSnapshotLoader,
  SESSION_AUTHENTICATOR,
  type SessionAuthenticator,
} from "./authorization.service.js";
import { PermissionGuard } from "./permission.guard.js";
import { SESSION_COOKIE_NAME, SessionGuard } from "./session.guard.js";

export interface AuthorizationModulePorts {
  authenticate: SessionAuthenticator;
  loadSnapshot: AuthorizationSnapshotLoader;
  csrf?: CsrfService;
  sessionCookieName?: string;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules require a decorated class token.
export class AuthorizationModule {
  static register(ports: AuthorizationModulePorts): DynamicModule {
    return {
      module: AuthorizationModule,
      providers: [
        { provide: SESSION_AUTHENTICATOR, useValue: ports.authenticate },
        { provide: AUTHORIZATION_SNAPSHOT_LOADER, useValue: ports.loadSnapshot },
        { provide: SESSION_COOKIE_NAME, useValue: ports.sessionCookieName ?? "__Host-session" },
        AuthorizationService,
        { provide: APP_GUARD, useClass: SessionGuard },
        ...(ports.csrf
          ? [
              { provide: CsrfGuard, useFactory: () => new CsrfGuard(ports.csrf as CsrfService) },
              { provide: APP_GUARD, useExisting: CsrfGuard },
            ]
          : []),
        { provide: APP_GUARD, useClass: PermissionGuard },
      ],
      exports: [AuthorizationService],
    };
  }
}
