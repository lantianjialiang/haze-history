import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import cities from "../../data/cities-cn.json";
import { pm25ToAqi } from "../../shared/aqi.ts";
import { FIRST_DAY, today, yearsBetween } from "../../shared/dates.ts";
import { staticCities } from "../../shared/geocode.ts";
import type { HourlyRecord, SeriesResponse } from "../../shared/types.ts";
import { EmbassyStore, embassyPath } from "../embassy.ts";
import { createRegistry } from "../local.ts";
import { historyPath, HistoryStore } from "../quotsoft.ts";
import { readComparison } from "../recent.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const out = resolve(root, "web/public/data");

function coverageEnd(to: string | "now") {
  return to === "now" ? today() : to;
}

async function writeJson(path: string, value: unknown) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(value));
}

function hourlyShardKey(cityId: string, providerId: string, year: string) {
  return resolve(out, "hours", cityId, providerId, year + ".json");
}

async function mergeHourlyShards(
  rows: { city_id: string; date: string; hour: number; pm25: number | null; pm10?: number | null }[],
  providerId: string,
) {
  const shards = new Map<string, Record<string, HourlyRecord[]>>();
  const dayHours = new Map<string, Map<number, HourlyRecord>>();
  const key = (cityId: string, date: string) => cityId + "|" + date;
  for (const row of rows) {
    const slotKey = key(row.city_id, row.date);
    const byHour = dayHours.get(slotKey) ?? new Map<number, HourlyRecord>();
    const pm25 = row.pm25;
    byHour.set(row.hour, {
      hour: row.hour,
      pm25,
      pm10: row.pm10 ?? null,
      aqi: pm25 == null ? null : pm25ToAqi(pm25),
      visibility_km: null,
      rh: null,
    });
    dayHours.set(slotKey, byHour);
  }
  for (const [slotKey, byHour] of dayHours) {
    const [cityId, date] = slotKey.split("|");
    const year = date.slice(0, 4);
    const shardPath = hourlyShardKey(cityId, providerId, year);
    const shard = shards.get(shardPath) ?? {};
    shard[date] = Array.from({ length: 24 }, (_, hour) =>
      byHour.get(hour) ?? {
        hour,
        pm25: null,
        pm10: null,
        aqi: null,
        visibility_km: null,
        rh: null,
      },
    );
    shards.set(shardPath, shard);
  }
  for (const [path, shard] of shards) {
    let merged = shard;
    try {
      const { readFile } = await import("node:fs/promises");
      const existing = JSON.parse(await readFile(path, "utf8")) as Record<
        string,
        HourlyRecord[]
      >;
      merged = { ...existing, ...shard };
    } catch {
      // fresh shard
    }
    await writeJson(path, merged);
  }
}

async function exportSeries(registry: ReturnType<typeof createRegistry>) {
  for (const city of cities) {
    const ref = staticCities.get(city.id);
    if (!ref) continue;
    for (const meta of registry.list()) {
      const provider = registry.get(meta.id);
      if (!provider) continue;
      const from =
        meta.coverage.from < FIRST_DAY ? FIRST_DAY : meta.coverage.from;
      const end = coverageEnd(meta.coverage.to);
      if (from > end) continue;
      for (const year of yearsBetween(from, end)) {
        const yearFrom = year + "-01-01";
        const yearTo = year === end.slice(0, 4) ? end : year + "-12-31";
        try {
          const data = await provider.getDailySeries(
            ref,
            yearFrom,
            yearTo,
            meta.metrics,
          );
          const payload: SeriesResponse = {
            ...data,
            meta: { ...data.meta, cacheHit: true },
          };
          await writeJson(
            resolve(out, "series", city.id, meta.id, year + ".json"),
            payload,
          );
        } catch (error) {
          console.log(
            "series skip",
            city.id,
            meta.id,
            year,
            error instanceof Error ? error.message : error,
          );
        }
      }
      console.log("series", city.id, meta.id);
    }
  }
}

async function exportHourlySqlite(
  store: { db: { prepare: (sql: string) => { all: () => unknown[] } }; close: () => void },
  providerId: string,
  columns: string,
) {
  const rows = store.db
    .prepare(`SELECT ${columns} FROM hourly ORDER BY city_id, date, hour`)
    .all() as {
    city_id: string;
    date: string;
    hour: number;
    pm25: number | null;
    pm10?: number | null;
  }[];
  await mergeHourlyShards(rows, providerId);
  console.log("hours", providerId, rows.length, "slots");
}

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
const registry = createRegistry(root);
await writeJson(resolve(out, "sources.json"), registry.list());
await writeJson(resolve(out, "recent-comparison.json"), readComparison(root));
await exportSeries(registry);
const embassy = new EmbassyStore(embassyPath(root));
try {
  await exportHourlySqlite(embassy, "stateair-embassy", "city_id, date, hour, pm25");
} finally {
  embassy.close();
}
const history = new HistoryStore(historyPath(root));
try {
  const count = history.db
    .prepare("SELECT COUNT(*) AS n FROM hourly")
    .get() as { n: number };
  if (count.n) {
    await exportHourlySqlite(
      history,
      "quotsoft-cnemc",
      "city_id, date, hour, pm25, pm10",
    );
  } else {
    console.log("hours quotsoft-cnemc skipped (empty cache)");
  }
} finally {
  history.close();
}
console.log("static export wrote", out);