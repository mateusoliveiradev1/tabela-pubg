import { type DynamicModule, Module } from "@nestjs/common";
import type { DatabaseConnection, EncryptionKey } from "@pubg-camp/database";
import type { TokenGenerator } from "../identity/ports/token-generator.js";
import { INVITATIONS_SERVICE, InvitationsController } from "./invitations.controller.js";
import { InvitationsService, PostgresInvitationRepository } from "./invitations.service.js";
import { MEMBERS_SERVICE, MembersController } from "./members.controller.js";
import {
  MembersService,
  PostgresMemberRepository,
  type RecentReauthenticationPort,
} from "./members.service.js";
import { ORGANIZATIONS_SERVICE, OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService, PostgresOrganizationRepository } from "./organizations.service.js";

export interface OrganizationsModuleOptions {
  database: DatabaseConnection["db"];
  encryptionKey: EncryptionKey;
  tokens: TokenGenerator;
  sessions: RecentReauthenticationPort;
  clock?: { now(): Date };
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules require a decorated class token.
export class OrganizationsModule {
  static register(options: OrganizationsModuleOptions): DynamicModule {
    const clock = options.clock ?? { now: () => new Date() };
    const organizations = new OrganizationsService(
      new PostgresOrganizationRepository(options.database),
      options.tokens,
      clock,
    );
    const invitations = new InvitationsService(
      new PostgresInvitationRepository(options.database, options.encryptionKey, () =>
        options.tokens.id(),
      ),
      options.tokens,
      clock,
    );
    const members = new MembersService(
      new PostgresMemberRepository(options.database, () => options.tokens.id()),
      options.sessions,
      clock,
    );
    return {
      module: OrganizationsModule,
      controllers: [OrganizationsController, InvitationsController, MembersController],
      providers: [
        { provide: ORGANIZATIONS_SERVICE, useValue: organizations },
        { provide: INVITATIONS_SERVICE, useValue: invitations },
        { provide: MEMBERS_SERVICE, useValue: members },
      ],
      exports: [ORGANIZATIONS_SERVICE, INVITATIONS_SERVICE, MEMBERS_SERVICE],
    };
  }
}
