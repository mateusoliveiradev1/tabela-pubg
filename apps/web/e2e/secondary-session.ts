import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

const RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const BROAD_RUN_ID = /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;

export function phase2SecondarySessionScope(
  runId: string,
  testIdentity: string,
): { deviceDigest: string; tokenDigest: string } {
  if (!RUN_ID.test(runId) || BROAD_RUN_ID.test(runId)) {
    throw new Error("secondary session requires a validated run scope");
  }
  const identity = testIdentity.trim();
  if (!identity) throw new Error("secondary session requires a test identity");
  const suffix = createHash("sha256").update(identity).digest("hex").slice(0, 16);
  return {
    deviceDigest: `studio-${runId}-${suffix}`,
    tokenDigest: createHash("sha256").update(`studio-session:${runId}:${identity}`).digest("hex"),
  };
}

export async function replacePhase2SecondarySession(testIdentity: string): Promise<void> {
  const runId = required("E2E_RUN_ID");
  const scope = phase2SecondarySessionScope(runId, testIdentity);
  const repositoryRoot = path.resolve(process.cwd(), "../..");
  const databaseRequire = createRequire(
    path.join(repositoryRoot, "packages/database/package.json"),
  );
  const postgresModule = databaseRequire("postgres");
  const postgres = postgresModule.default ?? postgresModule;
  const sql = postgres(required("DATABASE_URL"), { max: 1, prepare: false });
  try {
    const [user] = await sql`
      select user_id from verified_emails
      where normalized_email = 'organizer@example.com' and revoked_at is null
      limit 1
    `;
    if (!user?.user_id) throw new Error("secondary session could not resolve organizer user");
    await sql.begin(async (transaction: typeof sql) => {
      await transaction`
        update sessions set revoked_at = now(), revocation_reason = 'e2e fixture replacement',
          updated_at = now()
        where user_id = ${user.user_id} and revoked_at is null and device_id in (
          select id from devices
          where user_id = ${user.user_id} and device_digest like ${`studio-${runId}-%`}
        )
      `;
      const [existingDevice] = await transaction`
        select id from devices
        where user_id = ${user.user_id} and device_digest = ${scope.deviceDigest}
        limit 1
      `;
      const deviceId = existingDevice?.id ?? randomUUID();
      if (!existingDevice) {
        await transaction`
          insert into devices (
            id, user_id, device_digest, label, browser, operating_system,
            first_seen_at, last_seen_at
          ) values (
            ${deviceId}, ${user.user_id}, ${scope.deviceDigest}, 'Chrome do estúdio',
            'Chrome', 'Windows', now() - interval '1 day', now() - interval '1 hour'
          )
        `;
      }
      const sessionId = randomUUID();
      await transaction`
        insert into sessions (
          id, user_id, device_id, token_digest, trust, issued_at, last_seen_at,
          idle_expires_at, absolute_expires_at, reauthenticated_at
        ) values (
          ${sessionId}, ${user.user_id}, ${deviceId},
          ${createHash("sha256").update(`${scope.tokenDigest}:${sessionId}`).digest("hex")},
          'trusted', now() - interval '1 day', now() - interval '1 hour',
          now() + interval '29 days', now() + interval '89 days', now() - interval '1 hour'
        )
      `;
    });
  } finally {
    await sql.end({ timeout: 2 });
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required by secondary session fixture`);
  return value;
}
