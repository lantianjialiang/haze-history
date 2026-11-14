import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bundleFromCsv } from "../aqicn-xian.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const csvArg = process.argv[2];
const csvPath = resolve(root, csvArg ?? "data/reference/xian-aqicn-daily.csv");
const outPath = resolve(root, "data/reference/xian-aqicn-daily.json");

const text = await readFile(csvPath, "utf8");
const bundle = bundleFromCsv(text);
await writeFile(outPath, JSON.stringify(bundle));
const days = bundle.cities["CN-610100"];
console.log(
  "wrote",
  outPath,
  days.length,
  "days",
  days[0]?.date,
  "→",
  days[days.length - 1]?.date,
);