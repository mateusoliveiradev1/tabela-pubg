import { type DynamicModule, Module } from "@nestjs/common";
import type { CsrfService } from "../security/csrf.service.js";
import {
  IDENTITY_CSRF_SERVICE,
  IDENTITY_OAUTH_SERVICE,
  IDENTITY_OTP_SERVICE,
  IDENTITY_SESSION_SERVICE,
  IdentityController,
  SessionAlertContextController,
} from "./identity.controller.js";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";
import type { SessionService } from "./session.service.js";

export interface IdentityModuleServices {
  oauth: OAuthService;
  otp: OtpService;
  session: SessionService;
  csrf: CsrfService;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules require a decorated class token.
export class IdentityModule {
  static register(services: IdentityModuleServices): DynamicModule {
    return {
      module: IdentityModule,
      controllers: [IdentityController, SessionAlertContextController],
      providers: [
        { provide: IDENTITY_OAUTH_SERVICE, useValue: services.oauth },
        { provide: IDENTITY_OTP_SERVICE, useValue: services.otp },
        { provide: IDENTITY_SESSION_SERVICE, useValue: services.session },
        { provide: IDENTITY_CSRF_SERVICE, useValue: services.csrf },
      ],
      exports: [
        IDENTITY_OAUTH_SERVICE,
        IDENTITY_OTP_SERVICE,
        IDENTITY_SESSION_SERVICE,
        IDENTITY_CSRF_SERVICE,
      ],
    };
  }
}
