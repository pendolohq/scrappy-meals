// Surveys outdated dependencies (pnpm outdated), applies minor and patch
// updates to package.json and the lockfile, and lists major updates for
// manual review. `--dry-run` only prints what it would do.
// Ported from valtiberina.travel's bun script.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DRY_RUN = process.argv.includes("--dry-run");
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_PATH = join(ROOT, "package.json");

type BumpType = "patch" | "minor" | "major";
type DepField = "dependencies" | "devDependencies";
type PackageJson = Partial<Record<DepField, Record<string, string>>> &
  Record<string, unknown>;

interface Outdated {
  current: string;
  latest: string;
  dependencyType: string;
}

interface PackageUpdate {
  name: string;
  spec: string;
  latest: string;
  bump: BumpType;
  field: DepField;
}

function log(message = "") {
  const lines = message.split("\n");
  console.log(
    DRY_RUN ? lines.map((line) => `[DRY RUN] ${line}`).join("\n") : message
  );
}

function semver(v: string): [number, number, number] | null {
  const m = v.replace(/^[^\d]*/, "").match(/^(\d+)\.(\d+)\.(\d+)/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Unparseable versions (ranges like "1.x", tags) count as major, so they are
// flagged for review instead of being bumped automatically.
function classifyBump(from: string, to: string): BumpType {
  const a = semver(from);
  const b = semver(to);
  if (!a || !b || b[0] !== a[0]) {
    return "major";
  }
  return b[1] !== a[1] ? "minor" : "patch";
}

function findUpdates(
  outdated: Record<string, Outdated>,
  pkg: PackageJson
): PackageUpdate[] {
  const updates: PackageUpdate[] = [];
  for (const [name, info] of Object.entries(outdated)) {
    const field = info.dependencyType as DepField;
    const spec = pkg[field]?.[name];
    if (!spec) {
      continue;
    }
    const pinned = spec.replace(/^[^\d]*/, "");
    if (pinned === info.latest) {
      continue;
    }
    updates.push({
      name,
      spec,
      latest: info.latest,
      bump: classifyBump(pinned, info.latest),
      field,
    });
  }
  return updates;
}

// Keeps each spec's prefix: "^1.2.3" stays a caret range, "1.2.3" stays exact.
function applyUpdates(updates: PackageUpdate[], pkg: PackageJson): PackageJson {
  const next = structuredClone(pkg);
  for (const u of updates) {
    const prefix = u.spec.match(/^[^\d]*/)?.[0] ?? "";
    (next[u.field] ??= {})[u.name] = prefix + u.latest;
  }
  return next;
}

function printTable(title: string, rows: PackageUpdate[]) {
  if (rows.length === 0) {
    return;
  }
  const wName = Math.max(7, ...rows.map((r) => r.name.length));
  const wSpec = Math.max(7, ...rows.map((r) => r.spec.length));
  const wLatest = Math.max(6, ...rows.map((r) => r.latest.length));
  const bar = "─".repeat(wName + wSpec + wLatest + 28);
  log(`\n${title}`);
  log(bar);
  for (const r of rows) {
    log(
      ` ${r.name.padEnd(wName)}  ${r.spec.padEnd(wSpec)}  →  ${r.latest.padEnd(wLatest)}  (${r.bump.toUpperCase().padEnd(5)})  ${r.field}`
    );
  }
  log(bar);
}

if (DRY_RUN) {
  log("Preview only: no files will be modified.\n");
}
log("Running pnpm outdated...");

// pnpm outdated exits 1 when something is outdated, so only a missing or
// unparseable report counts as a failure.
const outdated = spawnSync("pnpm", ["outdated", "--format", "json"], {
  cwd: ROOT,
  encoding: "utf-8",
});
let report: Record<string, Outdated>;
try {
  report = JSON.parse(outdated.stdout || "{}");
} catch {
  console.error(
    "✗ pnpm outdated failed:",
    outdated.error?.message ?? `${outdated.stderr}${outdated.stdout}`.trim()
  );
  process.exit(1);
}

const pkg: PackageJson = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
const totalDeps =
  Object.keys(pkg.dependencies ?? {}).length +
  Object.keys(pkg.devDependencies ?? {}).length;
const all = findUpdates(report, pkg);

if (all.length === 0) {
  log(`✓ All ${totalDeps} packages are up to date.`);
  process.exit(0);
}

const upToDate = totalDeps - all.length;
const safe = all.filter((u) => u.bump !== "major");
const major = all.filter((u) => u.bump === "major");

if (DRY_RUN) {
  printTable(
    `Would auto-update ${safe.length} package(s) (minor/patch):`,
    safe
  );
  printTable(
    `Would flag ${major.length} package(s) for manual review (major):`,
    major
  );
  log(
    `\nDone (dry run). ${safe.length} would be auto-updated · ${major.length} would be flagged · ${upToDate} already up to date.`
  );
  process.exit(0);
}

if (safe.length > 0) {
  printTable(`Auto-updating ${safe.length} package(s):`, safe);
  writeFileSync(
    PKG_PATH,
    JSON.stringify(applyUpdates(safe, pkg), null, 2) + "\n"
  );
  log("\nRunning pnpm install...");
  const install = spawnSync("pnpm", ["install"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (install.error || install.status !== 0) {
    console.error("\n✗ pnpm install failed.", install.error?.message ?? "");
    process.exit(1);
  }
  log("✓ Lockfile updated.");
} else {
  log("\nNo safe (minor/patch) updates available.");
}

if (major.length > 0) {
  printTable("MANUAL REVIEW REQUIRED: major updates:", major);
} else {
  log("\nNo major updates pending.");
}

const flagNote =
  major.length > 0 ? " · review flagged packages above before upgrading" : "";
log(
  `\nDone. ${safe.length} auto-updated · ${major.length} flagged for manual review · ${upToDate} already up to date.${flagNote}`
);
