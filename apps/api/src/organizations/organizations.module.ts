import { type DynamicModule, Module } from "@nestjs/common";
import type { DatabaseConnection, EncryptionKey } from "@pubg-camp/database";
import type { TokenGenerator } from "../identity/ports/token-generator.js";
import {
  assertE2EProviderEnvironment,
  E2EOrganizationLogoStorage,
  type E2EProviderEnvironment,
} from "./adapters/e2e-organization-logo-storage.js";
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
import type { OrganizationLogoStorage } from "./ports/organization-logo-storage.js";

export interface OrganizationsModuleOptions {
  database: DatabaseConnection["db"];
  encryptionKey: EncryptionKey;
  tokens: TokenGenerator;
  sessions: RecentReauthenticationPort;
  logoStorage?: OrganizationLogoStorage;
  logoFallbackUrl: string;
  logoSignedUrlTtlSeconds?: number;
  clock?: { now(): Date };
  environment?: E2EProviderEnvironment;
  e2eObjectRoot?: string;
  e2eLogoPublicBasePath?: string;
}

@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: Nest dynamic modules require a decorated class token.
export class OrganizationsModule {
  static register(options: OrganizationsModuleOptions): DynamicModule {
    const clock = options.clock ?? { now: () => new Date() };
    const environment = options.environment ?? process.env;
    const logoStorage = resolveLogoStorage(options, environment);
    const organizations = new OrganizationsService(
      new PostgresOrganizationRepository(options.database),
      options.tokens,
      clock,
      logoStorage,
      {
        fallbackUrl: options.logoFallbackUrl,
        signedUrlTtlSeconds: options.logoSignedUrlTtlSeconds ?? 300,
      },
    );
    const invitations = new InvitationsService(
      new PostgresInvitationRepository(options.database, options.encryptionKey, () =>
        options.tokens.id(),
      ),
      options.tokens,
      clock,
      { resolve: (organizationId) => organizations.publicLogoUrl(organizationId) },
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

export function resolveLogoStorage(
  options: OrganizationsModuleOptions,
  environment: E2EProviderEnvironment = process.env,
): OrganizationLogoStorage {
  if (environment.E2E_PROVIDER_MODE === "fake") {
    const runId = assertE2EProviderEnvironment(environment);
    if (!options.e2eObjectRoot)
      throw new Error("E2E_OBJECT_ROOT is required for fake logo storage");
    return new E2EOrganizationLogoStorage({
      root: options.e2eObjectRoot,
      runId,
      publicBasePath: options.e2eLogoPublicBasePath ?? "/api/platform/__e2e/logos",
    });
  }
  if (!options.logoStorage) throw new Error("organization logo storage is required");
  return options.logoStorage;
}
