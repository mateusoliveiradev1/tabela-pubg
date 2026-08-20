import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
const requiredServices = ["postgres", "redis", "minio", "api", "web", "worker", "discord-bot"];

for (const service of requiredServices) {
  if (!new RegExp(`^  ${service}:`, "m").test(compose)) {
    throw new Error(`compose.yaml is missing service: ${service}`);
  }
}

const healthcheckCount = (compose.match(/^ {4}healthcheck:/gm) ?? []).length;
if (healthcheckCount !== requiredServices.length) {
  throw new Error(`expected ${requiredServices.length} healthchecks, found ${healthcheckCount}`);
}

const docker = spawnSync("docker", ["compose", "config", "--quiet"], {
  encoding: "utf8",
});
if (
  docker.error?.code === "ENOENT" ||
  /not recognized|não é reconhecido/i.test(docker.stderr ?? "")
) {
  console.log("compose structure valid; Docker CLI unavailable, semantic validation skipped");
} else if (docker.status !== 0) {
  throw new Error(docker.stderr || "docker compose config failed");
} else {
  console.log("docker compose config valid");
}
