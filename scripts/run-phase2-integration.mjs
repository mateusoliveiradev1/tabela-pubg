import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import tls from "node:tls";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationRoot = path.join(repositoryRoot, "packages/database/migrations");
const databaseRequire = createRequire(path.join(repositoryRoot, "packages/database/package.json"));
const postgresModule = databaseRequire("postgres");
const postgres = postgresModule.default ?? postgresModule;
const connectionTimeoutMs = 5_000;

function requireServiceUrl(name, protocols) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`${name} is required; phase 2 integration never skips unavailable services`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid service URL`);
  }

  if (!protocols.includes(parsed.protocol)) {
    throw new Error(`${name} must use one of: ${protocols.join(", ")}`);
  }

  if (!parsed.hostname || /(?:example|placeholder|change-me)/i.test(parsed.hostname)) {
    throw new Error(`${name} must target an actual service host`);
  }

  return { parsed, value };
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function applyMigrationsFromZero(client, schemaName) {
  const migrationFiles = (await readdir(migrationRoot))
    .filter((file) => /^\d{4}_.+\.sql$/.test(file))
    .toSorted();

  if (migrationFiles.length === 0) {
    throw new Error("no PostgreSQL migrations were found");
  }

  const quotedSchema = quoteIdentifier(schemaName);
  await client.unsafe(`create schema ${quotedSchema}`);

  try {
    await client.unsafe(`set search_path to ${quotedSchema}`);

    for (const migrationFile of migrationFiles) {
      const migrationSql = await readFile(path.join(migrationRoot, migrationFile), "utf8");
      const isolatedSql = migrationSql.replaceAll('"public".', `${quotedSchema}.`);
      const statements = isolatedSql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await client.unsafe(statement);
      }
    }

    const requiredRelations = [
      "outbox_events",
      "users",
      "sessions",
      "organizations",
      "role_assignments",
      "audit_events",
    ];
    const [{ relation_count: relationCount }] = await client.unsafe(
      `select count(*)::int as relation_count
       from pg_catalog.pg_class c
       join pg_catalog.pg_namespace n on n.oid = c.relnamespace
       where n.nspname = $1 and c.relname = any($2::text[]) and c.relkind = 'r'`,
      [schemaName, requiredRelations],
    );

    if (relationCount !== requiredRelations.length) {
      throw new Error("PostgreSQL migrations did not create every required phase 2 relation");
    }
  } finally {
    await client.unsafe(`drop schema if exists ${quotedSchema} cascade`);
  }
}

async function verifyPostgres(databaseUrl) {
  const client = postgres(databaseUrl, {
    max: 1,
    connect_timeout: connectionTimeoutMs / 1_000,
    idle_timeout: 1,
    prepare: false,
    onnotice: () => undefined,
  });
  const schemaName = `phase2_preflight_${process.pid}_${randomBytes(6).toString("hex")}`;

  try {
    await client`select 1 as healthy`;
    await applyMigrationsFromZero(client, schemaName);
  } finally {
    await client.end({ timeout: 1 });
  }
}

function encodeRedisCommand(parts) {
  const encoded = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = String(part);
    encoded.push(`$${Buffer.byteLength(value)}\r\n${value}\r\n`);
  }
  return encoded.join("");
}

async function verifyRedis(redisUrl) {
  const port = Number(redisUrl.port || (redisUrl.protocol === "rediss:" ? 6380 : 6379));
  const commands = [];

  if (redisUrl.password) {
    commands.push(
      redisUrl.username
        ? ["AUTH", decodeURIComponent(redisUrl.username), decodeURIComponent(redisUrl.password)]
        : ["AUTH", decodeURIComponent(redisUrl.password)],
    );
  }
  commands.push(["PING"]);

  await new Promise((resolve, reject) => {
    const socketOptions = { host: redisUrl.hostname, port };
    const socket =
      redisUrl.protocol === "rediss:"
        ? tls.connect({ ...socketOptions, servername: redisUrl.hostname })
        : net.createConnection(socketOptions);
    let response = "";
    let settled = false;

    const fail = (error) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      socket.end();
      resolve();
    };

    socket.setTimeout(connectionTimeoutMs, () => fail(new Error("Redis healthcheck timed out")));
    socket.on("error", fail);
    socket.on(redisUrl.protocol === "rediss:" ? "secureConnect" : "connect", () => {
      socket.write(commands.map(encodeRedisCommand).join(""));
    });
    socket.on("close", () => {
      if (!settled) fail(new Error("Redis closed the healthcheck connection without PONG"));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("-ERR") || response.includes("-NOAUTH")) {
        fail(new Error("Redis rejected the healthcheck"));
        return;
      }
      if (response.includes("+PONG\r\n")) {
        succeed();
      }
    });
  });
}

async function runPreflight() {
  const database = requireServiceUrl("DATABASE_URL", ["postgres:", "postgresql:"]);
  const redis = requireServiceUrl("REDIS_URL", ["redis:", "rediss:"]);

  await verifyPostgres(database.value);
  await verifyRedis(redis.parsed);
  console.log("phase 2 integration preflight passed against PostgreSQL and Redis");
}

async function runSuite(suite) {
  const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

  await new Promise((resolve, reject) => {
    const child = spawn(
      pnpmCommand,
      ["exec", "vitest", "run", "--config", "vitest.integration.config.ts"],
      {
        cwd: repositoryRoot,
        env: { ...process.env, PHASE2_SUITE: suite },
        stdio: "inherit",
        shell: false,
      },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`phase 2 ${suite} suite exited with code ${code ?? "unknown"}`));
    });
  });
}

const argumentsList = process.argv.slice(2);
const preflightOnly = argumentsList.includes("--preflight-only");
const suiteIndex = argumentsList.indexOf("--suite");
const suite = suiteIndex >= 0 ? argumentsList[suiteIndex + 1] : undefined;

if (!preflightOnly && suite !== "integration" && suite !== "concurrent") {
  throw new Error("use --preflight-only or --suite integration|concurrent");
}

await runPreflight();
if (!preflightOnly && suite) {
  await runSuite(suite);
}
