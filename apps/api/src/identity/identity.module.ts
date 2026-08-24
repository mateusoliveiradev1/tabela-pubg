import { type DynamicModule, Module } from "@nestjs/common";
import type { CsrfService } from "../security/csrf.service.js";
import {
  IDENTITY_CSRF_SERVICE,
  IDENTITY_OAUTH_SERVICE,
  IDENTITY_OTP_SERVICE,
  IDENTITY_SERVICE,
  IDENTITY_SESSION_SERVICE,
  IdentityController,
  SessionAlertContextController,
} from "./identity.controller.js";
import type { IdentitySecurityChangeApplicationPort, IdentityService } from "./identity.service.js";
import { IdentityManagementController } from "./identity-management.controller.js";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";
import { SessionController } from "./session.controller.js";
import type { SessionService } from "./session.service.js";

export const IDENTITY_SECURITY_CHANGE_PORT = Symbol("IDENTITY_SECURITY_CHANGE_PORT");

export interface IdentityModuleServices {
  oauth: OAuthService;
  otp: OtpService;
  identity: IdentityService;
  session: SessionService;
  csrf: CsrfService;
  securityChanges?: IdentitySecurityChangeApplicationPort;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules require a decorated class token.
export class IdentityModule {
  static register(services: IdentityModuleServices): DynamicModule {
    return {
      module: IdentityModule,
      controllers: [
        IdentityController,
        SessionAlertContextController,
        SessionController,
        IdentityManagementController,
      ],
      providers: [
        { provide: IDENTITY_OAUTH_SERVICE, useValue: services.oauth },
        { provide: IDENTITY_OTP_SERVICE, useValue: services.otp },
        { provide: IDENTITY_SERVICE, useValue: services.identity },
        { provide: IDENTITY_SESSION_SERVICE, useValue: services.session },
        { provide: IDENTITY_CSRF_SERVICE, useValue: services.csrf },
        ...(services.securityChanges === undefined
          ? []
          : [{ provide: IDENTITY_SECURITY_CHANGE_PORT, useValue: services.securityChanges }]),
      ],
      exports: [
        IDENTITY_OAUTH_SERVICE,
        IDENTITY_OTP_SERVICE,
        IDENTITY_SERVICE,
        IDENTITY_SESSION_SERVICE,
        IDENTITY_CSRF_SERVICE,
        ...(services.securityChanges === undefined ? [] : [IDENTITY_SECURITY_CHANGE_PORT]),
      ],
    };
  }
}
