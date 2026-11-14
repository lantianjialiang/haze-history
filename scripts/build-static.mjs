import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...extraEnv },
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("node", ["scripts/unpack-data-bundle.mjs"]);
run("npm", ["run", "build", "-w", "web", "--", "--mode", "static"]);
run("npx", ["tsx", "server/scripts/export-static.ts"], {
  NODE_OPTIONS: [process.env.NODE_OPTIONS, "--experimental-sqlite"]
    .filter(Boolean)
    .join(" "),
  STATIC_DATA_OUT: "web/dist/data",
});