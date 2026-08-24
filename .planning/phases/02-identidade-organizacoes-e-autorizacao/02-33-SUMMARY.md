---
phase: 02-identidade-organizacoes-e-autorizacao
plan: 33
subsystem: testing
tags: [e2e, postgres, redis, bullmq, discord, filesystem, isolation]

# Dependency graph
requires:
  - phase: 02-26
    provides: email notification and outbox runtime contracts
  - phase: 02-28
    provides: organization logo storage lifecycle
  - phase: 02-38
    provides: canonical real API composition
  - phase: 02-41
    provides: validated identity Redis run-scope contract
provides:
  - fail-closed fake provider composition for the real API and worker entrypoints
  - run-scoped PostgreSQL schema/role, Redis/BullMQ namespaces and filesystem roots
  - file-backed E2E email and logo-cleanup providers with restrictive custody
affects: [02-39, phase2-e2e, api, worker]

# Tech tracking
tech-stack:
  added: []
  patterns: [complete-conjunction test activation, ephemeral database role search-path, exact-scope cleanup]

key-files:
  created:
    - apps/worker/src/e2e/file-email-sender.ts
    - apps/worker/src/e2e/file-logo-storage.ts
  modified:
    - apps/api/src/main.ts
    - apps/api/src/identity/identity.runtime.ts
    - apps/worker/src/main.ts
    - scripts/seed-phase2-e2e.mjs

key-decisions:
  - "Fake providers activate only when NODE_ENV=test, E2E_PROVIDER_MODE=fake, a non-broad validated E2E_RUN_ID and a real mkdtemp-owned root all agree."
  - "Each seed uses a temporary login role with a server-side search_path and an in-memory random password, avoiding unsupported pooled startup parameters and preventing credential persistence."
  - "Production BullMQ keeps the stable bull prefix, while E2E queues, auth and PKCE namespaces share the same validated run ID."

patterns-established:
  - "Test-only composition: validate the full conjunction before parsing or constructing any external provider."
  - "Cleanup custody: accept only deterministic schema/role/prefix names and roots resolved beneath the owned temporary directory."

requirements-completed: [AUTH-001, AUTH-002, AUTH-003, AUTH-004, AUTH-005, AUTH-006, ORG-001, ORG-002, ORG-003, ORG-004, ORG-005, AUD-001, NFR-005]

# Metrics
duration: 41min
completed: 2026-08-24
---

# Phase 02 Plan 33: Provider Isolation and Real Runtime Seed Summary

**Real API and worker entrypoints now use run-confined Discord, email, storage, PostgreSQL and BullMQ substitutes only behind a complete test-only activation conjunction.**

## Performance

- **Duration:** 41 min
- **Started:** 2026-08-24T14:46:17Z
- **Completed:** 2026-08-24T15:27:19Z
- **Tasks:** 1
- **Files modified:** 9

## Accomplishments

- Added fail-closed provider mode resolution to the real API and worker composition, preserving stable production namespaces and real S3/Resend construction.
- Added file-backed email and logo cleanup adapters whose files remain inside a validated run root with restrictive permissions and idempotent behavior.
- Extended the seed through all migrations in a unique schema, with a temporary role, scoped Redis/BullMQ state, exact cleanup and no credential/token/mailbox-content output.
- Proved the focal behavior with 11 passing tests and a real Neon branch plus loopback Redis; cleanup left zero E2E schemas and roles before branch deletion.

## Task Commits

The TDD task was committed atomically:

1. **Task 1 RED: failing provider isolation contracts** - `02c770f` (test)
2. **Task 1 GREEN: confined E2E providers and seed** - `c06f8e0` (feat)

## Files Created/Modified

- `apps/api/src/e2e/provider-mode.spec.ts` - proves complete activation, scoped identity namespaces and stable production defaults.
- `apps/api/src/main.ts` - selects production or fake composition before provider construction and passes the validated identity scope unchanged.
- `apps/api/src/identity/identity.runtime.ts` - accepts an explicit Discord transport for the test-only composition.
- `apps/worker/src/e2e/file-email-sender.ts` - writes idempotent mailbox records beneath the validated run root.
- `apps/worker/src/e2e/file-logo-storage.ts` - deletes only valid branding objects beneath the run-scoped object directory.
- `apps/worker/src/main.ts` - selects file providers in fake mode and gives queues/workers the same run-scoped BullMQ prefix.
- `scripts/seed-phase2-e2e.mjs` - owns schema, temporary role, Redis marker, directories and exact cleanup.
- Worker E2E specs cover partial activation, production defaults, confinement, permissions and idempotency.

## Decisions Made

- Used a temporary per-run PostgreSQL role with `search_path` set at the role level because the Neon pooled endpoint rejected startup `options` with protocol error `08P01`; the random password exists only in process memory.
- Kept the identity runtime as the sole authority that derives auth and PKCE prefixes; API composition passes only the already validated raw run ID.
- Kept the production BullMQ prefix exactly `bull` and derived the E2E prefix as `pubg-camp:<runId>:bullmq`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added injectable Discord transport to the identity runtime**

- **Found during:** Task 1 (real API fake-provider composition)
- **Issue:** API composition could select fake mode but the identity runtime had no way to use a fake Discord transport, leaving a real network path active.
- **Fix:** Added an optional fetch transport to `createIdentityRuntime` and supplied it only after the complete E2E conjunction passes.
- **Files modified:** `apps/api/src/identity/identity.runtime.ts`, `apps/api/src/main.ts`
- **Verification:** API provider-mode spec passes all 4 cases; API typecheck passes.
- **Committed in:** `c06f8e0`

**2. [Rule 1 - Bug] Replaced rejected startup search-path parameters with an ephemeral role**

- **Found during:** Task 1 (real seed verification)
- **Issue:** PostgreSQL migrations were isolated, but reconnecting through the Neon pooled endpoint with a URL startup `options` search path failed with `08P01`.
- **Fix:** The seed now creates an exact run-derived login role, sets its server-side search path, grants only required runtime access and revokes/drops the role during exact cleanup.
- **Files modified:** `scripts/seed-phase2-e2e.mjs`
- **Verification:** Real seed and cleanup passed; Neon reported zero matching schemas and roles afterward.
- **Committed in:** `c06f8e0`

---

**Total deviations:** 2 auto-fixed (1 missing critical, 1 bug)
**Impact on plan:** Both changes are confined to the test-only composition and are required for hermetic operation; production composition is unchanged.

## Issues Encountered

- `pnpm phase2:integration` passed preflight and 38 tests but failed outside this plan's files: two existing migration/security timeout budgets expired and four concurrent repository cases queried after their setup schemas failed. Details are recorded in `deferred-items.md`.
- Full worker typecheck remains blocked by preexisting duplicate `eventType`/`payload` properties in `apps/worker/src/outbox/publisher.spec.ts`; the worker production build and all focal worker tests pass.

## Known Stubs

None.

## User Setup Required

None - 02-39 can consume the isolated seed and providers without persistent external configuration.

## Next Phase Readiness

- Plan 02-39 can own the real runtime/browser lifecycle using the returned process-local database URL, queue prefix and filesystem roots.
- No E2E schema, role, Redis process or temporary Neon branch remains from verification.

## Self-Check: PASSED

- Created adapter and summary files exist.
- TDD commits `02c770f` and `c06f8e0` exist in git history.

---
*Phase: 02-identidade-organizacoes-e-autorizacao*
*Completed: 2026-08-24*
