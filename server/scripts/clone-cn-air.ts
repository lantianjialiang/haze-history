import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const repo = resolve(root, "data/cn-air");
const remote =
  process.env.CN_AIR_REMOTE ?? "https://atomgit.com/GewisLab/CN-AIR.git";

/** Matches CN-AIR main as of 2026-04; used when partial/sparse clones hide root trees on CI. */
const FALLBACK_CITY_BUNDLES = [
  "城市_20140513-20141231",
  "城市_20150101-20151231",
  "城市_20160101-20161231",
  "城市_20170101-20171231",
  "城市_20180101-20181231",
  "城市_20190101-20191231",
  "城市_20200101-20201231",
  "城市_20210101-20211231",
  "城市_20220101-20221231",
  "城市_20230101-20231231",
  "城市_20240101-20241231",
  "城市_20250101-20251231",
  "城市_20260101-20260418",
];

function run(cmd: string, cwd = repo) {
  console.log("$", cmd);
  execSync(cmd, { cwd, stdio: "inherit", env: process.env });
}

function runText(cmd: string, cwd = repo) {
  return execSync(cmd, { cwd, encoding: "utf8" }).trim();
}

function requireGit() {
  try {
    runText("git --version", root);
  } catch {
    throw new Error("Git is required. Install from https://git-scm.com/");
  }
}

function requireLfs() {
  try {
    runText("git lfs version", root);
  } catch {
    throw new Error(
      "Git LFS is required for CN-AIR CSV payloads. Install from https://git-lfs.com/",
    );
  }
}

async function countCityCsv(dir: string): Promise<number> {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) n += await countCityCsv(path);
    else if (/^china_cities_\d{8}\.csv$/.test(entry.name)) n++;
  }
  return n;
}

function namesFromLsTree(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const tab = line.indexOf("\t");
      if (tab >= 0) return line.slice(tab + 1);
      const parts = line.trim().split(/\s+/);
      return parts[parts.length - 1] ?? "";
    })
    .filter((name) => name.startsWith("城市_"));
}

function cityBundles(): string[] {
  try {
    runText("git rev-parse HEAD^{tree}");
  } catch {
    // partial clone may need an explicit fetch before the root tree is readable
    run("git fetch --filter=blob:none --depth 1 origin");
  }

  let names = namesFromLsTree(runText("git ls-tree HEAD"));
  if (!names.length) {
    names = runText("git ls-tree -d --name-only HEAD")
      .split(/\r?\n/)
      .filter((name) => name.startsWith("城市_"));
  }
  if (!names.length) {
    console.warn(
      "CN-AIR: could not list 城市_* at HEAD (partial clone); using known bundle names",
    );
    names = [...FALLBACK_CITY_BUNDLES];
  }
  return names.sort();
}

function writeSparseCheckout(dirs: string[]) {
  const lines = ["/*", "!/*/", ...dirs.map((dir) => `/${dir}/`)];
  const info = resolve(repo, ".git", "info");
  mkdirSync(info, { recursive: true });
  writeFileSync(resolve(info, "sparse-checkout"), lines.join("\n") + "\n", "utf8");
}

function ensureSparse(dirs: string[]) {
  writeSparseCheckout(dirs);
  if (!runText("git config --get core.sparseCheckout")) {
    run("git sparse-checkout init --no-cone");
  }
  run("git sparse-checkout reapply");
}

requireGit();
requireLfs();
mkdirSync(resolve(root, "data"), { recursive: true });

if (!existsSync(resolve(repo, ".git"))) {
  if (existsSync(repo)) {
    console.log("removing incomplete CN-AIR directory:", repo);
    rmSync(repo, { recursive: true, force: true });
  }
  console.log("cloning", remote, "→", repo);
  execSync(
    `git clone --filter=blob:none --sparse --depth 1 ${JSON.stringify(remote)} ${JSON.stringify(repo)}`,
    { stdio: "inherit" },
  );
} else {
  console.log("updating existing clone at", repo);
  run("git fetch --depth 1 origin");
  run("git pull --ff-only");
}

const bundles = cityBundles();
console.log("year bundles", bundles.length, bundles[0], "…", bundles.at(-1));
ensureSparse(bundles);
run("git lfs install --local");
run("git lfs pull");

const csvCount = await countCityCsv(repo);
console.log("cn-air ready:", csvCount, "china_cities CSV files on disk");
console.log("Next: npm run history -- --national");