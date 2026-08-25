import path from "node:path";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const BROAD_RUN_ID = /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;
const OWNED_ROOT_PREFIX = "pubg-camp-phase2-e2e-";

type Phase2AuthEnvironment = Pick<
  NodeJS.ProcessEnv,
  "E2E_RUN_ID" | "E2E_OBJECT_ROOT" | "E2E_BROWSER_AUTH_MODE"
>;

export interface Phase2FixtureState {
  organizationId: string;
  organizationSlug: string;
  organizationName: string;
  invitationContext: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INVITATION_CONTEXT = /^[A-Za-z0-9_-]{16,512}$/;

export function phase2AuthStatePath(environment: Phase2AuthEnvironment): string {
  const runId = environment.E2E_RUN_ID;
  if (!runId || !RUN_ID.test(runId) || BROAD_RUN_ID.test(runId)) {
    throw new Error("phase 2 auth state requires a validated run scope");
  }
  const root = environment.E2E_OBJECT_ROOT;
  if (!root || !path.isAbsolute(root) || !path.basename(root).startsWith(OWNED_ROOT_PREFIX)) {
    throw new Error("phase 2 auth state requires an owned root");
  }
  const runRoot = path.resolve(root, runId);
  if (!runRoot.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error("phase 2 auth state escaped its owned root");
  }
  return path.join(runRoot, "playwright-auth-state.json");
}

export function phase2FixtureStatePath(environment: Phase2AuthEnvironment): string {
  return path.join(path.dirname(phase2AuthStatePath(environment)), "playwright-fixture-state.json");
}

export function parsePhase2FixtureState(raw: string): Phase2FixtureState {
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("phase 2 fixture state must be an object");
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.organizationId !== "string" ||
    !UUID.test(candidate.organizationId) ||
    typeof candidate.organizationSlug !== "string" ||
    !SLUG.test(candidate.organizationSlug) ||
    typeof candidate.organizationName !== "string" ||
    candidate.organizationName.length < 2 ||
    candidate.organizationName.length > 120 ||
    typeof candidate.invitationContext !== "string" ||
    !INVITATION_CONTEXT.test(candidate.invitationContext)
  ) {
    throw new Error("phase 2 fixture state is invalid");
  }
  return {
    organizationId: candidate.organizationId,
    organizationSlug: candidate.organizationSlug,
    organizationName: candidate.organizationName,
    invitationContext: candidate.invitationContext,
  };
}

export function shouldBootstrapPhase2Auth(environment: Phase2AuthEnvironment): boolean {
  return environment.E2E_BROWSER_AUTH_MODE !== "runtime";
}

export function otpCodeFromMailbox(
  message: string,
  recipient: string,
  challengeId: string,
): string | null {
  if (!message.includes(recipient) || !message.includes(challengeId)) return null;
  return /\b(\d{8})\b/.exec(message)?.[1] ?? null;
}
