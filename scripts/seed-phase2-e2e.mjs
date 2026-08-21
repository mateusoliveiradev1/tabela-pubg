import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseRequire = createRequire(path.join(repositoryRoot, "packages/database/package.json"));
const postgresModule = databaseRequire("postgres");
const postgres = postgresModule.default ?? postgresModule;
const runId = process.env.E2E_RUN_ID;
const cleanup = process.argv.includes("--cleanup");

if (!runId || !/^run-[a-z0-9][a-z0-9-]{14,62}$/.test(runId)) {
  throw new Error("E2E_RUN_ID is required for deterministic seed lifecycle");
}
if (!process.env.DATABASE_URL || !process.env.REDIS_URL) {
  throw new Error("DATABASE_URL and REDIS_URL are required for E2E seed lifecycle");
}

const schema = `phase2_e2e_${runId.replace(/[^a-z0-9]/g, "_")}`;
const quotedSchema = `"${schema}"`;
const database = postgres(process.env.DATABASE_URL, {
  max: 1,
  prepare: false,
  connect_timeout: 5,
  idle_timeout: 1,
  onnotice: () => undefined,
});

try {
  if (cleanup) {
    await database.unsafe(`drop schema if exists ${quotedSchema} cascade`);
  } else {
    await database.unsafe(`drop schema if exists ${quotedSchema} cascade`);
    await database.unsafe(`create schema ${quotedSchema}`);
    await database.unsafe(
      `create table ${quotedSchema}.run_state (run_id text primary key, nonce text not null, seeded_at timestamptz not null)`,
    );
    await database.unsafe(
      `insert into ${quotedSchema}.run_state (run_id, nonce, seeded_at) values ($1, $2, '2026-08-21T12:00:00Z')`,
      [runId, randomBytes(12).toString("hex")],
    );
  }
} finally {
  await database.end({ timeout: 1 });
}

await redisCommand(
  new URL(process.env.REDIS_URL),
  cleanup ? ["DEL", `phase2:e2e:${runId}`] : ["SET", `phase2:e2e:${runId}`, "seeded", "EX", "3600"],
);
process.stdout.write(cleanup ? "phase 2 E2E state cleaned\n" : "phase 2 E2E state seeded\n");

function redisCommand(url, command) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: url.hostname, port: Number(url.port || 6379) });
    let response = "";
    socket.setTimeout(5_000, () => socket.destroy(new Error("Redis seed timeout")));
    socket.on("error", reject);
    socket.on("connect", () => {
      const commands = [];
      if (url.password)
        commands.push(
          url.username
            ? ["AUTH", decodeURIComponent(url.username), decodeURIComponent(url.password)]
            : ["AUTH", decodeURIComponent(url.password)],
        );
      commands.push(command);
      socket.write(commands.map(encodeRedis).join(""));
    });
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
      if (response.includes("-ERR") || response.includes("-NOAUTH")) {
        socket.destroy();
        reject(new Error("Redis rejected E2E seed command"));
        return;
      }
      if (/\+(?:OK|PONG)\r\n|:\d+\r\n/.test(response)) {
        socket.end();
        resolve();
      }
    });
  });
}

function encodeRedis(parts) {
  return `*${parts.length}\r\n${parts.map((part) => `$${Buffer.byteLength(String(part))}\r\n${part}\r\n`).join("")}`;
}
