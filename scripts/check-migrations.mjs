import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const migrationRoot = path.resolve("packages/database/migrations");
const sqlTags = readdirSync(migrationRoot)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => file.replace(/\.sql$/, ""));
const journal = JSON.parse(readFileSync(path.join(migrationRoot, "meta/_journal.json"), "utf8"));
const journalTags = journal.entries.map((entry) => entry.tag);

if (JSON.stringify(sqlTags.toSorted()) !== JSON.stringify(journalTags.toSorted())) {
  throw new Error(
    `migration journal mismatch: sql=${sqlTags.join(",")} journal=${journalTags.join(",")}`,
  );
}

console.log(`migration journal passed for ${sqlTags.length} migration(s)`);
