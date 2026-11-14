import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import overview from "../../data/cities-overview.json" with { type: "json" };
import { dateRange, shiftDate, today } from "../../shared/dates.ts";
import {
  BEIJING_START,
  CITIES_START,
  HistoryStore,
  historyPath,
  parseBeijingCsv,
  parseCityCsv,
  type CityColumn,
} from "../quotsoft.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cities = (overview as { id: string; name: { zh: string } }[]).map(
  (city) => ({ id: city.id, name: city.name.zh }),
) satisfies CityColumn[];
const store = new HistoryStore(historyPath(root));
const yesterday = shiftDate(today(), -1);
const concurrency = Number(process.env.HISTORY_CONCURRENCY ?? 2);
const pauseMs = Number(process.env.HISTORY_DELAY_MS ?? 250);
const base = "https://quotsoft.net/air/data/";

async function request(
  url: string,
  init: RequestInit,
  timeout = 20000,
) {
  let last: unknown;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeout),
        headers: {
          "User-Agent": "haze-history-local/0.2",
          ...(init.headers ?? {}),
        },
      });
      if (response.status === 404) return response;
      if (response.status === 429) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const wait = (Number.isFinite(retryAfter) ? retryAfter : 8 + attempt * 4) * 1000;
        await new Promise((resolve) => setTimeout(resolve, wait));
        last = new Error("HTTP 429");
        continue;
      }
      if (!response.ok && response.status !== 206)
        throw new Error("HTTP " + response.status);
      return response;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 800 * (attempt + 1)));
    }
  }
  throw last;
}

async function download(url: string) {
  try {
    const response = await request(url, { method: "GET" }, 60000);
    if (response.status === 404) return { status: "missing" as const, buffer: null };
    return {
      status: "ok" as const,
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  } catch {
    // full GET sometimes stalls; fall back to ranged reads
  }
  const head = await request(url, { method: "HEAD" }, 12000);
  if (head.status === 404) return { status: "missing" as const, buffer: null };
  const size = Number(head.headers.get("content-length") ?? 0);
  if (!size) throw new Error("no content-length");
  const step = Math.max(size, 512_000);
  const ranges: [number, number][] = [];
  for (let start = 0; start < size; start += step)
    ranges.push([start, Math.min(size - 1, start + step - 1)]);
  const parts: Buffer[] = [];
  for (const [start, end] of ranges) {
      const response = await request(
        url,
        { headers: { Range: `bytes=${start}-${end}` } },
        45000,
      );
    if (response.status === 404) return { status: "missing" as const, buffer: null };
    parts.push(Buffer.from(await response.arrayBuffer()));
  }
  return { status: "ok" as const, buffer: Buffer.concat(parts) };
}

async function pool<T>(items: T[], limit: number, work: (item: T) => Promise<void>) {
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (index < items.length) {
        const current = items[index++];
        await work(current);
      }
    }),
  );
}

async function ingest(
  kind: "cities" | "beijing",
  dates: string[],
) {
  const pending = dates.filter((date) => !store.done(date, kind));
  console.log(kind, "todo", pending.length, "/", dates.length);
  let ok = 0;
  let missing = 0;
  let failed = 0;
  const started = Date.now();
  await pool(pending, concurrency, async (date) => {
    const stamp = date.replaceAll("-", "");
    const file =
      kind === "cities"
        ? `china_cities_${stamp}.csv`
        : `beijing_all_${stamp}.csv`;
    try {
      console.log("get", kind, date);
      const result = await download(base + file);
      if (result.status === "missing" || !result.buffer) {
        await store.saveDay(date, kind, "missing", []);
        missing++;
        return;
      }
      const text = result.buffer.toString("utf8");
      const rows =
        kind === "cities"
          ? parseCityCsv(text, cities)
          : parseBeijingCsv(text);
      await store.saveDay(date, kind, "ok", rows, result.buffer.length);
      ok++;
      await new Promise((resolve) => setTimeout(resolve, pauseMs));
    } catch (error) {
      await store.saveDay(date, kind, "error", []);
      failed++;
      console.log(
        "fail",
        kind,
        date,
        error instanceof Error ? error.message : error,
      );
    }
    const done = ok + missing + failed;
    if (done % 25 === 0 || done === pending.length) {
      const elapsed = (Date.now() - started) / 60000;
      const rate = done / Math.max(elapsed, 0.01);
      const left = (pending.length - done) / Math.max(rate, 0.01);
      console.log(
        kind,
        done + "/" + pending.length,
        "ok",
        ok,
        "missing",
        missing,
        "error",
        failed,
        elapsed.toFixed(1) + "min",
        "eta",
        left.toFixed(1) + "min",
        store.status(),
      );
    }
  });
}

async function walkCityFiles(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const found: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...(await walkCityFiles(path)));
    else if (/^china_cities_\d{8}\.csv$/.test(entry.name)) found.push(path);
  }
  return found;
}

async function ingestLocal() {
  const localRoot = join(root, "data/cn-air");
  const files = await walkCityFiles(localRoot);
  console.log("local files", files.length);
  let ok = 0;
  for (const file of files) {
    const stamp = file.match(/china_cities_(\d{8})\.csv$/)?.[1];
    if (!stamp) continue;
    const date = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
    if (store.done(date, "cities")) continue;
    const text = await readFile(file, "utf8");
    if (text.startsWith("version https://git-lfs.github.com")) {
      console.log("lfs pointer", date);
      continue;
    }
    const rows = parseCityCsv(text, cities);
    await store.saveDay(date, "cities", "ok", rows, Buffer.byteLength(text));
    ok++;
    if (ok % 50 === 0) console.log("local", ok, date, store.status());
  }
  console.log("local done", ok, store.status());
}

const beijingDates = [...dateRange(BEIJING_START, shiftDate(CITIES_START, -1))];
const cityDates = [...dateRange(CITIES_START, yesterday)];
await ingest("beijing", beijingDates);
await ingestLocal();
if (process.env.HISTORY_SKIP_REMOTE !== "1")
  await ingest("cities", cityDates);
console.log("finished", store.status());
store.close();
