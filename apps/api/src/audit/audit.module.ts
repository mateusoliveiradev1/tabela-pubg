import { type DynamicModule, Module } from "@nestjs/common";
import type { DatabaseConnection } from "@pubg-camp/database";
import { AUDIT_SERVICE, AuditController } from "./audit.controller.js";
import { AuditService, PostgresAuditRepository } from "./audit.service.js";

export interface AuditModuleOptions {
  database: DatabaseConnection["db"];
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules require a decorated class token.
export class AuditModule {
  static register(options: AuditModuleOptions): DynamicModule {
    const audit = new AuditService(new PostgresAuditRepository(options.database));
    return {
      module: AuditModule,
      controllers: [AuditController],
      providers: [{ provide: AUDIT_SERVICE, useValue: audit }],
      exports: [AUDIT_SERVICE],
    };
  }
}
