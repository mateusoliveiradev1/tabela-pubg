import path from "node:path";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const BROAD_RUN_ID = /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;
const OWNED_ROOT_PREFIX = "pubg-camp-phase2-e2e-";

type Phase2AuthEnvironment = Pick<
  NodeJS.ProcessEnv,
  "E2E_RUN_ID" | "E2E_OBJECT_ROOT" | "E2E_BROWSER_AUTH_MODE"
>;

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
