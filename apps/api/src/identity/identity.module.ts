import { type DynamicModule, Module } from "@nestjs/common";
import {
  IDENTITY_OAUTH_SERVICE,
  IDENTITY_OTP_SERVICE,
  IdentityController,
} from "./identity.controller.js";
import type { OAuthService } from "./oauth.service.js";
import type { OtpService } from "./otp.service.js";

export interface IdentityModuleServices {
  oauth: OAuthService;
  otp: OtpService;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules require a decorated class token.
export class IdentityModule {
  static register(services: IdentityModuleServices): DynamicModule {
    return {
      module: IdentityModule,
      controllers: [IdentityController],
      providers: [
        { provide: IDENTITY_OAUTH_SERVICE, useValue: services.oauth },
        { provide: IDENTITY_OTP_SERVICE, useValue: services.otp },
      ],
      exports: [IDENTITY_OAUTH_SERVICE, IDENTITY_OTP_SERVICE],
    };
  }
}
