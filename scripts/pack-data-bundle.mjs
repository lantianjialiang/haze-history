import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const bundleDir = resolve(root, "data/bundle");

const files = [
  { name: "quotsoft-history.sqlite", required: true },
  { name: "embassy-history.sqlite", required: false },
];

mkdirSync(bundleDir, { recursive: true });

for (const { name, required } of files) {
  const source = resolve(root, "data", name);
  const target = resolve(bundleDir, name + ".gz");
  if (!existsSync(source)) {
    if (required) {
      console.error("Missing", source, "— build locally first (see docs/data-local.md).");
      process.exit(1);
    }
    console.warn("skip", name, "(not on disk)");
    continue;
  }
  await pipeline(
    createReadStream(source),
    createGzip({ level: 9 }),
    createWriteStream(target),
  );
  console.log("wrote", target);
}