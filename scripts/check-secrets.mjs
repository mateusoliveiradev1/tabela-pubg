import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
  encoding: "utf8",
});
const files = output.split(/\r?\n/).filter(Boolean);
const binaryExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".ico", ".woff", ".woff2"]);
const signatures = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "AWS access key", pattern: /AKIA[0-9A-Z]{16}/ },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9_]{36,}/ },
  { name: "Stripe live key", pattern: /sk_live_[A-Za-z0-9]{20,}/ },
  { name: "Discord token", pattern: /(?:mfa\.[\w-]{80,}|[\w-]{24,}\.[\w-]{6}\.[\w-]{25,})/ },
];

const findings = [];
for (const file of files) {
  if (file === "scripts/check-secrets.mjs") continue;
  const extension = file.slice(file.lastIndexOf(".")).toLowerCase();
  if (binaryExtensions.has(extension)) continue;

  let content;
  try {
    content = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  for (const signature of signatures) {
    if (signature.pattern.test(content)) findings.push(`${file}: ${signature.name}`);
  }
}

if (findings.length > 0) {
  throw new Error(`possible secrets found:\n${findings.join("\n")}`);
}
console.log(`secret scan passed for ${files.length} files`);
