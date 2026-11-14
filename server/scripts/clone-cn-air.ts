import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const repo = resolve(root, "data/cn-air");
const remote =
  process.env.CN_AIR_REMOTE ?? "https://atomgit.com/GewisLab/CN-AIR.git";

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

function cityBundles(): string[] {
  const names = runText("git ls-tree -d --name-only HEAD")
    .split(/\r?\n/)
    .filter((name) => name.startsWith("城市_"));
  if (!names.length) {
    throw new Error("No 城市_* folders found at CN-AIR HEAD");
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