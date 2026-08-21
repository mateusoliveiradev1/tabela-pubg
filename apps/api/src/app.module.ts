import { type DynamicModule, Module } from "@nestjs/common";
import {
  AuthorizationModule,
  type AuthorizationModulePorts,
} from "./authorization/authorization.module.js";
import { HealthController } from "./health/health.controller.js";
import { HealthService } from "./health/health.service.js";
import {
  OrganizationsModule,
  type OrganizationsModuleOptions,
} from "./organizations/organizations.module.js";
import { CsrfController } from "./security/csrf.controller.js";
import { CsrfService } from "./security/csrf.service.js";

@Module({
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}

export interface AppModuleOptions {
  csrf: CsrfService;
  authorization: AuthorizationModulePorts;
  organizations: OrganizationsModuleOptions;
}

export function registerAppModule(options: AppModuleOptions): DynamicModule {
  return {
    module: AppModule,
    imports: [
      AuthorizationModule.register({ ...options.authorization, csrf: options.csrf }),
      OrganizationsModule.register(options.organizations),
    ],
    controllers: [CsrfController],
    providers: [{ provide: CsrfService, useValue: options.csrf }],
  };
}
