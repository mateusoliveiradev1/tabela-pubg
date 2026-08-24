import { createHash, randomBytes } from "node:crypto";
import { chmod, mkdir, realpath, rm, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseRequire = createRequire(path.join(repositoryRoot, "packages/database/package.json"));
const queueRequire = createRequire(path.join(repositoryRoot, "packages/queue/package.json"));
const postgresModule = databaseRequire("postgres");
const postgres = postgresModule.default ?? postgresModule;
const { readMigrationFiles } = databaseRequire("drizzle-orm/migrator");
const redisModule = queueRequire("ioredis");
const Redis = redisModule.Redis ?? redisModule.default ?? redisModule;
const migrationsFolder = path.join(repositoryRoot, "packages/database/migrations");
const RUN_ID = /^run-[a-z0-9][a-z0-9-]{14,62}$/;
const BROAD_RUN_ID = /^run-(?:all|any|default|shared|global|public|phase2|e2e|test)(?:-|$)/;
const E2E_ROOT_PREFIX = "pubg-camp-phase2-e2e-";

export async function resolvePhase2E2ESeedEnvironment(environment = process.env) {
  const runId = environment.E2E_RUN_ID;
  if (
    environment.NODE_ENV !== "test" ||
    environment.E2E_PROVIDER_MODE !== "fake" ||
    !runId ||
    !RUN_ID.test(runId) ||
    BROAD_RUN_ID.test(runId)
  ) {
    throw new Error("phase 2 E2E seed requires the complete validated fake provider conjunction");
  }
  if (!environment.DATABASE_URL || !environment.REDIS_URL) {
    throw new Error("DATABASE_URL and REDIS_URL are required for E2E seed lifecycle");
  }
  const root = await resolveOwnedE2ERoot(environment.E2E_OBJECT_ROOT);
  const runRoot = resolveInside(root, runId);
  const scopeHash = createHash("sha256").update(runId).digest("hex").slice(0, 24);
  const schema = `phase2_e2e_${scopeHash}`;
  const databaseRole = `phase2_e2e_r_${scopeHash}`;
  const mailRoot = resolveInside(runRoot, "mail");
  const queuePrefix = `pubg-camp:${runId}:bullmq`;
  return {
    runId,
    schema,
    root,
    runRoot,
    mailRoot,
    databaseRole,
    redisPrefix: `pubg-camp:${runId}`,
    queuePrefix,
  };
}

export async function createPhase2E2ESeed(environment = process.env) {
  const scope = await resolvePhase2E2ESeedEnvironment(environment);
  await mkdir(scope.runRoot, { recursive: true, mode: 0o700 });
  await mkdir(scope.mailRoot, { recursive: true, mode: 0o700 });
  await Promise.all([
    chmod(scope.root, 0o700),
    chmod(scope.runRoot, 0o700),
    chmod(scope.mailRoot, 0o700),
  ]);

  const administrator = postgres(environment.DATABASE_URL, databaseOptions());
  try {
    await dropExactDatabaseScope(administrator, scope.schema, scope.databaseRole);
    await administrator.unsafe(`create schema "${scope.schema}"`);
  } finally {
    await administrator.end({ timeout: 1 });
  }

  const migrationClient = postgres(environment.DATABASE_URL, databaseOptions());
  let migrationIndex = -1;
  let statementIndex = -1;
  try {
    const migrations = readMigrationFiles({ migrationsFolder });
    await migrationClient.begin(async (transaction) => {
      await transaction.unsafe(`set local search_path to "${scope.schema}"`);
      await transaction.unsafe(
        `create table "${scope.schema}"."__drizzle_migrations" (hash text primary key, applied_at timestamptz not null)`,
      );
      for (const [nextMigrationIndex, migration] of migrations.entries()) {
        migrationIndex = nextMigrationIndex;
        for (const [nextStatementIndex, statement] of migration.sql.entries()) {
          statementIndex = nextStatementIndex;
          const scopedStatement = statement.replaceAll('"public".', `"${scope.schema}".`);
          await transaction.unsafe(scopedStatement);
        }
        await transaction.unsafe(
          `insert into "${scope.schema}"."__drizzle_migrations" (hash, applied_at) values ($1, now())`,
          [migration.hash],
        );
      }
    });
  } catch (error) {
    await dropExactDatabaseScopeByUrl(environment.DATABASE_URL, scope.schema, scope.databaseRole);
    throw new Error(
      `phase 2 E2E migrations failed (${safeDatabaseErrorCode(error)} at ${migrationIndex}:${statementIndex})`,
    );
  } finally {
    await migrationClient.end({ timeout: 1 });
  }

  const databasePassword = randomBytes(32).toString("hex");
  const roleAdministrator = postgres(environment.DATABASE_URL, databaseOptions());
  let databaseUrl;
  try {
    databaseUrl = await createRunDatabaseRole(
      roleAdministrator,
      environment.DATABASE_URL,
      scope.schema,
      scope.databaseRole,
      databasePassword,
    );
  } catch (error) {
    await roleAdministrator.end({ timeout: 1 });
    await dropExactDatabaseScopeByUrl(environment.DATABASE_URL, scope.schema, scope.databaseRole);
    throw new Error(`phase 2 E2E runtime database role failed (${safeDatabaseErrorCode(error)})`);
  }
  await roleAdministrator.end({ timeout: 1 });

  const runtimeDatabase = postgres(databaseUrl, databaseOptions());
  try {
    const [runtimeState] = await runtimeDatabase.unsafe("select current_schema() as schema");
    if (runtimeState?.schema !== scope.schema) {
      throw new Error("runtime search path mismatch");
    }
  } catch (error) {
    await dropExactDatabaseScopeByUrl(environment.DATABASE_URL, scope.schema, scope.databaseRole);
    throw new Error(`phase 2 E2E runtime database scope failed (${safeDatabaseErrorCode(error)})`);
  } finally {
    await runtimeDatabase.end({ timeout: 1 });
  }

  const redis = new Redis(environment.REDIS_URL, redisOptions());
  try {
    await redis.connect();
    await redis.set(`${scope.redisPrefix}:seed`, "ready", "EX", 3_600);
  } catch {
    await dropExactDatabaseScopeByUrl(environment.DATABASE_URL, scope.schema, scope.databaseRole);
    throw new Error("phase 2 E2E Redis seed failed");
  } finally {
    redis.disconnect();
  }
  return {
    ...scope,
    databaseUrl,
    environment: {
      ...environment,
      DATABASE_URL: databaseUrl,
      E2E_OBJECT_ROOT: scope.root,
      E2E_MAIL_ROOT: scope.mailRoot,
      BULLMQ_PREFIX: scope.queuePrefix,
    },
  };
}

export async function cleanupPhase2E2ESeed(environment = process.env) {
  const scope = await resolvePhase2E2ESeedEnvironment(environment);
  await dropExactDatabaseScopeByUrl(environment.DATABASE_URL, scope.schema, scope.databaseRole);
  const redis = new Redis(environment.REDIS_URL, redisOptions());
  try {
    await redis.connect();
    let cursor = "0";
    do {
      const [nextCursor, keys] = await redis.scan(
        cursor,
        "MATCH",
        `${scope.redisPrefix}:*`,
        "COUNT",
        100,
      );
      cursor = nextCursor;
      const ownedKeys = keys.filter((key) => key.startsWith(`${scope.redisPrefix}:`));
      if (ownedKeys.length !== keys.length)
        throw new Error("E2E cleanup encountered a foreign Redis key");
      if (ownedKeys.length > 0) await redis.unlink(...ownedKeys);
    } while (cursor !== "0");
  } finally {
    redis.disconnect();
  }
  const cleanupTarget = resolveInside(scope.root, scope.runId);
  if (cleanupTarget !== scope.runRoot) throw new Error("E2E cleanup root mismatch");
  await rm(cleanupTarget, { recursive: true, force: true });
  return scope;
}

async function createRunDatabaseRole(administrator, databaseUrl, schema, databaseRole, password) {
  assertDatabaseScope(schema, databaseRole);
  if (!/^[a-f0-9]{64}$/.test(password)) throw new Error("E2E database password is invalid");
  await administrator.unsafe(`create role "${databaseRole}" login password '${password}'`);
  await administrator.unsafe(`alter role "${databaseRole}" set search_path to "${schema}"`);
  await administrator.unsafe(`grant usage on schema "${schema}" to "${databaseRole}"`);
  await administrator.unsafe(
    `grant select, insert, update, delete on all tables in schema "${schema}" to "${databaseRole}"`,
  );
  await administrator.unsafe(
    `grant usage, select, update on all sequences in schema "${schema}" to "${databaseRole}"`,
  );
  const [databaseState] = await administrator.unsafe("select current_database() as name");
  if (!databaseState?.name) throw new Error("E2E database name is unavailable");
  await administrator.unsafe(
    `grant connect on database ${quoteIdentifier(databaseState.name)} to "${databaseRole}"`,
  );

  const scopedUrl = new URL(databaseUrl);
  scopedUrl.username = databaseRole;
  scopedUrl.password = password;
  scopedUrl.searchParams.delete("options");
  scopedUrl.searchParams.delete("search_path");
  return scopedUrl.toString();
}

async function dropExactDatabaseScopeByUrl(databaseUrl, schema, databaseRole) {
  const database = postgres(databaseUrl, databaseOptions());
  try {
    await dropExactDatabaseScope(database, schema, databaseRole);
  } finally {
    await database.end({ timeout: 1 });
  }
}

async function dropExactDatabaseScope(database, schema, databaseRole) {
  assertDatabaseScope(schema, databaseRole);
  await database.unsafe(`drop schema if exists "${schema}" cascade`);
  const [roleState] = await database.unsafe(
    "select 1 as present from pg_roles where rolname = $1",
    [databaseRole],
  );
  if (!roleState) return;
  await database.unsafe(
    "select pg_terminate_backend(pid) from pg_stat_activity where usename = $1 and pid <> pg_backend_pid()",
    [databaseRole],
  );
  const [databaseState] = await database.unsafe("select current_database() as name");
  if (!databaseState?.name) throw new Error("E2E cleanup database name is unavailable");
  await database.unsafe(
    `revoke connect on database ${quoteIdentifier(databaseState.name)} from "${databaseRole}"`,
  );
  await database.unsafe(`drop role "${databaseRole}"`);
}

function assertDatabaseScope(schema, databaseRole) {
  if (!/^phase2_e2e_[a-f0-9]{24}$/.test(schema)) throw new Error("E2E cleanup schema is invalid");
  if (!/^phase2_e2e_r_[a-f0-9]{24}$/.test(databaseRole))
    throw new Error("E2E cleanup database role is invalid");
}

function quoteIdentifier(identifier) {
  if (typeof identifier !== "string" || identifier.length === 0)
    throw new Error("E2E database identifier is invalid");
  return `"${identifier.replaceAll('"', '""')}"`;
}

function databaseOptions() {
  return {
    max: 1,
    prepare: false,
    connect_timeout: 5,
    idle_timeout: 1,
    onnotice: () => undefined,
  };
}

function redisOptions() {
  return {
    lazyConnect: true,
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
  };
}

function safeDatabaseErrorCode(error) {
  const code = error && typeof error === "object" ? error.code : undefined;
  return typeof code === "string" && /^[A-Z0-9]{5}$/.test(code) ? code : "unknown";
}

async function resolveOwnedE2ERoot(candidate) {
  if (!candidate || !path.isAbsolute(candidate))
    throw new Error("E2E_OBJECT_ROOT must be absolute");
  let root;
  let systemTemp;
  try {
    [root, systemTemp] = await Promise.all([realpath(candidate), realpath(tmpdir())]);
  } catch {
    throw new Error("E2E_OBJECT_ROOT must be an existing mkdtemp directory");
  }
  const relative = path.relative(systemTemp, root);
  if (
    !(await stat(root)).isDirectory() ||
    relative === "" ||
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !path.basename(root).startsWith(E2E_ROOT_PREFIX) ||
    path.basename(root).length <= E2E_ROOT_PREFIX.length
  ) {
    throw new Error("E2E_OBJECT_ROOT is outside the owned mkdtemp scope");
  }
  return root;
}

function resolveInside(root, ...segments) {
  const target = path.resolve(root, ...segments);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new Error("E2E path escapes its run root");
  }
  return target;
}

const entrypoint = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : undefined;
if (entrypoint === import.meta.url) {
  const cleanup = process.argv.includes("--cleanup");
  if (cleanup) await cleanupPhase2E2ESeed();
  else await createPhase2E2ESeed();
  process.stdout.write(cleanup ? "phase 2 E2E state cleaned\n" : "phase 2 E2E state seeded\n");
}
