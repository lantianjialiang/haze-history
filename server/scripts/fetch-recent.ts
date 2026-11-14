import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import overview from "../../data/cities-overview.json" with { type: "json" };
import {
  HistoryStore,
  historyPath,
  parseCityCsv,
  type CityColumn,
} from "../quotsoft.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const outDir = resolve(root, "data/recent");
async function publish(path: string, value: string) {
  const temporary = path + "." + process.pid + ".tmp";
  await writeFile(temporary, value);
  await rename(temporary, path);
}
const cities = overview as {
  id: string;
  name: { zh: string; en: string };
  lat: number;
  lon: number;
}[];
const cityColumns = cities.map((city) => ({
  id: city.id,
  name: city.name.zh,
})) satisfies CityColumn[];
const byName = new Map(cities.map((city) => [city.name.zh, city]));

const pmBreaks: [number, number, number, number][] = [
  [0, 35, 0, 50],
  [35, 75, 50, 100],
  [75, 115, 100, 150],
  [115, 150, 150, 200],
  [150, 250, 200, 300],
  [250, 350, 300, 400],
  [350, 500, 400, 500],
];

export function pm25ToAqi(value: number) {
  const sample = Math.min(Math.max(value, 0), 500);
  const band =
    pmBreaks.find(([, high]) => sample <= high) ??
    pmBreaks[pmBreaks.length - 1];
  const [low, high, indexLow, indexHigh] = band;
  return Math.round(
    ((indexHigh - indexLow) / (high - low)) * (sample - low) + indexLow,
  );
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || value === "—" || value === "NA" || !value)
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stampLabel(stamp: string) {
  const [date, time] = stamp.split(" ");
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日 ${Number(time.slice(0, 2))}时`;
}

function addHours(stamp: string, hours: number) {
  const parsed = Date.parse(stamp.replace(" ", "T") + "+08:00");
  const formatted = new Date(parsed + hours * 3600000).toLocaleString("sv-SE", {
    timeZone: "Asia/Shanghai",
  });
  return formatted.slice(0, 13) + ":00:00";
}

async function request(url: string, init: RequestInit, timeout = 25000) {
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      });
      if (response.status >= 500) throw new Error("HTTP " + response.status);
      return response;
    } catch (error) {
      last = error;
      await new Promise((resolve) => setTimeout(resolve, 700 * (attempt + 1)));
    }
  }
  throw last;
}

const cnemcHeaders = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: "https://air.cnemc.cn:18007",
  Referer: "https://air.cnemc.cn:18007/",
  "User-Agent": "Mozilla/5.0",
};

interface StationRow {
  Area?: string;
  PositionName?: string;
  PM2_5?: string;
  PM2_5_24h?: string;
  PM10?: string;
  AQI?: string;
  TimePointStr?: string;
}

async function cnemcHour(stamp: string) {
  const response = await request(
    "https://air.cnemc.cn:18007/HourChangesPublish/GetAQIHistoryByConditionHis",
    {
      method: "POST",
      headers: cnemcHeaders,
      body: "date=" + encodeURIComponent(stamp),
    },
  );
  const rows = (await response.json()) as StationRow[];
  const expected = stampLabel(stamp);
  if (!rows.some((row) => row.TimePointStr === expected)) return null;
  return rows;
}

function cityBuckets(rows: StationRow[]) {
  const buckets = new Map<
    string,
    { pm25: number[]; pm10: number[]; aqi: number[]; pm25_24h: number[] }
  >();
  for (const row of rows) {
    const area = row.Area?.replace(/市$/, "") ?? "";
    const city = byName.get(area);
    if (!city) continue;
    const bucket = buckets.get(city.id) ?? {
      pm25: [],
      pm10: [],
      aqi: [],
      pm25_24h: [],
    };
    const pm25 = numeric(row.PM2_5);
    const pm10 = numeric(row.PM10);
    const aqi = numeric(row.AQI);
    const day = numeric(row.PM2_5_24h);
    if (pm25 != null) bucket.pm25.push(pm25);
    if (pm10 != null) bucket.pm10.push(pm10);
    if (aqi != null) bucket.aqi.push(aqi);
    if (day != null) bucket.pm25_24h.push(day);
    buckets.set(city.id, bucket);
  }
  return buckets;
}

interface HourValue {
  pm25: number | null;
  pm10: number | null;
  aqi: number | null;
  pm25_24h: number | null;
  stations: number;
}

async function collectCnemc() {
  const live = await request(
    "https://air.cnemc.cn:18007/HourChangesPublish/GetAllAQIPublishLive",
    { method: "POST", headers: cnemcHeaders, body: "" },
  );
  const liveRows = (await live.json()) as StationRow[];
  const anchorLabel = liveRows.find((row) => row.TimePointStr)?.TimePointStr;
  const matched = anchorLabel?.match(/(\d+)年(\d+)月(\d+)日\s+(\d+)时/);
  if (!matched) throw new Error("CNEMC live timestamp missing");
  const anchor = `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")} ${matched[4].padStart(2, "0")}:00:00`;
  console.log("cnemc anchor", anchor, "stations", liveRows.length);
  const hours: string[] = [];
  let misses = 0;
  for (let back = 0; back <= 24 * 3; back++) {
    const stamp = addHours(anchor, -back);
    const rows = await cnemcHour(stamp).catch(() => null);
    if (!rows) {
      misses++;
      console.log("cnemc miss", stamp, "streak", misses);
      if (misses >= 3 && hours.length) break;
      if (misses >= 6 && !hours.length) break;
      continue;
    }
    misses = 0;
    hours.push(stamp);
    console.log("cnemc hit", stamp, "rows", rows.length);
    if (!collectCnemc.cache) collectCnemc.cache = new Map();
    collectCnemc.cache.set(stamp, cityBuckets(rows));
    if (hours.length >= 24 * 4) break;
  }
  return { anchor, hours, live: cityBuckets(liveRows) };
}
collectCnemc.cache = new Map<string, ReturnType<typeof cityBuckets>>() as Map<
  string,
  ReturnType<typeof cityBuckets>
> & { cache?: Map<string, ReturnType<typeof cityBuckets>> };

interface DayValue {
  date: string;
  pm25: number | null;
  pm10: number | null;
  aqi: number | null;
  aqiPublished: number | null;
  validHours: number;
  stations: number | null;
}

function rollDays(
  hours: Map<string, HourValue>,
  minHours: number,
  usePublishedAqi: boolean,
) {
  const grouped = new Map<string, HourValue[]>();
  for (const [stamp, value] of hours) {
    const date = stamp.slice(0, 10);
    grouped.set(date, [...(grouped.get(date) ?? []), value]);
  }
  const days: DayValue[] = [];
  for (const [date, values] of [...grouped].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const pm25Hours = values.filter((value) => value.pm25 != null);
    const pm25 = mean(pm25Hours.map((value) => value.pm25!));
    const pm10 = mean(
      values.flatMap((value) => (value.pm10 == null ? [] : [value.pm10])),
    );
    const published = mean(
      values.flatMap((value) => (value.aqi == null ? [] : [value.aqi])),
    );
    days.push({
      date,
      pm25:
        pm25Hours.length >= minHours && pm25 != null ? round(pm25, 1) : null,
      pm10:
        values.filter((value) => value.pm10 != null).length >= minHours &&
        pm10 != null
          ? round(pm10, 1)
          : null,
      aqi:
        pm25Hours.length >= minHours && pm25 != null
          ? usePublishedAqi && published != null
            ? Math.round(published)
            : pm25ToAqi(pm25)
          : null,
      aqiPublished: published == null ? null : Math.round(published),
      validHours: pm25Hours.length,
      stations: values.at(-1)?.stations ?? null,
    });
  }
  return days;
}

function round(value: number, digits: number) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

async function quotsoftDay(date: string) {
  const url =
    "https://quotsoft.net/air/data/china_cities_" +
    date.replaceAll("-", "") +
    ".csv";
  const response = await request(
    url,
    { headers: { "User-Agent": "haze-history-local" } },
    40000,
  );
  if (!response.ok) return null;
  const text = await response.text();
  if (!text.includes("PM2.5")) return null;
  const [header, ...lines] = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  const columns = header.split(",");
  const indexes = new Map<string, number>();
  cities.forEach((city) => {
    const index = columns.indexOf(city.name.zh);
    if (index >= 0) indexes.set(city.id, index);
  });
  const hours = new Map<string, Map<string, HourValue>>();
  for (const line of lines) {
    if (!line) continue;
    const cells = line.split(",");
    const type = cells[2];
    if (type !== "PM2.5" && type !== "PM10" && type !== "AQI") continue;
    const rawDate = cells[0]?.trim() ?? "";
    const date = /^\d{8}$/.test(rawDate)
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : rawDate.replaceAll("/", "-");
    const stamp = `${date} ${cells[1].trim().padStart(2, "0")}:00:00`;
    for (const [id, index] of indexes) {
      const cityHours = hours.get(id) ?? new Map<string, HourValue>();
      const current = cityHours.get(stamp) ?? {
        pm25: null,
        pm10: null,
        aqi: null,
        pm25_24h: null,
        stations: 1,
      };
      const value = numeric(cells[index]);
      if (type === "PM2.5") current.pm25 = value;
      if (type === "PM10") current.pm10 = value;
      if (type === "AQI") current.aqi = value;
      cityHours.set(stamp, current);
      hours.set(id, cityHours);
    }
  }
  return { hours, text };
}

async function openMeteo(
  path: string,
  hourly: string,
  range: { start: string; end: string } | { pastDays: number },
) {
  const chunkSize = 8;
  const rows: {
    id: string;
    time: string[];
    values: Record<string, (number | null)[]>;
  }[] = [];
  for (let index = 0; index < cities.length; index += chunkSize) {
    const chunk = cities.slice(index, index + chunkSize);
    const params = new URLSearchParams({
      latitude: chunk.map((city) => city.lat).join(","),
      longitude: chunk.map((city) => city.lon).join(","),
      hourly,
      timezone: "Asia/Shanghai",
    });
    if ("pastDays" in range) {
      params.set("past_days", String(range.pastDays));
      params.set("forecast_days", "1");
    } else {
      params.set("start_date", range.start);
      params.set("end_date", range.end);
    }
    if (path.includes("air-quality")) params.set("domains", "cams_global");
    const response = await request(
      path + "?" + params,
      { headers: { "User-Agent": "haze-history-local" } },
      40000,
    );
    const payload = (await response.json()) as
      | { hourly?: { time: string[] } & Record<string, (number | null)[]> }
      | { hourly?: { time: string[] } & Record<string, (number | null)[]> }[];
    const list = Array.isArray(payload) ? payload : [payload];
    list.forEach((item, offset) => {
      const city = chunk[offset];
      if (!city || !item.hourly) return;
      const values: Record<string, (number | null)[]> = {};
      for (const key of hourly.split(","))
        values[key] = item.hourly![key] ?? [];
      rows.push({ id: city.id, time: item.hourly.time, values });
    });
    console.log(
      "open-meteo",
      path.includes("air") ? "cams" : "weather",
      index + chunk.length,
    );
    await new Promise((resolve) => setTimeout(resolve, 1800));
  }
  return rows;
}

function daysFromHourly(
  time: string[],
  series: Record<string, (number | null)[]>,
  minHours: number,
  pick: (hour: Record<string, number | null>) => HourValue,
) {
  const hours = new Map<string, HourValue>();
  time.forEach((stamp, index) => {
    const hour: Record<string, number | null> = {};
    for (const [key, values] of Object.entries(series))
      hour[key] = values[index] ?? null;
    hours.set(stamp.slice(0, 13).replace("T", " ") + ":00:00", pick(hour));
  });
  return rollDays(hours, minHours, false);
}

function pearson(pairs: [number, number][]) {
  if (pairs.length < 3) return null;
  const left = pairs.map(([value]) => value);
  const right = pairs.map(([, value]) => value);
  const meanLeft = mean(left)!;
  const meanRight = mean(right)!;
  let xy = 0;
  let xx = 0;
  let yy = 0;
  pairs.forEach(([a, b]) => {
    xy += (a - meanLeft) * (b - meanRight);
    xx += (a - meanLeft) ** 2;
    yy += (b - meanRight) ** 2;
  });
  const denom = Math.sqrt(xx * yy);
  return denom === 0 ? null : round(xy / denom, 3);
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const measuredHours = new Map<string, Map<string, HourValue>>();
  const history = new HistoryStore(historyPath(root));
  let quotsoftDays = 0;
  let archivedDays = 0;
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Shanghai",
  });
  const historyDays = process.argv.includes("--incremental") ? 7 : 21;
  try {
  for (let back = 1; back <= historyDays; back++) {
    const date = addHours(today + " 12:00:00", -24 * back).slice(0, 10);
    try {
      const parsed = await quotsoftDay(date);
      if (!parsed) {
        console.log("quotsoft empty", date);
        if (back > 2 && quotsoftDays === 0) break;
        continue;
      }
      quotsoftDays++;
      console.log("quotsoft", date, "cities", parsed.hours.size);
      for (const [id, hours] of parsed.hours) {
        const city = measuredHours.get(id) ?? new Map();
        for (const [stamp, value] of hours) city.set(stamp, value);
        measuredHours.set(id, city);
      }
      if (!history.done(date, "cities-national") && !history.done(date, "cities")) {
        const rows = parseCityCsv(parsed.text, cityColumns, true).filter(
          (row) => row.date === date,
        );
        await history.saveDay(
          date,
          "cities-national",
          "ok",
          rows,
          Buffer.byteLength(parsed.text),
        );
        archivedDays++;
        console.log("archived", date, "rows", rows.length);
      }
    } catch (error) {
      console.log(
        "quotsoft fail",
        date,
        error instanceof Error ? error.message : error,
      );
      if (quotsoftDays === 0) break;
    }
  }

  const cnemc = await collectCnemc().catch((error: unknown) => {
    console.error(
      "CNEMC live unavailable; continuing with archive and models",
      error,
    );
    process.exitCode = 1;
    const live: ReturnType<typeof cityBuckets> = new Map();
    return { anchor: null, hours: [], live };
  });
  for (const [stamp, buckets] of collectCnemc.cache ?? []) {
    for (const [id, bucket] of buckets) {
      const city = measuredHours.get(id) ?? new Map();
      if (city.has(stamp) && city.get(stamp)?.pm25 != null) continue;
      city.set(stamp, {
        pm25: mean(bucket.pm25) == null ? null : round(mean(bucket.pm25)!, 1),
        pm10: mean(bucket.pm10) == null ? null : round(mean(bucket.pm10)!, 1),
        aqi: mean(bucket.aqi) == null ? null : Math.round(mean(bucket.aqi)!),
        pm25_24h:
          mean(bucket.pm25_24h) == null
            ? null
            : round(mean(bucket.pm25_24h)!, 1),
        stations: bucket.pm25.length,
      });
      measuredHours.set(id, city);
    }
  }

  const latestSnapshot = [...cnemc.live].map(([id, bucket]) => ({
    id,
    pm25: mean(bucket.pm25) == null ? null : round(mean(bucket.pm25)!, 1),
    pm25_24h:
      mean(bucket.pm25_24h) == null ? null : round(mean(bucket.pm25_24h)!, 1),
    aqi: mean(bucket.aqi) == null ? null : Math.round(mean(bucket.aqi)!),
    stations: bucket.pm25.length,
  }));

  const measured = Object.fromEntries(
    cities.map((city) => [
      city.id,
      rollDays(measuredHours.get(city.id) ?? new Map(), 12, false),
    ]),
  );
  const camsEnd = addHours(today + " 12:00:00", -24).slice(0, 10);
  const camsStart = addHours(today + " 12:00:00", -31 * 24).slice(0, 10);
  const camsRows = await openMeteo(
    "https://air-quality-api.open-meteo.com/v1/air-quality",
    "pm2_5,pm10",
    { start: camsStart, end: camsEnd },
  );
  const camsFresh = Object.fromEntries(
    camsRows.map((row) => [
      row.id,
      daysFromHourly(row.time, row.values, 18, (hour) => ({
        pm25: hour.pm2_5,
        pm10: hour.pm10,
        aqi: null,
        pm25_24h: null,
        stations: 0,
      })),
    ]),
  );
  const camsPath = resolve(outDir, "cams.json");
  const camsArchive = await readFile(camsPath, "utf8").then(
    (raw) => JSON.parse(raw) as { cities?: typeof camsFresh },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return { cities: {} as typeof camsFresh };
    },
  );
  const cams: typeof camsFresh = { ...(camsArchive.cities ?? {}) };
  for (const [id, days] of Object.entries(camsFresh)) {
    const byDay = new Map(
      (cams[id] ?? [])
        .filter((day) => day.date < today)
        .map((day) => [day.date, day]),
    );
    for (const day of days) {
      if (day.date < today && day.pm25 != null) byDay.set(day.date, day);
    }
    cams[id] = [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
  const weatherRows = await openMeteo(
    "https://api.open-meteo.com/v1/forecast",
    "relative_humidity_2m,visibility",
    { pastDays: 31 },
  );
  const meteo = Object.fromEntries(
    weatherRows.map((row) => {
      const hours = new Map<string, HourValue>();
      row.time.forEach((stamp, index) => {
        const visibility = row.values.visibility?.[index];
        const rh = row.values.relative_humidity_2m?.[index];
        hours.set(stamp.slice(0, 13).replace("T", " ") + ":00:00", {
          pm25: rh,
          pm10: visibility == null ? null : visibility / 1000,
          aqi: null,
          pm25_24h: null,
          stations: 0,
        });
      });
      return [
        row.id,
        rollDays(hours, 18, false).map((day) => ({
          date: day.date,
          rh: day.pm25,
          visibility_km: day.pm10 == null ? null : round(day.pm10, 1),
          validHours: day.validHours,
        })),
      ];
    }),
  );
  const meteoPath = resolve(outDir, "meteo.json");
  if (
    !Object.values(meteo).some((days) =>
      days.some(
        (day) =>
          day.date < today && day.visibility_km != null && day.rh != null,
      ),
    )
  ) {
    throw new Error("No complete historical weather model days returned");
  }
  const archive = await readFile(meteoPath, "utf8").then(
    (raw) => JSON.parse(raw) as { cities: typeof meteo },
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return { cities: {} as typeof meteo };
    },
  );
  const weatherHistory = { ...archive.cities };
  for (const [id, days] of Object.entries(meteo)) {
    const byDay = new Map(
      (weatherHistory[id] ?? [])
        .filter((day) => day.date < today)
        .map((day) => [day.date, day]),
    );
    for (const day of days) {
      if (day.date < today && day.visibility_km != null && day.rh != null)
        byDay.set(day.date, day);
    }
    weatherHistory[id] = [...byDay.values()].sort((a, b) =>
      a.date.localeCompare(b.date),
    );
  }

  const cams24 = new Map(
    camsRows.map((row) => {
      const values = (row.values.pm2_5 ?? []).filter(
        (value): value is number => value != null,
      );
      const window = values.slice(-24);
      return [
        row.id,
        window.length >= 18 ? round(mean(window)!, 1) : null,
      ] as const;
    }),
  );
  const comparison = cities.map((city) => {
    const measuredDays = new Map(
      (measured[city.id] ?? [])
        .filter((day) => day.pm25 != null)
        .map((day) => [day.date, day]),
    );
    const modelDays = new Map(
      (cams[city.id] ?? [])
        .filter((day) => day.pm25 != null)
        .map((day) => [day.date, day]),
    );
    const overlap = [...measuredDays]
      .filter(([date]) => modelDays.has(date))
      .map(
        ([date, day]) =>
          [day.pm25!, modelDays.get(date)!.pm25!] as [number, number],
      );
    const snap = latestSnapshot.find((item) => item.id === city.id);
    return {
      id: city.id,
      name: city.name,
      latest: snap ?? null,
      cams24h: cams24.get(city.id) ?? null,
      overlapDays: overlap.length,
      bias:
        overlap.length === 0
          ? null
          : round(mean(overlap.map(([left, right]) => right - left))!, 1),
      correlation: pearson(overlap),
      measuredOver75: overlap.filter(([value]) => value > 75).length,
      modelOver75: overlap.filter(([, value]) => value > 75).length,
      measuredDays: measuredDays.size,
      modelDays: modelDays.size,
    };
  });

  const payload = {
    fetchedAt: new Date().toISOString(),
    anchor: cnemc.anchor,
    quotsoftDays,
    cnemcHours: cnemc.hours.length,
    measuredMinHours: 12,
    modelMinHours: 18,
    cams: { from: camsStart, to: camsEnd },
    cities: comparison,
  };
  const snapshotDir = resolve(root, "data/archive");
  await mkdir(snapshotDir, { recursive: true });
  const snapshotId = payload.fetchedAt.replace(/[:.]/g, "-") + "-" + process.pid;
  // Archive the exact inputs to publication before replacing any current view.
  await publish(resolve(snapshotDir, snapshotId + ".json"), JSON.stringify({
    metadata: payload,
    measured,
    cams,
    meteo: Object.fromEntries(Object.entries(meteo).map(([id, days]) => [
      id, days.filter(day => day.date < today),
    ])),
  }));
  await publish(
    resolve(outDir, "measured.json"),
    JSON.stringify({
      fetchedAt: payload.fetchedAt,
      anchor: cnemc.anchor,
      cities: measured,
    }),
  );
  await publish(
    camsPath,
    JSON.stringify({
      fetchedAt: payload.fetchedAt,
      from: camsStart,
      to: camsEnd,
      cities: cams,
    }),
  );
  await publish(
    meteoPath,
    JSON.stringify({ fetchedAt: payload.fetchedAt, cities: weatherHistory }),
  );
  await publish(
    resolve(outDir, "comparison.json"),
    JSON.stringify(payload, null, 2),
  );
  console.log(
    "done",
    "quotsoftDays",
    quotsoftDays,
    "archived",
    archivedDays,
    "cnemcHours",
    cnemc.hours.length,
    "compared",
    comparison.filter((city) => city.overlapDays > 0).length,
    "history",
    history.status(),
  );
  } finally {
    history.close();
  }
}

if (process.argv[1] && dirname(process.argv[1]).endsWith("spike") === false)
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
