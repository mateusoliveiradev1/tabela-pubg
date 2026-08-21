export type Brand<TValue, TBrand extends string> = TValue & { readonly __brand: TBrand };

export type OrganizationId = Brand<string, "OrganizationId">;
export type TournamentId = Brand<string, "TournamentId">;
export type MatchId = Brand<string, "MatchId">;

export interface DomainEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  readonly type: string;
  readonly version: number;
  readonly occurredAt: Date;
  readonly aggregateId: string;
  readonly payload: TPayload;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export * from "./identity.js";
export * from "./organizations.js";
