import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { compilePlatformRouteMatcher, PlatformRouteInventory } from "@pubg-camp/contracts";
import { describe, expect, it } from "vitest";

const UUID = "11111111-1111-4111-8111-111111111111";

describe("literal browser platform routes", () => {
  it("resolves every /api/platform literal against the canonical inventory", () => {
    const sourceRoot = path.resolve(process.cwd(), "src");
    const literals = sourceFiles(sourceRoot).flatMap((file) => {
      if (/\.spec\.[jt]sx?$/.test(file)) return [];
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/([`"'])(\/api\/platform\/[^`"']+)\1/g)].map((match) => ({
        file: path.relative(sourceRoot, file),
        literal: match[2] ?? "",
      }));
    });

    expect(literals.length).toBeGreaterThan(0);
    const unresolved = literals.filter(({ literal }) => {
      const concrete = literal
        .replaceAll(/\$\{[^}]*purpose[^}]*\}/gi, "step-up")
        .replaceAll(/\$\{[^}]*action\.kind[^}]*\}/gi, "revoke")
        .replaceAll(/\$\{[^}]+\}/g, UUID)
        .slice("/api/platform/".length)
        .split("?", 1)[0];
      return !PlatformRouteInventory.some((entry) =>
        compilePlatformRouteMatcher(entry.path).test(concrete ?? ""),
      );
    });

    expect(unresolved).toEqual([]);
  });
});

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.[jt]sx?$/.test(entry.name) ? [absolute] : [];
  });
}
