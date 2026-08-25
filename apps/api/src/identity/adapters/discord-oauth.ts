import * as oauth from "oauth4webapi";
import type {
  DiscordIdentityProvider,
  DiscordUserProfile,
  OAuthPurpose,
} from "../ports/discord-identity-provider.js";

const DISCORD_AUTHORIZATION_ENDPOINT = "https://discord.com/oauth2/authorize";
const DISCORD_TOKEN_ENDPOINT = "https://discord.com/api/oauth2/token";
const DISCORD_REVOCATION_ENDPOINT = "https://discord.com/api/oauth2/token/revoke";
const DISCORD_CURRENT_USER_ENDPOINT = "https://discord.com/api/users/@me";
const OAUTH_VERIFIER_LIFETIME_MS = 10 * 60_000;

export type DiscordPkceMode = "required" | "documented-exception";

export interface DiscordOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  pkceMode: DiscordPkceMode;
  pkceExceptionId?: string;
}

export interface DiscordOAuthVerifierRecord {
  mode: DiscordPkceMode;
  redirectUri: string;
  codeVerifier?: string;
  expiresAt: Date;
}

export interface DiscordOAuthVerifierStore {
  save(state: string, record: DiscordOAuthVerifierRecord): Promise<void>;
  consume(state: string): Promise<DiscordOAuthVerifierRecord | null>;
}

export interface DiscordOAuthAdapterOptions {
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}

const authorizationServer: oauth.AuthorizationServer = {
  issuer: "https://discord.com",
  authorization_endpoint: DISCORD_AUTHORIZATION_ENDPOINT,
  token_endpoint: DISCORD_TOKEN_ENDPOINT,
  revocation_endpoint: DISCORD_REVOCATION_ENDPOINT,
  code_challenge_methods_supported: ["S256"],
};

export class DiscordOAuthAdapter implements DiscordIdentityProvider {
  private readonly client: oauth.Client;
  private readonly clientAuthentication: oauth.ClientAuth;
  private readonly fetch: typeof globalThis.fetch;
  private readonly now: () => Date;
  private readonly oauthFetch = async <Method, Body>(
    url: string,
    options: oauth.CustomFetchOptions<Method, Body>,
  ): Promise<Response> => this.fetch(url, options as unknown as RequestInit);

  constructor(
    private readonly config: DiscordOAuthConfig,
    private readonly verifierStore: DiscordOAuthVerifierStore,
    options: DiscordOAuthAdapterOptions = {},
  ) {
    validateConfig(config);
    this.client = { client_id: config.clientId };
    this.clientAuthentication = oauth.ClientSecretPost(config.clientSecret);
    this.fetch = options.fetch ?? globalThis.fetch;
    this.now = options.now ?? (() => new Date());
  }

  async start(input: {
    state: string;
    purpose: OAuthPurpose;
  }): Promise<{ authorizationUrl: string }> {
    if (input.state.trim().length === 0) {
      throw new Error("oauth transaction unavailable");
    }

    const authorizationUrl = new URL(DISCORD_AUTHORIZATION_ENDPOINT);
    authorizationUrl.searchParams.set("client_id", this.config.clientId);
    authorizationUrl.searchParams.set("response_type", "code");
    authorizationUrl.searchParams.set("redirect_uri", this.config.redirectUri);
    authorizationUrl.searchParams.set("scope", "identify email");
    authorizationUrl.searchParams.set("state", input.state);

    const record: DiscordOAuthVerifierRecord = {
      mode: this.config.pkceMode,
      redirectUri: this.config.redirectUri,
      expiresAt: new Date(this.now().getTime() + OAUTH_VERIFIER_LIFETIME_MS),
    };
    if (this.config.pkceMode === "required") {
      const codeVerifier = oauth.generateRandomCodeVerifier();
      record.codeVerifier = codeVerifier;
      authorizationUrl.searchParams.set(
        "code_challenge",
        await oauth.calculatePKCECodeChallenge(codeVerifier),
      );
      authorizationUrl.searchParams.set("code_challenge_method", "S256");
    }

    await this.verifierStore.save(input.state, record);
    return { authorizationUrl: authorizationUrl.toString() };
  }

  async exchange(input: { code: string; state: string }): Promise<{ accessToken: string }> {
    if (input.code.trim().length === 0 || input.state.trim().length === 0) {
      throw new Error("oauth transaction unavailable");
    }

    const record = await this.verifierStore.consume(input.state);
    if (
      record === null ||
      record.expiresAt <= this.now() ||
      record.mode !== this.config.pkceMode ||
      !isValidRedirectUri(record.redirectUri) ||
      (record.mode === "required" && record.codeVerifier === undefined)
    ) {
      throw new Error("oauth transaction unavailable");
    }

    try {
      const callbackParameters = oauth.validateAuthResponse(
        authorizationServer,
        this.client,
        new URLSearchParams({ code: input.code, state: input.state }),
        input.state,
      );
      const response = await oauth.authorizationCodeGrantRequest(
        authorizationServer,
        this.client,
        this.clientAuthentication,
        callbackParameters,
        record.redirectUri,
        record.mode === "required" ? (record.codeVerifier as string) : oauth.nopkce,
        { [oauth.customFetch]: this.oauthFetch },
      );
      const tokens = await oauth.processAuthorizationCodeResponse(
        authorizationServer,
        this.client,
        response,
      );
      return { accessToken: tokens.access_token };
    } catch {
      throw new Error("discord oauth exchange failed");
    }
  }

  async fetchUser(accessToken: string): Promise<DiscordUserProfile> {
    if (accessToken.length === 0) throw new Error("discord profile unavailable");
    try {
      const response = await oauth.protectedResourceRequest(
        accessToken,
        "GET",
        new URL(DISCORD_CURRENT_USER_ENDPOINT),
        new Headers({ accept: "application/json" }),
        undefined,
        { [oauth.customFetch]: this.oauthFetch },
      );
      if (!response.ok) throw new Error("provider rejected profile request");
      return parseDiscordUser(await response.json());
    } catch {
      throw new Error("discord profile unavailable");
    }
  }

  async revoke(accessToken: string): Promise<void> {
    if (accessToken.length === 0) return;
    try {
      const response = await oauth.revocationRequest(
        authorizationServer,
        this.client,
        this.clientAuthentication,
        accessToken,
        {
          additionalParameters: { token_type_hint: "access_token" },
          [oauth.customFetch]: this.oauthFetch,
        },
      );
      await oauth.processRevocationResponse(response);
    } catch {
      throw new Error("discord token revocation failed");
    }
  }

  securityWarning(): string {
    return this.config.pkceMode === "documented-exception"
      ? "Discord PKCE documented exception is active."
      : "";
  }
}

function validateConfig(config: DiscordOAuthConfig): void {
  if (!/^\d{17,20}$/.test(config.clientId) || config.clientSecret.length < 32) {
    throw new Error("invalid Discord OAuth configuration");
  }
  const redirectUri = new URL(config.redirectUri);
  if (
    !["http:", "https:"].includes(redirectUri.protocol) ||
    redirectUri.username.length > 0 ||
    redirectUri.password.length > 0 ||
    redirectUri.hash.length > 0
  ) {
    throw new Error("invalid Discord OAuth configuration");
  }
  if (
    config.pkceMode === "documented-exception" &&
    (config.pkceExceptionId === undefined || config.pkceExceptionId.trim().length === 0)
  ) {
    throw new Error("documented PKCE exception requires evidence");
  }
  if (config.pkceMode === "required" && config.pkceExceptionId !== undefined) {
    throw new Error("PKCE exception evidence is forbidden in required mode");
  }
}

function isValidRedirectUri(value: string): boolean {
  try {
    const redirectUri = new URL(value);
    return (
      ["http:", "https:"].includes(redirectUri.protocol) &&
      redirectUri.username.length === 0 &&
      redirectUri.password.length === 0 &&
      redirectUri.hash.length === 0
    );
  } catch {
    return false;
  }
}

function parseDiscordUser(value: unknown): DiscordUserProfile {
  if (typeof value !== "object" || value === null) throw new Error("invalid Discord profile");
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.id !== "string" ||
    !/^\d{17,20}$/.test(candidate.id) ||
    typeof candidate.username !== "string" ||
    candidate.username.trim().length === 0 ||
    candidate.username.length > 80
  ) {
    throw new Error("invalid Discord profile");
  }
  const email =
    typeof candidate.email === "string" ? candidate.email.trim().toLowerCase() : undefined;
  return {
    id: candidate.id,
    username: candidate.username,
    ...(email === undefined || email.length === 0 ? {} : { email }),
    emailVerified: candidate.verified === true,
  };
}
