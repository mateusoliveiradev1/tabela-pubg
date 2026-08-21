export type OAuthPurpose = "sign-in" | "link-identity" | "step-up";

export interface DiscordUserProfile {
  id: string;
  username: string;
  email?: string;
  emailVerified: boolean;
}

export interface DiscordIdentityProvider {
  start(input: { state: string; purpose: OAuthPurpose }): Promise<{ authorizationUrl: string }>;
  exchange(input: { code: string }): Promise<{ accessToken: string }>;
  fetchUser(accessToken: string): Promise<DiscordUserProfile>;
  revoke(accessToken: string): Promise<void>;
}
