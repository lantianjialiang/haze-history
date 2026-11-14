import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import {
  EmbassyStore,
  embassyCities,
  embassyPath,
  parseEmbassyCsv,
  parseStateAirCsv,
} from "../embassy.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = join(root, "data/embassy");
const store = new EmbassyStore(embassyPath(root));

const sources = [
  [
    "BeijingPM20100101_20151231.csv",
    "https://cdn.jsdelivr.net/gh/zhangyu-paris/Write_A_Data_Science_Blog_Post@master/Data/BeijingPM20100101_20151231.csv",
  ],
  [
    "ShanghaiPM20100101_20151231.csv",
    "https://cdn.jsdelivr.net/gh/zhangyu-paris/Write_A_Data_Science_Blog_Post@master/Data/ShanghaiPM20100101_20151231.csv",
  ],
  [
    "GuangzhouPM20100101_20151231.csv",
    "https://cdn.jsdelivr.net/gh/zhangyu-paris/Write_A_Data_Science_Blog_Post@master/Data/GuangzhouPM20100101_20151231.csv",
  ],
  [
    "ChengduPM20100101_20151231.csv",
    "https://cdn.jsdelivr.net/gh/zhangyu-paris/Write_A_Data_Science_Blog_Post@master/Data/ChengduPM20100101_20151231.csv",
  ],
  [
    "ShenyangPM20100101_20151231.csv",
    "https://cdn.jsdelivr.net/gh/zhangyu-paris/Write_A_Data_Science_Blog_Post@master/Data/ShenyangPM20100101_20151231.csv",
  ],
  [
    "pollution.csv",
    "https://cdn.jsdelivr.net/gh/jbrownlee/Datasets@master/pollution.csv",
  ],
] as const;

const stateAirCities = [
  { name: "Beijing", cityId: "CN-110100", from: 2016, to: 2025 },
  { name: "Shanghai", cityId: "CN-310100", from: 2016, to: 2025 },
  { name: "Guangzhou", cityId: "CN-440100", from: 2016, to: 2025 },
  { name: "Chengdu", cityId: "CN-510100", from: 2016, to: 2020 },
  { name: "Shenyang", cityId: "CN-210100", from: 2016, to: 2025 },
] as const;
const stateAirCdn =
  "https://cdn.jsdelivr.net/gh/dolekhanhdang/Air-Quality-Data-from-U.S.-Embassies@main/";

const cityFiles: Record<string, string> = {
  "BeijingPM20100101_20151231.csv": "CN-110100",
  "ShanghaiPM20100101_20151231.csv": "CN-310100",
  "GuangzhouPM20100101_20151231.csv": "CN-440100",
  "ChengduPM20100101_20151231.csv": "CN-510100",
  "ShenyangPM20100101_20151231.csv": "CN-210100",
  "PRSA_data_2010.1.1-2014.12.31.csv": "CN-110100",
  "pollution.csv": "CN-110100",
  "PRSA_selva.csv": "CN-110100",
};

async function githubContents(path: string, dest: string) {
  const response = await fetch(
    "https://api.github.com/repos/dolekhanhdang/Air-Quality-Data-from-U.S.-Embassies/contents/" +
      path,
    {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "haze-history-local/0.2",
      },
      signal: AbortSignal.timeout(60000),
    },
  );
  if (!response.ok) {
    console.log("github", path, response.status);
    return false;
  }
  const json = (await response.json()) as {
    encoding?: string;
    content?: string;
    sha?: string;
  };
  let encoded = json.encoding === "base64" ? json.content : null;
  if (!encoded && json.sha) {
    const blob = await fetch(
      "https://api.github.com/repos/dolekhanhdang/Air-Quality-Data-from-U.S.-Embassies/git/blobs/" +
        json.sha,
      {
        headers: {
          Accept: "application/vnd.github+json",
          "User-Agent": "haze-history-local/0.2",
        },
        signal: AbortSignal.timeout(60000),
      },
    );
    if (!blob.ok) return false;
    const body = (await blob.json()) as { content?: string };
    encoded = body.content ?? null;
  }
  if (!encoded) return false;
  await writeFile(dest, Buffer.from(encoded.replaceAll("\n", ""), "base64"));
  console.log("github", dest);
  return true;
}

async function curlDownload(url: string, dest: string, githubPath?: string) {
  if (existsSync(dest) && (await readFile(dest)).byteLength > 1000) {
    console.log("have", dest);
    return true;
  }
  console.log("curl", url);
  const curl = spawnSync(
    "curl.exe",
    ["-L", "--fail", "--max-time", "60", "-o", dest, url],
    { encoding: "utf8" },
  );
  if (curl.status === 0 && existsSync(dest) && (await readFile(dest)).byteLength > 1000) {
    console.log("saved", dest);
    return true;
  }
  console.log("fail", url, curl.stderr || curl.status);
  if (githubPath) return githubContents(githubPath, dest);
  return false;
}

async function download(url: string, dest: string) {
  if (existsSync(dest) && (await readFile(dest)).byteLength > 1000) {
    console.log("have", dest);
    return true;
  }
  console.log("get", url);
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "haze-history-local/0.2" },
      signal: AbortSignal.timeout(90000),
      redirect: "follow",
    });
    if (response.ok) {
      await writeFile(dest, Buffer.from(await response.arrayBuffer()));
      return true;
    }
    console.log("fail", url, response.status);
  } catch (error) {
    console.log("fetch fail", url, error instanceof Error ? error.message : error);
  }
  const curl = spawnSync(
    "curl.exe",
    ["-L", "--fail", "--max-time", "90", "-o", dest, url],
    { encoding: "utf8" },
  );
  if (curl.status === 0 && existsSync(dest)) {
    console.log("curl", dest);
    return true;
  }
  console.log("fail", url, curl.stderr || curl.status);
  return false;
}

function extract(archive: string) {
  const unzip = spawnSync("tar", ["-xf", archive, "-C", dir], {
    encoding: "utf8",
  });
  if (unzip.status === 0) return true;
  const expand = spawnSync(
    "powershell",
    ["-NoProfile", "-Command", `Expand-Archive -Force '${archive}' '${dir}'`],
    { encoding: "utf8" },
  );
  return expand.status === 0;
}

function cityIdFromName(name: string) {
  if (cityFiles[name]) return cityFiles[name];
  const match = name.match(/^(Beijing|Shanghai|Guangzhou|Chengdu|Shenyang)/i);
  if (!match) return null;
  return embassyCities[match[1].toLowerCase()] ?? null;
}

async function csvFiles(folder: string): Promise<string[]> {
  if (!existsSync(folder)) return [];
  const found: string[] = [];
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const path = join(folder, entry.name);
    if (entry.isDirectory()) found.push(...(await csvFiles(path)));
    else if (entry.name.toLowerCase().endsWith(".csv")) found.push(path);
  }
  return found;
}

async function downloadStateAir() {
  const destDir = join(dir, "stateair");
  await mkdir(destDir, { recursive: true });
  const jobs = stateAirCities.flatMap((city) =>
    Array.from({ length: city.to - city.from + 1 }, (_, i) => {
      const year = city.from + i;
      const name = `${city.name}_PM2.5_${year}_YTD.csv`;
      return { name, path: `Data/${city.name}/${year}/${name}` };
    }),
  );
  let ok = 0;
  let index = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (index < jobs.length) {
        const job = jobs[index++];
        if (await curlDownload(stateAirCdn + job.path, join(destDir, job.name), job.path))
          ok++;
      }
    }),
  );
  console.log("stateair files", ok);
  return ok;
}

function dropEmbassySeriesCache() {
  const cachePath = join(root, "data/haze.sqlite");
  if (!existsSync(cachePath)) return;
  try {
    const cache = new DatabaseSync(cachePath);
    const removed = cache
      .prepare("DELETE FROM series WHERE provider_id=?")
      .run("stateair-embassy");
    cache.close();
    console.log("cleared series cache", Number(removed.changes ?? 0));
  } catch (error) {
    console.log(
      "cache skip",
      error instanceof Error ? error.message : error,
    );
  }
}

await mkdir(dir, { recursive: true });
await Promise.all(
  sources.map(([name, url]) => download(url, join(dir, name))),
);
await downloadStateAir();
if (existsSync(join(dir, "five-cities.zip")))
  extract(join(dir, "five-cities.zip"));
if (existsSync(join(dir, "five-cities.rar")))
  extract(join(dir, "five-cities.rar"));

const files = await csvFiles(dir);
console.log("csv files", files.length);
const haveUci = (store.status().last ?? "") >= "2015-12-31";
let ingested = 0;
for (const file of files) {
  const name = file.split(/[/\\]/).pop()!;
  if (haveUci && /PM20100101_20151231|pollution\.csv|PRSA/i.test(name)) {
    console.log("skip uci", name);
    continue;
  }
  const cityId = cityIdFromName(name);
  if (!cityId) {
    console.log("skip", name);
    continue;
  }
  const text = await readFile(file, "utf8");
  const rows = parseEmbassyCsv(text, cityId);
  const hours = rows.length ? rows : parseStateAirCsv(text, cityId);
  if (!hours.length) {
    console.log("empty", name);
    continue;
  }
  store.ingest(hours);
  ingested += hours.length;
  console.log(name, cityId, hours.length, "hours");
}
console.log("done", ingested, "hours", store.status());
store.close();
dropEmbassySeriesCache();
if (!ingested) process.exitCode = 1;
