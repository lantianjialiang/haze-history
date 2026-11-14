import { spawnSync } from "node:child_process";

const steps = [
  ["server/scripts/download-quotsoft.ts", "--incremental"],
  ["server/scripts/fetch-recent.ts", "--incremental"],
];
for (const args of steps) {
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-sqlite",
      "--env-file-if-exists=.env",
      "--import",
      "tsx",
      ...args,
    ],
    { stdio: "inherit", timeout: 20 * 60 * 1000 },
  );
  if (result.error) console.error(result.error);
  if (result.status !== 0) process.exitCode = 1;
}
