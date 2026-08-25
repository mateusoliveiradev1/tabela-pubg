const FLOW_QUERY_PARAMETER = "__stepUpFlow";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type OAuthStepUpNamespace = "identity" | "organization";

export interface OAuthStepUpFlow {
  namespace: OAuthStepUpNamespace;
  nonce: string;
  nextPath: string;
}

export function attachOAuthStepUpFlow(
  returnPath: string,
  namespace: OAuthStepUpNamespace,
  nonce: string,
): string {
  if (!isSafeReturnPath(returnPath) || !UUID.test(nonce)) {
    throw new Error("invalid OAuth step-up flow");
  }
  const url = new URL(returnPath, "https://pubg-camp.invalid");
  url.searchParams.set(FLOW_QUERY_PARAMETER, `${namespace}.${nonce}`);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function consumeOAuthStepUpFlow(returnPath: string): OAuthStepUpFlow | null {
  if (!isSafeReturnPath(returnPath)) return null;
  const url = new URL(returnPath, "https://pubg-camp.invalid");
  const values = url.searchParams.getAll(FLOW_QUERY_PARAMETER);
  if (values.length !== 1) return null;
  const match = /^(identity|organization)\.([0-9a-f-]{36})$/i.exec(values[0] ?? "");
  if (!match || !UUID.test(match[2] ?? "")) return null;
  url.searchParams.delete(FLOW_QUERY_PARAMETER);
  return {
    namespace: match[1] as OAuthStepUpNamespace,
    nonce: match[2] as string,
    nextPath: `${url.pathname}${url.search}${url.hash}`,
  };
}

function isSafeReturnPath(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}
