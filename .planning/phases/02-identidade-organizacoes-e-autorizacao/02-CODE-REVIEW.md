---
phase: 02-identidade-organizacoes-e-autorizacao
reviewed: 2026-08-25T02:38:41Z
depth: standard
files_reviewed: 178
files_reviewed_list:
  - .env.example
  - .github/workflows/ci.yml
  - apps/api/src/app.module.spec.ts
  - apps/api/src/app.module.ts
  - apps/api/src/audit/audit.module.ts
  - apps/api/src/audit/audit.service.ts
  - apps/api/src/authorization/authorization.module.ts
  - apps/api/src/authorization/authorization.service.ts
  - apps/api/src/authorization/decorators.ts
  - apps/api/src/authorization/permission.guard.spec.ts
  - apps/api/src/authorization/permission.guard.ts
  - apps/api/src/authorization/session.guard.ts
  - apps/api/src/e2e/provider-mode.spec.ts
  - apps/api/src/identity/adapters/discord-oauth.ts
  - apps/api/src/identity/adapters/redis-auth-rate-limiter.integration.spec.ts
  - apps/api/src/identity/adapters/redis-auth-rate-limiter.ts
  - apps/api/src/identity/identity.controller.ts
  - apps/api/src/identity/identity.module.ts
  - apps/api/src/identity/identity.runtime.spec.ts
  - apps/api/src/identity/identity.runtime.ts
  - apps/api/src/identity/identity.service.spec.ts
  - apps/api/src/identity/identity.service.ts
  - apps/api/src/identity/identity-management.controller.spec.ts
  - apps/api/src/identity/identity-management.controller.ts
  - apps/api/src/identity/identity-test-selection.spec.ts
  - apps/api/src/identity/oauth.service.ts
  - apps/api/src/identity/otp.service.spec.ts
  - apps/api/src/identity/otp.service.ts
  - apps/api/src/identity/ports/auth-rate-limiter.ts
  - apps/api/src/identity/ports/discord-identity-provider.ts
  - apps/api/src/identity/ports/token-generator.ts
  - apps/api/src/identity/session.controller.spec.ts
  - apps/api/src/identity/session.controller.ts
  - apps/api/src/identity/session.service.spec.ts
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
  - apps/api/src/organizations/provisional-promotion.integration.spec.ts
  - apps/api/src/security/csrf.controller.ts
  - apps/api/src/security/csrf.service.ts
  - apps/api/src/security/http-exception.filter.ts
  - apps/api/test/security.integration.spec.ts
  - apps/api/vitest.config.ts
  - apps/api/vitest.redis-integration.config.ts
  - apps/web/e2e/fixtures.ts
  - apps/web/e2e/phase2-accessibility.spec.ts
  - apps/web/e2e/phase2-runtime.spec.ts
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
  - apps/web/src/app/security-headers.spec.ts
  - apps/web/src/components/audit/audit-event.tsx
  - apps/web/src/components/authorization/confirm-sensitive-action-dialog.tsx
  - apps/web/src/components/authorization/scope-role-editor.tsx
  - apps/web/src/components/identity/auth.spec.tsx
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
  - apps/web/src/lib/organization-logo-origins.spec.ts
  - apps/web/src/lib/organization-logo-origins.ts
  - apps/web/vitest.config.ts
  - apps/worker/package.json
  - apps/worker/src/e2e/file-email-sender.ts
  - apps/worker/src/e2e/file-logo-storage.ts
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
  - apps/worker/src/outbox/publisher.spec.ts
  - apps/worker/src/outbox/publisher.ts
  - apps/worker/src/storage/logo-cleanup.processor.spec.ts
  - apps/worker/src/storage/logo-cleanup.processor.ts
  - biome.json
  - DESIGN.md
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
  - packages/contracts/src/platform-route-inventory.spec.ts
  - packages/contracts/src/platform-route-inventory.ts
  - packages/database/migrations/0001_identity_organizations.sql
  - packages/database/migrations/0002_organization_logos.sql
  - packages/database/migrations/0003_runtime_security_closure.sql
  - packages/database/migrations/0004_cute_justice.sql
  - packages/database/migrations/0005_open_iron_lad.sql
  - packages/database/migrations/meta/_journal.json
  - packages/database/migrations/meta/0003_snapshot.json
  - packages/database/migrations/meta/0004_snapshot.json
  - packages/database/migrations/meta/0005_snapshot.json
  - packages/database/package.json
  - packages/database/src/identity-security-change-harness.test.ts
  - packages/database/src/index.ts
  - packages/database/src/outbox.test.ts
  - packages/database/src/outbox.ts
  - packages/database/src/repositories/audit.ts
  - packages/database/src/repositories/authorization.ts
  - packages/database/src/repositories/identity.ts
  - packages/database/src/repositories/identity-security-change.ts
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
  - packages/database/test/identity-security-change.integration.spec.ts
  - packages/database/test/invitation.concurrent.spec.ts
  - packages/database/test/last-owner.concurrent.spec.ts
  - packages/database/test/organization-logo.integration.spec.ts
  - packages/database/test/runtime-security-migration.integration.spec.ts
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
  critical: 8
  warning: 3
  info: 0
  total: 11
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-08-25T02:38:41Z  
**Depth:** standard  
**Files Reviewed:** 178  
**Status:** issues_found

## Summary

The complete Phase 2 SUMMARY scope was reviewed, including the post-remediation paths through 02-42. The review found eight release-blocking correctness/security defects and three robustness warnings. The most serious problems are destructive outbox claiming, lost logo-cleanup retries, broken browser identity/step-up routes, an unreachable Discord link confirmation, missing current-method confirmation for email security changes, and non-transactional session/notification issuance.

Focused verification was also run. The BFF route suite (30 tests) and worker outbox/cleanup suites (14 tests) all passed. Those passes are false reassurance for the defects below: the BFF test explicitly requires the legacy OTP URL used by production components to return 404, and the worker tests exercise mocked batches/processors without the real domain-event mix or BullMQ retry timing.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: [BLOCKER] The publisher exhausts unrelated domain events that it cannot route

**Files:** `packages/database/src/outbox.ts:104-145`, `apps/worker/src/outbox/publisher.ts:57-74`, `apps/worker/src/outbox/publisher.ts:121-140`, `apps/worker/src/outbox/publisher.ts:174-222`, `packages/database/src/repositories/organizations.ts:269`, `packages/database/src/repositories/identity-security-change.ts:263-279`

**Issue:** `claimOutboxBatch` claims every eligible event without filtering by type and increments its attempt count. The only mapper attached to that table accepts `notification.delivery.requested` and `storage.logo.cleanup`; every other type is treated as invalid and retried until the five-attempt ceiling. Phase 2 writes many such events, including `organization.created`, invitation/membership/ownership events, `organization.logo.updated`, and `identity.security-state-changed`. Merely starting the worker therefore converts durable domain evidence into permanently ineligible `failed` rows before any future consumer can process them. This is an event/data-loss boundary, not a harmless unsupported-message response.

**Fix:** Give this publisher an explicit allowlist in its claim query, or introduce consumer-specific cursors/subscriptions so one consumer cannot mutate another consumer's delivery state. Unsupported but valid domain events must remain available or move to a deliberate dead-letter state without exhausting the canonical event. Add a PostgreSQL integration test that inserts a mixed batch and proves unrelated event types remain unclaimed.

### CR-02: [BLOCKER] Logo cleanup retries are acknowledged while the cleanup remains leased or deferred

**Files:** `apps/worker/src/storage/logo-cleanup.processor.ts:36-67`, `packages/database/src/repositories/organizations.ts:1215-1244`, `apps/worker/src/main.ts:158-181`

**Issue:** The processor returns successful `{ status: "ignored" }` for every null claim, but a null claim does not mean only “completed/missing.” It also means a previous claim is still inside its 60-second lease or a `failed` record has a future `nextAttemptAt`. BullMQ retries use a much shorter exponential schedule. If object deletion succeeds and `complete` fails, the retry arrives while the record is still `claimed`, gets null, and the processor acknowledges the job; the ledger can remain `claimed` forever. After a later storage failure, an early queue retry can similarly acknowledge a `failed` row before `nextAttemptAt`, leaving no job after the already-published outbox event. The unit test models time advancing to repository eligibility and therefore cannot expose this queue/lease mismatch.

**Fix:** Make `claim` return a discriminated result (`completed`, `missing`, `leased-until`, `retry-at`, `claimed`). Only completed/missing are successful no-ops; deferred/leased results must reschedule or fail the BullMQ job until the persisted time. Make post-delete completion recoverable and idempotent. Add a real BullMQ + PostgreSQL test covering completion-write failure and a retry before both the lease and `nextAttemptAt`.

### CR-03: [BLOCKER] Email identity linking calls an OTP route that the BFF deliberately rejects

**Files:** `apps/web/src/components/identity/identity-cards.tsx:251-305`, `packages/contracts/src/platform-route-inventory.ts:83-115`, `apps/web/src/app/api/platform/[...path]/route.spec.ts:391-403`

**Issue:** The identity card posts to `/api/platform/identity/email/otp/request` and `/verify`. The canonical inventory contains only purpose-specific paths such as `/identity/email/otp/link-email/request` and `/verify`; the BFF test explicitly asserts that the generic request path returns 404 without reaching the API. Consequently, both steps of browser email linking always fail despite the API use case existing.

**Fix:** Change the component to the `link-email/request` and `link-email/verify` inventory entries, and send the purpose-specific request schemas expected by those endpoints. Add a client-route contract test that resolves every literal `/api/platform/...` call against `PlatformRouteInventory`, plus an E2E test that completes an email link through the browser.

### CR-04: [BLOCKER] Neither step-up method can complete a sensitive browser action

**Files:** `apps/web/src/components/authorization/confirm-sensitive-action-dialog.tsx:42-110`, `packages/contracts/src/platform-route-inventory.ts:83-115`, `apps/web/src/app/api/platform/[...path]/route.spec.ts:391-403`

**Issue:** Email step-up uses the same rejected generic OTP request/verify URLs as CR-03, so it always receives 404. Discord step-up writes the reason to `sessionStorage` and navigates away, but no production code reads or removes `pubg-camp:sensitive-action-reason`. On return, React state starts again at the reason step and the exact pending mutation is gone; the dialog never enters `commit`. Thus every organization mutation wired through this dialog is unreachable through either supported step-up method. Runtime E2E bypasses this UI by calling API helpers directly.

**Fix:** Point email step-up at `/identity/email/otp/step-up/{request,verify}`. For Discord, persist a one-use, session-bound continuation describing the exact action and reason, restore it after callback, verify fresh server-side reauthentication, then enter/perform commit and clear the continuation. Add browser E2E for both methods that asserts the original mutation, audit reason, and final capability refresh.

### CR-05: [BLOCKER] Discord creates a pending link proof whose identifier is never returned to the user

**Files:** `apps/api/src/identity/oauth.service.ts:170-187`, `packages/contracts/src/identity.ts:24-42`, `packages/contracts/src/identity.ts:86-97`, `apps/api/src/identity/identity-management.controller.ts:31-57`, `apps/api/src/identity/identity.service.ts:196-221`

**Issue:** The OAuth callback stores a proof under a new random ID but returns only `status` and `nextPath`. Confirmation requires that proof ID as `candidateIdentityId`. The identity-list controller returns only the strict `IdentityListResponseSchema` and discards the repository's pending-link capability entirely; the service's list method also returns only identities. There is therefore no API response from which the browser can obtain the ID needed by `confirmIdentityLink`, so successful Discord OAuth can never reach the explicit confirmation/commit step.

**Fix:** Expose a deliberately scoped pending-link projection from the authenticated identities endpoint (a public one-use handle, provider, and masked display value), or let confirmation atomically select the single unexpired actor/session-bound proof without accepting an ID. Keep proof consumption and session rotation transactional. Add an end-to-end OAuth-link test that starts at the browser, displays the candidate, confirms it, and verifies replay rejection.

### CR-06: [BLOCKER] Email link/change accepts only the candidate-email proof and skips current-method reauthentication

**Files:** `apps/api/src/identity/identity.controller.ts:243-290`, `apps/api/src/identity/identity.controller.ts:426-444`, `apps/api/src/identity/identity.service.ts:265-292`, `packages/database/src/repositories/identity-security-change.ts:203-251`

**Issue:** Protected email OTP creation binds the challenge to actor/session but never requires that session to have a fresh step-up. `applyEmailSecurityChange` then sends the candidate-email proof directly into the transaction. The transaction locks an active session and consumes the proof, but never checks `reauthenticated_at`. This is inconsistent with the phase's dual-confirmation decision and with Discord linking, which rejects stale/null current-method proof. A stolen active session plus CSRF context can request a code for an attacker-controlled address and link or replace the account email without proving control of the current method, enabling account takeover.

**Fix:** Enforce fresh current-method proof at the database transaction boundary: lock the current session and require `reauthenticated_at` to be greater than `now - 10 minutes` and not in the future before consuming the candidate proof or mutating identities. The controller/UI should initiate step-up first, but the atomic database check must remain authoritative. Add stale, null, future, wrong-session, and boundary-time integration cases for both link-email and change-email.

### CR-07: [BLOCKER] New-device session issuance and its security alert are not one transaction

**Files:** `packages/database/src/repositories/sessions.ts:64-191`, `packages/database/src/repositories/notifications.ts:86-113`, `apps/api/src/identity/identity.runtime.ts:317-361`

**Issue:** `issueSessionForDevice` performs device creation, session creation, alert-context creation, encrypted delivery insertion, and outbox append sequentially through a generic executor. The runtime passes the top-level database, not a transaction. `createEncryptedNotificationDelivery` also performs delivery and outbox inserts separately. If any alert/delivery/outbox write fails after device/session persistence, the controller reports a cancelled login and sets no cookie, but committed state remains. On retry the device is no longer new, so the subsequent valid session is issued without any new-device alert. Failure between delivery and outbox also strands an unsendable delivery. This defeats the security notification precisely on partial infrastructure failures.

**Fix:** Wrap device resolution, session issue, alert context, delivery, and outbox insertion in a single database transaction and pass that transaction through every repository call. Preserve the unique-device race handling inside the transaction. Add fault-injection integration cases after each mutation and prove rollback leaves no device/session/delivery/outbox residue; then prove a retry still emits exactly one alert.

### CR-08: [BLOCKER] Validated session and OTP security settings are ignored at runtime

**Files:** `packages/config/src/index.ts:43-68`, `apps/api/src/main.ts:241-272`, `packages/database/src/repositories/sessions.ts:7-11`, `apps/api/src/identity/otp.service.ts:124-125`, `apps/api/src/identity/adapters/redis-auth-rate-limiter.ts:31-43`

**Issue:** Configuration validates `SESSION_IDLE_TTL_SECONDS`, `SESSION_ABSOLUTE_TTL_SECONDS`, `SESSION_ACTIVITY_WRITE_INTERVAL_SECONDS`, `OTP_TTL_SECONDS`, `OTP_MAX_ATTEMPTS`, and `OTP_COOLDOWN_SECONDS`, but `main.ts` passes none of them into the identity runtime. Repositories/services instead hard-code 30 days, 90 days, five minutes, ten minutes, five attempts, and a 60-second cooldown. An operator can deploy a successfully validated five-minute session policy or one-attempt OTP policy while production silently runs the weaker hard-coded policy. The apparent security controls are non-functional.

**Fix:** Define typed policy inputs for the runtime, session repository/touch path, OTP service, and Redis limiter; convert seconds once at composition; and remove duplicate hard-coded policy values. Add composition tests with non-default values that assert persisted expiry, touch coalescing, challenge attempts/expiry, and Redis cooldown.

## Warnings

### WR-01: [WARNING] OTP challenge replacement and delivery/outbox creation can commit partially

**Files:** `apps/api/src/identity/otp.service.ts:145-188`, `apps/api/src/identity/identity.runtime.ts:293-313`, `packages/database/src/repositories/identity.ts:366-403`, `packages/database/src/repositories/notifications.ts:86-113`

**Issue:** OTP request consumes rate limits, supersedes existing challenges, inserts a replacement challenge, inserts an encrypted delivery, and appends an outbox event through independent top-level operations. Failure can supersede a usable code without a replacement, persist a challenge whose message can never be sent, or persist a delivery with no outbox publication. There is no retry relationship from the challenge to a missing delivery/outbox event.

**Fix:** Move challenge supersession/insertion, delivery insertion, and outbox append into one database transaction exposed as a single repository use case. Consume or compensate the cooldown consistently. Add fault injection after supersession, challenge insert, delivery insert, and outbox append.

### WR-02: [WARNING] The documented local cookie configuration is rejected by compliant browsers

**Files:** `.env.example:21-23`, `packages/config/src/index.ts:50-55`, `apps/api/src/security/csrf.service.ts:48-63`, `apps/api/src/security/csrf.service.ts:166-172`

**Issue:** The example mandates an `__Host-` session name while setting `SESSION_COOKIE_SECURE=false`. CSRF defaults also use `__Host-preauth` and `__Host-csrf`, and all three inherit `secure: false`. Cookies with the `__Host-` prefix must carry the Secure attribute, so browsers reject the documented local HTTP cookies. Local sign-in, CSRF acquisition, and session persistence consequently fail even though configuration validation succeeds. The E2E environment uses secure cookies and masks this development path.

**Fix:** Either run local development over HTTPS with Secure cookies, or use non-prefixed development cookie names for session, preauth, and CSRF. Add a startup invariant that rejects any `__Host-` name when secure cookies are disabled, and test the documented `.env.example` mode in a browser.

### WR-03: [WARNING] `APP_ORIGIN` accepts URL shapes that break every unsafe request

**Files:** `packages/config/src/index.ts:43-47`, `apps/api/src/security/csrf.service.ts:146-159`, `apps/api/src/main.ts:241-247`

**Issue:** `APP_ORIGIN` is validated only as a URL, but CSRF compares the configured string byte-for-byte to the browser `Origin` and to `new URL(referer).origin`. Valid URLs with a trailing slash, path, query, fragment, or credentials pass startup validation yet can never equal a browser Origin value. A small deployment formatting mistake therefore causes all state-changing requests to fail closed after successful boot.

**Fix:** Parse at startup and require the input to equal `url.origin`, with no credentials, path other than `/`, query, or fragment; then store and pass the normalized origin string. Add config tests for trailing slash/path/query/credentials and a CSRF integration case using the normalized value.

---

_Reviewed: 2026-08-25T02:38:41Z_  
_Reviewer: the agent (gsd-code-reviewer)_  
_Depth: standard_
