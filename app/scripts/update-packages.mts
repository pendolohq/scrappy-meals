// Surveys outdated dependencies (each one's `latest` on the npm registry),
// applies minor and patch updates to package.json and the lockfile, and lists
// major updates for manual review. `--dry-run` only prints what it would do.
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

// A pinned prerelease can be ahead of `latest` (next-auth 5 betas while 4.x is
// latest); that's not an update.
function isOlder(from: string, to: string): boolean {
  const a = semver(from);
  const b = semver(to);
  if (!a || !b) {
    return false;
  }
  const i = a.findIndex((n, j) => n !== b[j]);
  return i !== -1 && b[i] < a[i];
}

async function latestVersion(name: string): Promise<string> {
  const res = await fetch(`https://registry.npmjs.org/${name}/latest`);
  if (!res.ok) {
    throw new Error(`${name}: registry answered ${res.status}`);
  }
  return ((await res.json()) as { version: string }).version;
}

async function findUpdates(pkg: PackageJson): Promise<PackageUpdate[]> {
  const fields: DepField[] = ["dependencies", "devDependencies"];
  const deps = fields.flatMap((field) =>
    Object.entries(pkg[field] ?? {}).map(([name, spec]) => ({
      name,
      spec,
      field,
    }))
  );
  const latest = await Promise.all(deps.map((d) => latestVersion(d.name)));
  return deps.flatMap(({ name, spec, field }, i) => {
    const pinned = spec.replace(/^[^\d]*/, "");
    return pinned === latest[i] || isOlder(pinned, latest[i])
      ? []
      : [
          {
            name,
            spec,
            latest: latest[i],
            bump: classifyBump(pinned, latest[i]),
            field,
          },
        ];
  });
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
log("Checking the npm registry...");

const pkg: PackageJson = JSON.parse(readFileSync(PKG_PATH, "utf-8"));
const totalDeps =
  Object.keys(pkg.dependencies ?? {}).length +
  Object.keys(pkg.devDependencies ?? {}).length;
let all: PackageUpdate[];
try {
  all = await findUpdates(pkg);
} catch (err) {
  console.error("✗ Checking the registry failed:", (err as Error).message);
  process.exit(1);
}

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
  log("\nRunning bun install...");
  const install = spawnSync("bun", ["install"], {
    cwd: ROOT,
    stdio: "inherit",
  });
  if (install.error || install.status !== 0) {
    console.error("\n✗ bun install failed.", install.error?.message ?? "");
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
