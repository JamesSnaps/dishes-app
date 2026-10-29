/**
 * Holds the line on hard-coded colours while the app moves to the Cookbook
 * design system (DESIGN.md). Counts, per file, the classes DESIGN.md rules out
 * — raw Tailwind palette colours (`bg-orange-500`, `dark:text-violet-300`),
 * `bg-white`, arbitrary hex colours (`bg-[#fff]`) and `bg-gradient-*` — and
 * fails if any file has more than `colour-baseline.json` allows. A file the
 * baseline doesn't list is allowed none, so new screens start clean.
 *
 * The baseline only goes down: after moving a screen onto the tokens, run with
 * `--update` to lower it. `--update` refuses to raise any file's count.
 *
 * Usage: pnpm --filter @dishes/web check:colours [--update]
 * Pure — no database or network. Uses only Node built-ins and runs with
 * `node --experimental-strip-types`, so it needs no install (CI included).
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// The script's own path rather than __dirname, which plain Node (ESM) doesn't have.
const WEB = dirname(dirname(resolve(process.argv[1])));
const REPO = resolve(WEB, "../..");
const BASELINE_FILE = join(WEB, "colour-baseline.json");

const ROOTS = ["apps/web/app", "apps/web/components", "apps/web/hooks", "apps/web/lib", "packages/ui/src"];

/** DESIGN.md → Exceptions. Paths are repo-relative prefixes. */
const EXCEPTIONS = [
  "apps/web/app/(cook)/wrapped/", // the year-in-review story is meant to be showy
];

const PALETTE =
  "slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose";
const UTILITIES =
  "bg|text|border|border-[trblxy]|from|via|to|ring|ring-offset|fill|stroke|shadow|divide|outline|accent|decoration|caret|placeholder";

const FORBIDDEN = new RegExp(
  [
    `(?:${UTILITIES})-(?:${PALETTE})-\\d{2,3}(?:\\/\\d{1,3})?`,
    `bg-white(?:\\/\\d{1,3})?`,
    `(?:${UTILITIES})-\\[#[0-9a-fA-F]{3,8}\\]`,
    `bg-gradient-to-[a-z]{1,2}`,
  ]
    .map((p) => `(?<![\\w-])${p}(?![\\w-])`)
    .join("|"),
  "g"
);

type Baseline = { total: number; files: Record<string, number> };

function* sourceFiles(dir: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== "node_modules") yield* sourceFiles(path);
    } else if (/\.(tsx?|jsx?|mjs)$/.test(entry.name)) {
      yield path;
    }
  }
}

function count(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const root of ROOTS) {
    for (const file of sourceFiles(join(REPO, root))) {
      const rel = relative(REPO, file).split("\\").join("/");
      if (EXCEPTIONS.some((prefix) => rel.startsWith(prefix))) continue;
      const lines = readFileSync(file, "utf8").split("\n");
      const hits: string[] = [];
      lines.forEach((line, i) => {
        for (const match of line.matchAll(FORBIDDEN)) hits.push(`${i + 1}: ${match[0]}`);
      });
      if (hits.length) found.set(rel, hits);
    }
  }
  return found;
}

function readBaseline(): Baseline {
  try {
    return JSON.parse(readFileSync(BASELINE_FILE, "utf8")) as Baseline;
  } catch {
    return { total: 0, files: {} };
  }
}

function writeBaseline(found: Map<string, string[]>) {
  const files: Record<string, number> = {};
  for (const rel of [...found.keys()].sort()) files[rel] = found.get(rel)!.length;
  const total = Object.values(files).reduce((a, b) => a + b, 0);
  writeFileSync(BASELINE_FILE, JSON.stringify({ total, files }, null, 2) + "\n");
  return total;
}

const found = count();
const baseline = readBaseline();
const now = [...found.values()].reduce((n, hits) => n + hits.length, 0);

const over = [...found.entries()].filter(([rel, hits]) => hits.length > (baseline.files[rel] ?? 0));

if (process.argv.includes("--update")) {
  // `--init` exists only to create the very first baseline.
  if (over.length && !process.argv.includes("--init")) {
    console.error("Refusing to raise the baseline. These files have more hard-coded colours than it allows:");
    for (const [rel, hits] of over) console.error(`  ${rel}: ${baseline.files[rel] ?? 0} → ${hits.length}`);
    process.exit(1);
  }
  const total = writeBaseline(found);
  console.log(`colour-baseline.json: ${baseline.total} → ${total}`);
  process.exit(0);
}

if (over.length) {
  console.error("Hard-coded colours added. Use the design tokens in DESIGN.md (bg-primary, bg-muted, text-muted-foreground…).\n");
  for (const [rel, hits] of over) {
    console.error(`${rel}: baseline ${baseline.files[rel] ?? 0}, now ${hits.length}`);
    for (const hit of hits.slice(0, 12)) console.error(`  ${hit}`);
    if (hits.length > 12) console.error(`  … ${hits.length - 12} more`);
  }
  process.exit(1);
}

if (now < baseline.total) {
  console.log(`Hard-coded colours: ${now} (baseline ${baseline.total}). Run with --update to lower the baseline.`);
} else {
  console.log(`Hard-coded colours: ${now}, none added.`);
}
