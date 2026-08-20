import { spawn } from "node:child_process";

const app = process.argv[2];
if (app !== "api") {
  throw new Error("migrate-and-start only accepts the api application");
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: process.platform === "win32" });
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} exited with ${code}`)),
    );
    child.once("error", reject);
  });
}

await run("pnpm", ["--filter", "@pubg-camp/database", "db:migrate"]);
await run("node", ["apps/api/dist/main.js"]);
