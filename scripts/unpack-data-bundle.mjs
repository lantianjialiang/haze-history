import { createReadStream, createWriteStream, existsSync, statSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundleDir = resolve(root, "data/bundle");
const dataDir = resolve(root, "data");

const files = [
  { name: "quotsoft-history.sqlite", required: true },
  { name: "embassy-history.sqlite", required: false },
];

mkdirSync(dataDir, { recursive: true });

for (const { name, required } of files) {
  const archive = resolve(bundleDir, name + ".gz");
  const target = resolve(dataDir, name);
  if (!existsSync(archive)) {
    if (required) {
      console.error("Missing bundle", archive);
      process.exit(1);
    }
    continue;
  }
  if (existsSync(target)) {
    const newer =
      statSync(target).mtimeMs >= statSync(archive).mtimeMs &&
      statSync(target).size > 0;
    if (newer) {
      console.log("keep", target);
      continue;
    }
  }
  console.log("unpack", archive, "→", target);
  await pipeline(
    createReadStream(archive),
    createGunzip(),
    createWriteStream(target),
  );
}