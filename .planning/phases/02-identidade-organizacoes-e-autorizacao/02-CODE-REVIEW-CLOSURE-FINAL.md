---
phase: 02-identidade-organizacoes-e-autorizacao
reviewed: 2026-08-25T07:44:09Z
depth: deep
diff: aff81da..6e78027
files_reviewed: 31
files_reviewed_list:
  - apps/api/src/identity/adapters/discord-oauth.ts
  - apps/api/src/identity/identity.controller.spec.ts
  - apps/api/src/identity/identity.controller.ts
  - apps/api/src/identity/identity.module.ts
  - apps/api/src/identity/identity.runtime.spec.ts
  - apps/api/src/identity/identity.runtime.ts
  - apps/api/src/identity/oauth.service.ts
  - apps/api/src/identity/otp.service.spec.ts
  - apps/api/src/identity/otp.service.ts
  - apps/api/src/organizations/provisional-promotion.integration.spec.ts
  - apps/api/src/security/csrf.service.ts
  - apps/web/e2e/phase2-runtime.spec.ts
  - apps/web/src/app/api/platform/[...path]/route.ts
  - apps/web/src/components/authorization/confirm-sensitive-action-dialog.tsx
  - apps/web/src/components/authorization/sensitive-action-continuation.spec.ts
  - apps/web/src/components/authorization/sensitive-action-continuation.ts
  - apps/web/src/components/identity/account.spec.tsx
  - apps/web/src/components/identity/auth.spec.tsx
  - apps/web/src/components/identity/identity-action-continuation.spec.ts
  - apps/web/src/components/identity/identity-action-continuation.ts
  - apps/web/src/components/identity/identity-cards.tsx
  - apps/web/src/components/identity/oauth-callback-form.tsx
  - apps/web/src/components/identity/oauth-step-up-flow.ts
  - apps/web/src/components/organizations/organization-management.spec.tsx
  - packages/contracts/src/platform-route-inventory.ts
  - packages/database/src/index.ts
  - packages/database/src/repositories/identity-security-change.ts
  - packages/database/src/repositories/identity.ts
  - packages/database/src/repositories/index.ts
  - packages/database/test/identity-organizations.integration.spec.ts
  - packages/database/test/identity-security-change.integration.spec.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
status: clean
---

# Phase 02: Final Closure Code Review

**Reviewed:** 2026-08-25T07:44:09Z
**Depth:** deep
**Diff:** `aff81da..6e78027`
**Status:** clean

## Summary

The final closure fixes remove the three integration gaps identified below. Protected OTP requests now return an indistinguishable opaque handle for owner and foreign-email paths while only the owned path persists or delivers. A committed upstream step-up is always forwarded with its rotated cookies even when convenience-token reacquisition fails. Discord now uses a unified callback whose purpose and exact redirect URI are recovered from the one-shot server-side transaction rather than a browser query parameter.

Final verification after remediation:

- `pnpm ci:verify`: passed, including secrets, migrations, CI structure, lint, boundaries, typecheck, unit/component tests, and all 13 builds.
- PostgreSQL/Redis integration: 60/60 passed; concurrency 4/4; dedicated Redis 6/6.
- Chromium runtime: 7/7 passed in 3.4 minutes, following the provider's real `redirect_uri` without injecting `purpose`.
- API focused: 41/41; web focused: 52/52; contracts: 19/19.

## Narrative Findings (AI reviewer)

## Critical Issues

### [RESOLVED] CR-CLOSURE-FINAL-01: Foreign-email rejection is observable through the OTP challenge header

**Classification:** BLOCKER

**Files:** `packages/database/src/repositories/identity.ts:455-483`; `apps/api/src/identity/otp.service.ts:172-194`; `apps/api/src/identity/identity.controller.ts:424-435`

**Issue:** The repository correctly returns `false` without challenge, delivery, or outbox mutation when a step-up email is not owned by the actor. That boolean is then exposed across two layers: `OtpService.request` includes `challengeId` only when `issued` is true, and `requestProtectedOtp` adds `x-otp-challenge-id` only when that optional value exists. For an active verified email owned by the actor the header is present; for a foreign address it is absent, while both bodies say `accepted`.

An authenticated session holder can therefore test arbitrary addresses and learn which email identity belongs to the account. This directly contradicts the closure claim that the response is non-enumerating. The new integration test proves database non-mutation but stops at the repository boolean and never compares the owner and foreign HTTP responses.

**Fix:** Decouple the externally returned correlation handle from persistence. Return an indistinguishable opaque challenge handle/header for every syntactically valid, bound accepted request, including non-owner and throttled paths, while persisting/delivering only the real owner challenge. A fake handle must be unresolvable during verification. Add an API+BFF contract test asserting identical status, body, and header shape for owner versus foreign emails, together with the existing zero-mutation assertions.

**Resolution:** Implemented in `12dc4ad`. Owner and foreign requests now have the same HTTP shape and opaque UUID header; fake handles cannot resolve, and repository tests preserve zero challenge/delivery/outbox mutation for foreign addresses.

### [RESOLVED] CR-CLOSURE-FINAL-02: CSRF reacquisition can still report failure after email step-up has committed

**Classification:** BLOCKER

**Files:** `packages/database/src/repositories/identity.ts:1016-1028`; `apps/api/src/identity/identity.controller.ts:373-379`; `apps/web/src/app/api/platform/[...path]/route.ts:137-146`

**Issue:** OTP consumption and `sessions.reauthenticated_at` now commit atomically, and the API prepares rotated cookies. However, the BFF performs a second network call to reacquire CSRF after the successful upstream mutation. If that call times out or returns an invalid response, line 142 returns a fresh 502 response and discards both the upstream success body and its `Set-Cookie` headers.

The client consequently sees "invalid or expired code" even though the OTP is consumed and the session is already fresh. Because the rotated CSRF cookie never reaches the browser, the browser retains the prior CSRF context. This recreates the exact split-brain state CR-CLOSURE-02 was intended to remove, merely moving the fallible second step from the controller to the BFF.

**Fix:** Do not replace a committed upstream success with 502. Prefer returning the rotated CSRF token and cookies in the same API response so the BFF only forwards them. If the secondary reacquisition remains, forward the successful upstream response and all rotated cookies when reacquisition fails, omit the convenience token header, and let the client explicitly acquire a token before its next mutation. Add fault injection where the upstream step-up succeeds and `/security/csrf` fails; assert the browser still receives success plus the committed cookie rotation and cannot continue under the old CSRF context.

**Resolution:** Implemented in `c14c4ae`. The BFF forwards the committed status, body, and every `Set-Cookie` value when reacquisition fails, omits only the convenience header, and tests prove the old CSRF context is rejected.

### [RESOLVED] CR-CLOSURE-FINAL-03: Real Discord redirects lose OAuth purpose, so protected callbacks cannot complete

**Classification:** BLOCKER

**Files:** `apps/api/src/identity/adapters/discord-oauth.ts:70-83`; `apps/web/src/components/identity/oauth-callback-form.tsx:25-40,143-145`; `apps/web/e2e/phase2-runtime.spec.ts:697-723`

**Issue:** `DiscordOAuthAdapter.start` receives the transaction purpose but always sends the same configured `redirect_uri` and does not encode or otherwise transport the purpose. The configured callback path has no purpose parameter. On return, `OAuthCallbackForm` reads `purpose` from the URL and defaults a missing value to `sign-in`, so a real `link-identity` or `step-up` authorization is posted to the sign-in callback endpoint and rejected by the state/purpose binding.

The full-stack tests hide the defect: `finishDiscordCallback` bypasses Discord's configured redirect and manually navigates to a synthetic URL containing `&purpose=${purpose}`. Consequently, the reported green Discord step-up/continuation evidence does not exercise the production round-trip. PKCE itself remains one-shot, but any repair that varies the redirect URI must also use the exact same URI during token exchange.

**Fix:** Correlate purpose to the server-side OAuth transaction rather than guessing it in the browser. A unified callback endpoint can consume state/browser binding and dispatch using the persisted purpose; alternatively use purpose-specific registered redirect URIs and persist the exact redirect URI with the PKCE verifier for exchange. Add browser coverage that starts from the authorization URL and derives the callback from its actual `redirect_uri`, without injecting purpose independently.

**Resolution:** Implemented in `c3e690d`. The server persists purpose and exact redirect URI with the PKCE transaction, exposes one callback endpoint, and dispatches only after consuming the bound transaction. Chromium follows the authorization URL's real `redirect_uri`; the test no longer injects purpose.

## Verified Boundaries Without New Findings

- Email step-up ownership is revalidated inside both request and completion transactions against an active session, active user, verified non-revoked email identity, and normalized address.
- OTP consumption and `reauthenticated_at` are committed once in the same PostgreSQL transaction; challenge rollback/retry behavior is covered.
- Transactional freshness is classified only after actor/session/proof/change binding is validated, preventing a 428 proof oracle for invalid bindings.
- Continuation promotion checks both namespace and UUID nonce derived from the server-persisted return path, consumes ready actions once, and rejects mismatched/expired entries.
- OAuth state and PKCE verifier consumption remain one-shot and browser-bound; BFF route inventory still enforces same-origin and CSRF on callback POSTs.

---

_Reviewed: 2026-08-25T07:44:09Z_
_Reviewer: independent final closure gsd-code-reviewer_
_Depth: deep_
