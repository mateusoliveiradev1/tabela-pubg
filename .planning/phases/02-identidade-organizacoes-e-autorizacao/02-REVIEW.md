---
phase: 02-identidade-organizacoes-e-autorizacao
reviewed: 2026-08-24T05:16:17Z
depth: standard
files_reviewed: 137
files_reviewed_list:
  - .env.example
  - .github/workflows/ci.yml
  - apps/api/src/app.module.ts
  - apps/api/src/audit/audit.module.ts
  - apps/api/src/audit/audit.service.ts
  - apps/api/src/authorization/authorization.module.ts
  - apps/api/src/authorization/permission.guard.ts
  - apps/api/src/authorization/session.guard.ts
  - apps/api/src/identity/adapters/discord-oauth.ts
  - apps/api/src/identity/adapters/redis-auth-rate-limiter.ts
  - apps/api/src/identity/identity.controller.ts
  - apps/api/src/identity/identity.module.ts
  - apps/api/src/identity/identity.runtime.ts
  - apps/api/src/identity/identity.service.ts
  - apps/api/src/identity/oauth.service.ts
  - apps/api/src/identity/otp.service.ts
  - apps/api/src/identity/ports/auth-rate-limiter.ts
  - apps/api/src/identity/ports/discord-identity-provider.ts
  - apps/api/src/identity/ports/token-generator.ts
  - apps/api/src/identity/session.service.ts
  - apps/api/src/main.ts
  - apps/api/src/organizations/adapters/e2e-organization-logo-storage.ts
  - apps/api/src/organizations/adapters/s3-organization-logo-storage.ts
  - apps/api/src/organizations/invitations.service.ts
  - apps/api/src/organizations/members.service.ts
  - apps/api/src/organizations/organization-logo.integration.spec.ts
  - apps/api/src/organizations/organizations.controller.ts
  - apps/api/src/organizations/organizations.module.ts
  - apps/api/src/organizations/organizations.service.ts
  - apps/api/src/organizations/ports/organization-logo-storage.ts
  - apps/api/src/security/csrf.controller.ts
  - apps/api/src/security/csrf.service.ts
  - apps/api/src/security/http-exception.filter.ts
  - apps/api/test/security.integration.spec.ts
  - apps/web/e2e/fixtures.ts
  - apps/web/e2e/phase2-accessibility.spec.ts
  - apps/web/next.config.ts
  - apps/web/package.json
  - apps/web/playwright.config.ts
  - apps/web/src/app/(auth)/convites/aceitar/page.tsx
  - apps/web/src/app/(auth)/entrar/page.tsx
  - apps/web/src/app/(platform)/conta/sessoes/page.tsx
  - apps/web/src/app/(platform)/layout.tsx
  - apps/web/src/app/(platform)/o/[slug]/auditoria/page.tsx
  - apps/web/src/app/(platform)/o/[slug]/configuracoes/page.tsx
  - apps/web/src/app/(platform)/o/[slug]/convites/page.tsx
  - apps/web/src/app/(platform)/o/[slug]/membros/page.tsx
  - apps/web/src/app/api/platform/[...path]/route.spec.ts
  - apps/web/src/app/api/platform/[...path]/route.ts
  - apps/web/src/app/globals.css
  - apps/web/src/app/layout.tsx
  - apps/web/src/components/audit/audit-event.tsx
  - apps/web/src/components/authorization/confirm-sensitive-action-dialog.tsx
  - apps/web/src/components/authorization/scope-role-editor.tsx
  - apps/web/src/components/identity/device-session-card.tsx
  - apps/web/src/components/identity/discord-button.tsx
  - apps/web/src/components/identity/discord-navigation.ts
  - apps/web/src/components/identity/email-otp-form.tsx
  - apps/web/src/components/identity/identity-cards.tsx
  - apps/web/src/components/identity/invitation-accept-form.tsx
  - apps/web/src/components/identity/oauth-callback-form.tsx
  - apps/web/src/components/layout/app-shell.tsx
  - apps/web/src/components/layout/organization-switcher.tsx
  - apps/web/src/components/organizations/create-organization-form.tsx
  - apps/web/src/components/organizations/invitation-list.tsx
  - apps/web/src/components/organizations/member-list.tsx
  - apps/web/src/components/organizations/organization-logo-field.spec.tsx
  - apps/web/src/components/organizations/organization-logo-field.tsx
  - apps/web/src/components/organizations/organization-management.spec.tsx
  - apps/web/src/components/ui/dialog.tsx
  - apps/web/src/components/ui/feedback.tsx
  - apps/web/src/components/ui/menu.tsx
  - apps/web/vitest.config.ts
  - apps/worker/package.json
  - apps/worker/previews/notifications/long-content.html
  - apps/worker/src/health.ts
  - apps/worker/src/main.ts
  - apps/worker/src/notifications/email-sender.ts
  - apps/worker/src/notifications/generate-previews.ts
  - apps/worker/src/notifications/processor.spec.ts
  - apps/worker/src/notifications/processor.ts
  - apps/worker/src/notifications/resend-email-sender.contract.spec.ts
  - apps/worker/src/notifications/resend-email-sender.ts
  - apps/worker/src/notifications/templates.spec.ts
  - apps/worker/src/notifications/templates.ts
  - apps/worker/src/storage/logo-cleanup.processor.spec.ts
  - apps/worker/src/storage/logo-cleanup.processor.ts
  - biome.json
  - package.json
  - packages/authorization/src/authorization.spec.ts
  - packages/authorization/src/index.ts
  - packages/config/src/index.test.ts
  - packages/config/src/index.ts
  - packages/contracts/src/audit.test.ts
  - packages/contracts/src/audit.ts
  - packages/contracts/src/identity.test.ts
  - packages/contracts/src/identity.ts
  - packages/contracts/src/index.ts
  - packages/contracts/src/organizations.test.ts
  - packages/contracts/src/organizations.ts
  - packages/database/migrations/0001_identity_organizations.sql
  - packages/database/migrations/0002_organization_logos.sql
  - packages/database/migrations/meta/_journal.json
  - packages/database/package.json
  - packages/database/src/index.ts
  - packages/database/src/repositories/audit.ts
  - packages/database/src/repositories/authorization.ts
  - packages/database/src/repositories/identity.ts
  - packages/database/src/repositories/index.ts
  - packages/database/src/repositories/notifications.ts
  - packages/database/src/repositories/organizations.ts
  - packages/database/src/repositories/sessions.ts
  - packages/database/src/schema.ts
  - packages/database/src/schema/audit.ts
  - packages/database/src/schema/authorization.ts
  - packages/database/src/schema/identity.ts
  - packages/database/src/schema/notifications.ts
  - packages/database/src/schema/organizations.ts
  - packages/database/test/identity-organizations.integration.spec.ts
  - packages/database/test/invitation.concurrent.spec.ts
  - packages/database/test/last-owner.concurrent.spec.ts
  - packages/database/test/organization-logo.integration.spec.ts
  - packages/database/test/session-alert-context.integration.spec.ts
  - packages/domain/src/identity.ts
  - packages/domain/src/index.ts
  - packages/domain/src/organizations.ts
  - packages/storage/src/index.ts
  - packages/storage/src/organization-logo.ts
  - pnpm-workspace.yaml
  - scripts/audit-phase2-packages.mjs
  - scripts/run-phase2-e2e.mjs
  - scripts/run-phase2-integration.mjs
  - scripts/seed-phase2-e2e.mjs
  - scripts/validate-phase2-ci.mjs
  - scripts/validate-phase2-validation.mjs
  - turbo.json
  - vitest.integration.config.ts
findings:
  critical: 10
  warning: 3
  info: 0
  total: 13
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-08-24T05:16:17Z  
**Depth:** standard  
**Files Reviewed:** 137  
**Status:** issues_found

## Narrative Findings (AI reviewer)

### Summary

The phase has release-blocking gaps at the seams between otherwise well-tested units. The production application cannot deliver outbox work, email OTP verification does not authenticate or persist step-up, authenticated OAuth purposes cannot start, one session issuance path returns a token different from the persisted token, tenant-scoped BFF mutations cannot satisfy the permission guard, and several BFF/UI routes have no API controller. Logo delivery is also blocked by the production CSP. Passing lint, typecheck, and unit tests does not cover these disconnected production paths; the browser harness replaces the Nest API with a synthetic server and therefore masks them.

### Critical Issues

#### CR-01 [BLOCKER]: Persisted outbox events are never published to either BullMQ queue

**File:** `apps/worker/src/main.ts:72-86`; `packages/database/src/repositories/notifications.ts:103-113`  
**Issue:** Notification and storage-cleanup mutations only insert `outbox_events`. The worker creates consumers for `outbox-delivery` and `storage-logo-cleanup`, but no scoped production code (or other repository production code) reads pending outbox rows, calls a queue producer, or marks events published. Consequently OTP, invitation, and new-device email jobs never reach the notification processor, and replaced/orphaned logos never reach cleanup.  
**Fix:** Add an outbox publisher that atomically claims available pending rows, maps `notification.delivery.requested` and storage-cleanup events to the correct queue, enqueues only the opaque ID with the outbox ID as BullMQ `jobId`, and marks/retries publication durably. Start and stop that publisher with the worker and add a real PostgreSQL+Redis integration test proving insert -> publish -> process -> published/cleared.

#### CR-02 [BLOCKER]: Email OTP verification is status-only and never authenticates or records step-up

**File:** `apps/api/src/identity/identity.controller.ts:157-183`; `apps/api/src/identity/otp.service.ts:162-183`  
**Issue:** Consuming a valid OTP returns an enum-like result. For `sign-in`, the controller returns `authenticated` without creating/finding a user, issuing a session, or setting a session cookie. For `step-up`, it returns `validUntil` without calling `SessionService.confirmStepUp`, so `sessions.reauthenticated_at` remains unchanged and every subsequent sensitive mutation still fails its recent-authentication check. The swallowed failure at controller lines 169-173 confirms that the missing session-establishment adapter is not present.  
**Fix:** Make OTP consumption feed a purpose-specific authenticated use case. In one transaction, resolve/create the verified email identity and issue a session for sign-in, or mark the current authenticated session reauthenticated for step-up. Bind non-sign-in challenges to actor/session at creation and consumption, then rotate CSRF only after the session mutation succeeds.

#### CR-03 [BLOCKER]: Discord link/step-up OAuth flows cannot start and their confirmation proof is not persisted

**File:** `apps/api/src/identity/identity.controller.ts:57-86`; `apps/api/src/identity/oauth.service.ts:75-79`; `packages/database/src/repositories/identity.ts:48-74`; `apps/api/src/identity/identity.runtime.ts:139-147`  
**Issue:** `IdentityController` is class-level public, and `startDiscord` never supplies `userId`, `sessionId`, or `currentMethodConfirmed`. `OAuthService.start` therefore rejects every `link-identity` and `step-up` request as lacking authenticated context. Even if that route were protected, `currentMethodConfirmed` exists only in the service interface: neither the OAuth table/repository nor the runtime projection persists/returns it, so linking always reaches `linkIdentity` with a false confirmation.  
**Fix:** Keep only sign-in public. Route authenticated purposes through a session-protected controller that derives actor/session exclusively from `request.auth`; persist all purpose-bound confirmation state in the OAuth transaction (or replace the boolean with a durable, actor/session-bound proof), return it on consume, and test the real controller/runtime/repository chain.

#### CR-04 [BLOCKER]: Device-session login returns a token that was never persisted

**File:** `apps/api/src/identity/session.service.ts:127-149`; `apps/api/src/identity/identity.runtime.ts:219-243`; `packages/database/src/repositories/sessions.ts:119-141`  
**Issue:** `SessionService.startDeviceSession` generates `token` and returns it. The runtime adapter ignores `input.token` and calls `issueSessionForDevice`, which generates and hashes a different token internally. The runtime also discards `issued.token`. Every session issued through this path therefore receives a cookie/token that cannot resolve to the persisted session.  
**Fix:** Use a single token owner. Prefer returning `issued.token` from the repository adapter and removing token generation from `SessionService.startDeviceSession`; alternatively persist exactly `input.token`. Add a production-adapter contract test that resolves the returned token against the inserted row.

#### CR-05 [BLOCKER]: Production authentication never applies the configured sliding idle expiry

**File:** `apps/api/src/main.ts:143-148`; `packages/database/src/repositories/sessions.ts:346-399`  
**Issue:** The session guard wiring calls `resolveSession`, which only reads the row. `touchSession` contains the coalesced sliding-expiry update but is never called by production code (its only callers are tests). Active users are thus logged out at the initially calculated 30-day idle deadline instead of receiving a 30-day inactivity window capped by the 90-day absolute deadline.  
**Fix:** Authenticate with `touchSession` (or a single resolve-and-touch repository operation) and return its user/session projection. Preserve coalescing and the absolute cap, and add a guard-level integration test that advances time and observes `idle_expires_at` move only at the configured interval.

#### CR-06 [BLOCKER]: Provisional Discord trust is discarded, granting full authenticated access

**File:** `apps/api/src/identity/identity.service.ts:113-121`; `apps/api/src/identity/identity.runtime.ts:209-218`; `apps/api/src/authorization/permission.guard.ts:41-43`  
**Issue:** A Discord profile without a usable verified email is intentionally issued with `trust: "provisional"`, but the runtime repository ignores `input.trust`, the session schema/authenticator exposes no trust state, and `PermissionGuard` treats every resolved session as fully `authenticated`. During its 15-minute lifetime, a provisional account can use all routes gated only by `authenticated`, including organization creation, and can become an owner without completing email verification.  
**Fix:** Persist session trust, include it in `AuthenticatedSession`, and deny product/organization capabilities to provisional sessions except an explicit onboarding allowlist. Promote trust only after durable verified-email confirmation, ideally while rotating the session token.

#### CR-07 [BLOCKER]: The BFF cannot provide the tenant context required by RBAC mutations

**File:** `apps/web/src/app/api/platform/[...path]/route.ts:155-167`; `apps/api/src/authorization/permission.guard.ts:45-58`; `apps/web/src/components/organizations/invitation-list.tsx:62-76`  
**Issue:** `PermissionGuard` requires `x-organization-id` for organization permissions, but the BFF request allowlist excludes that header and all scoped browser mutation clients omit it. Invitation, member-role, member-revoke, ownership-transfer, and logo-update requests therefore reach Nest without organization context and fail with 403. The synthetic E2E API does not run this guard, so CI reports these flows green.  
**Fix:** Derive the organization ID server-side from the already validated BFF route match and set `x-organization-id` on the upstream request. Derive scope IDs from validated route/body contracts where required; do not accept arbitrary tenant authority from a browser header. Add BFF-to-Nest tests that prove same-tenant success and cross-tenant denial.

#### CR-08 [BLOCKER]: Session and identity-management routes exposed by the BFF/UI have no API controller

**File:** `apps/web/src/app/api/platform/[...path]/route.ts:67-95`; `apps/api/src/identity/identity.module.ts:25-40`; `apps/api/src/identity/identity.controller.ts:187-204`  
**Issue:** The BFF and UI call `/identity/sessions`, logout/revoke routes, and `/identity/identities` link/remove routes. The registered identity module contains only `IdentityController` (OAuth/OTP) and `SessionAlertContextController`; the source ends after the alert resolver and defines none of the allowlisted session/identity endpoints. Real requests return 404, so account session management, logout, revoke-others, identity listing/link confirmation, and identity removal are unavailable.  
**Fix:** Implement and register protected controllers for the complete contract, always deriving actor/session from `request.auth`, invoking `SessionService`/identity use cases, rotating or invalidating cookies and CSRF as appropriate, and enforcing fresh step-up for identity changes. Add an endpoint inventory test comparing BFF allowlist entries with Nest routes.

#### CR-09 [BLOCKER]: A revocation outage converts a successful OAuth commit into an unrecoverable client failure

**File:** `apps/api/src/identity/oauth.service.ts:124-130`  
**Issue:** `completeCallback` creates/links the local identity and issues or rotates sessions before the `finally` block awaits Discord token revocation. If revocation fails, its exception replaces the successful result; the controller returns cancelled while the OAuth state and PKCE verifier are consumed and local security-sensitive mutations have already committed. The client cannot retry and may leave an active session or linked identity it was told failed.  
**Fix:** Fetch the profile, revoke the provider token, and only then commit local identity/session changes. If product policy allows best-effort revocation instead, explicitly record/retry revocation without overwriting a committed success; do not combine committed local state with a cancelled response.

#### CR-10 [BLOCKER]: Production CSP blocks the external signed logo URLs the API returns

**File:** `apps/web/next.config.ts:42-58`; `.env.example:47`; `apps/web/src/components/organizations/organization-logo-field.tsx:94-97`  
**Issue:** The UI renders short-lived S3/MinIO signed URLs and the environment documents external logo origins, but CSP fixes `img-src` to `'self' data: blob:`. Browsers therefore block actual object-storage logos; the E2E harness returns same-origin fake URLs and cannot detect the production failure.  
**Fix:** Parse and validate the configured logo origins at build/boot and append their exact origins to `img-src` (HTTPS-only in production). Keep the existing UI URL allowlist/referrer policy and add a browser test whose logo response comes from the configured second origin.

### Warnings

#### WR-01 [WARNING]: Notification terminal-state persistence failures are reported as success

**File:** `apps/worker/src/notifications/processor.ts:49-76`  
**Issue:** `store.clear` deliberately returns `boolean`, but both the expired and delivered branches ignore it. A conditional update that affects no row is reported as `expired`/`delivered`; ciphertext can remain pending and the job can be replayed indefinitely. This is especially reachable under concurrent delivery processing.  
**Fix:** Require `clear(...) === true` before returning a terminal result. On false, reload the row and return ignored only if another worker already established the same terminal state; otherwise throw so BullMQ retries/reconciles.

#### WR-02 [WARNING]: Browser CI replaces the production API, masking the phase's integration failures

**File:** `scripts/run-phase2-e2e.mjs:45-72`; `scripts/run-phase2-e2e.mjs:84-224`  
**Issue:** The E2E lifecycle seeds PostgreSQL and checks Redis, but then starts `--serve-api`, a handwritten in-memory HTTP server implementing happy-path responses. It does not start the Nest application, session guard, CSRF implementation, RBAC snapshot loader, repositories, outbox, worker, or S3 adapter. Consequently the mandatory browser gate passes despite CR-01 through CR-08, and it cannot validate fresh-checkout production wiring.  
**Fix:** Start the real built API and worker with only external providers replaced by explicit test adapters. Seed real database state, use real Redis/outbox/guards, and retain the fake server only for isolated UI tests that are not presented as end-to-end evidence.

#### WR-03 [WARNING]: Create-organization compensation can delete an object after the database commit

**File:** `apps/api/src/organizations/organizations.service.ts:283-306`  
**Issue:** The `try/catch` covers both the repository transaction and response projection. If the organization and active-logo rows commit but signed-URL/projection logic subsequently throws, the catch deletes (or schedules deletion of) the now-active object, leaving committed metadata pointing at missing storage.  
**Fix:** Limit compensation to failures before the repository commit completes. After commit, treat URL projection failure as a fallback response or a separate read error; never delete an object already referenced by committed active metadata.

---

_Reviewed: 2026-08-24T05:16:17Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
