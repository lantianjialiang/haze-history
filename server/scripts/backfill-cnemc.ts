import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import overview from "../../data/cities-overview.json" with { type: "json" };

const root = fileURLToPath(new URL("../../", import.meta.url));
const dir = resolve(root, "data/recent");
const cities = overview as {
  id: string;
  name: { zh: string; en: string };
}[];
const byName = new Map(cities.map((city) => [city.name.zh, city.id]));
const headers = {
  "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
  "X-Requested-With": "XMLHttpRequest",
  Origin: "https://air.cnemc.cn:18007",
  Referer: "https://air.cnemc.cn:18007/",
  "User-Agent": "Mozilla/5.0",
};

function numeric(value: unknown) {
  if (typeof value !== "string" || !value || value === "—" || value === "NA")
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
function addHours(stamp: string, hours: number) {
  const parsed = Date.parse(stamp.replace(" ", "T") + "+08:00");
  return (
    new Date(parsed + hours * 3600000)
      .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
      .slice(0, 13) + ":00:00"
  );
}
function label(stamp: string) {
  const [date, time] = stamp.split(" ");
  const [year, month, day] = date.split("-");
  return `${year}年${Number(month)}月${Number(day)}日 ${Number(time.slice(0, 2))}时`;
}

interface Row {
  Area?: string;
  TimePointStr?: string;
  PM2_5?: string;
  PM10?: string;
  PM2_5_24h?: string;
  AQI?: string;
}

async function hour(stamp: string) {
  let mismatch = false;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(
        "https://air.cnemc.cn:18007/HourChangesPublish/GetAQIHistoryByConditionHis",
        {
          method: "POST",
          headers,
          body: "date=" + encodeURIComponent(stamp),
          signal: AbortSignal.timeout(15000),
        },
      );
      const rows = (await response.json()) as Row[];
      if (rows.some((row) => row.TimePointStr === label(stamp))) return rows;
      mismatch = true;
      break;
    } catch (error) {
      console.log(
        "retry",
        stamp,
        attempt,
        error instanceof Error ? error.message : error,
      );
    }
  }
  return mismatch ? "mismatch" : "error";
}

function buckets(rows: Row[]) {
  const grouped = new Map<
    string,
    { pm25: number[]; pm10: number[]; aqi: number[]; day: number[] }
  >();
  for (const row of rows) {
    const id = byName.get(row.Area?.replace(/市$/, "") ?? "");
    if (!id) continue;
    const bucket = grouped.get(id) ?? { pm25: [], pm10: [], aqi: [], day: [] };
    const pm25 = numeric(row.PM2_5);
    const pm10 = numeric(row.PM10);
    const aqi = numeric(row.AQI);
    const day = numeric(row.PM2_5_24h);
    if (pm25 != null) bucket.pm25.push(pm25);
    if (pm10 != null) bucket.pm10.push(pm10);
    if (aqi != null) bucket.aqi.push(aqi);
    if (day != null) bucket.day.push(day);
    grouped.set(id, bucket);
  }
  return grouped;
}

const breaks: [number, number, number, number][] = [
  [0, 35, 0, 50],
  [35, 75, 50, 100],
  [75, 115, 100, 150],
  [115, 150, 150, 200],
  [150, 250, 200, 300],
  [250, 350, 300, 400],
  [350, 500, 400, 500],
];
function pm25ToAqi(value: number) {
  const sample = Math.min(Math.max(value, 0), 500);
  const band = breaks.find(([, high]) => sample <= high) ?? breaks.at(-1)!;
  const [low, high, indexLow, indexHigh] = band;
  return Math.round(
    ((indexHigh - indexLow) / (high - low)) * (sample - low) + indexLow,
  );
}

async function main() {
  const liveResponse = await fetch(
    "https://air.cnemc.cn:18007/HourChangesPublish/GetAllAQIPublishLive",
    { method: "POST", headers, body: "", signal: AbortSignal.timeout(20000) },
  );
  const liveRows = (await liveResponse.json()) as Row[];
  const anchorLabel = liveRows.find((row) => row.TimePointStr)?.TimePointStr ?? "";
  const matched = anchorLabel.match(/(\d+)年(\d+)月(\d+)日\s+(\d+)时/);
  if (!matched) throw new Error("no anchor");
  const anchor = `${matched[1]}-${matched[2].padStart(2, "0")}-${matched[3].padStart(2, "0")} ${matched[4].padStart(2, "0")}:00:00`;
  console.log("anchor", anchor);
  const hourly = new Map<string, ReturnType<typeof buckets>>();
  for (let back = 0; back <= 30; back++) {
    const stamp = addHours(anchor, -back);
    const result = await hour(stamp);
    if (result === "mismatch") {
      console.log("mismatch", stamp);
      continue;
    }
    if (result === "error") {
      console.log("skip", stamp);
      continue;
    }
    hourly.set(stamp, buckets(result));
    console.log("hit", stamp);
  }
  const byCity = new Map<
    string,
    Map<string, { pm25: number; pm10: number | null; aqi: number; day: number | null; stations: number }>
  >();
  for (const [stamp, grouped] of hourly) {
    for (const [id, bucket] of grouped) {
      if (!bucket.pm25.length) continue;
      const city = byCity.get(id) ?? new Map();
      city.set(stamp, {
        pm25: round(mean(bucket.pm25)),
        pm10: bucket.pm10.length ? round(mean(bucket.pm10)) : null,
        aqi: Math.round(mean(bucket.aqi)),
        day: bucket.day.length ? round(mean(bucket.day)) : null,
        stations: bucket.pm25.length,
      });
      byCity.set(id, city);
    }
  }
  const measured: Record<string, unknown[]> = {};
  for (const city of cities) {
    const hours = byCity.get(city.id) ?? new Map();
    const dates = new Map<string, { pm25: number[]; pm10: number[]; day: number | null; stations: number }>();
    for (const [stamp, value] of [...hours].sort(([a], [b]) => a.localeCompare(b))) {
      const date = stamp.slice(0, 10);
      const group = dates.get(date) ?? { pm25: [], pm10: [], day: null, stations: 0 };
      group.pm25.push(value.pm25);
      if (value.pm10 != null) group.pm10.push(value.pm10);
      if (value.day != null) group.day = value.day;
      group.stations = value.stations;
      dates.set(date, group);
    }
    measured[city.id] = [...dates].map(([date, group]) => {
      const enough = group.pm25.length >= 12;
      const pm25 = enough ? round(mean(group.pm25)) : group.day;
      return {
        date,
        pm25,
        pm10: group.pm10.length >= 12 ? round(mean(group.pm10)) : null,
        aqi: pm25 == null ? null : pm25ToAqi(pm25),
        validHours: group.pm25.length,
        stations: group.stations,
        method: enough ? "hourly-mean" : "published-24h",
      };
    });
  }
  const live = buckets(liveRows);
  const latest = cities.map((city) => {
    const bucket = live.get(city.id);
    return {
      id: city.id,
      pm25: bucket?.pm25.length ? round(mean(bucket.pm25)) : null,
      pm25_24h: bucket?.day.length ? round(mean(bucket.day)) : null,
      aqi: bucket?.aqi.length ? Math.round(mean(bucket.aqi)) : null,
      stations: bucket?.pm25.length ?? 0,
    };
  });
  const cams = JSON.parse(await readFile(resolve(dir, "cams.json"), "utf8")) as {
    cams24h?: Record<string, number | null>;
    cities: Record<string, { date: string; pm25: number | null }[]>;
  };
  const comparisonCities = cities.map((city) => {
    const measuredDays = new Map(
      (measured[city.id] as { date: string; pm25: number | null }[])
        .filter((day) => day.pm25 != null)
        .map((day) => [day.date, day.pm25!]),
    );
    const modelDays = new Map(
      (cams.cities[city.id] ?? [])
        .filter((day) => day.pm25 != null)
        .map((day) => [day.date, day.pm25!]),
    );
    const overlap = [...measuredDays]
      .filter(([date]) => modelDays.has(date))
      .map(([date, value]) => [value, modelDays.get(date)!] as [number, number]);
    return {
      id: city.id,
      name: city.name,
      latest: latest.find((item) => item.id === city.id) ?? null,
      cams24h: cams.cams24h?.[city.id] ?? null,
      overlapDays: overlap.length,
      bias:
        overlap.length === 0
          ? null
          : round(mean(overlap.map(([left, right]) => right - left))),
      measuredOver75: overlap.filter(([value]) => value > 75).length,
      modelOver75: overlap.filter(([, value]) => value > 75).length,
      measuredDays: measuredDays.size,
      modelDays: modelDays.size,
    };
  });
  const fetchedAt = new Date().toISOString();
  await writeFile(
    resolve(dir, "measured.json"),
    JSON.stringify({ fetchedAt, anchor, cities: measured }),
  );
  await writeFile(
    resolve(dir, "comparison.json"),
    JSON.stringify(
      {
        fetchedAt,
        anchor,
        quotsoftDays: 0,
        cnemcHours: hourly.size,
        measuredMinHours: 12,
        cams: { from: "2026-10-15", to: addHours(anchor, -24).slice(0, 10) },
        cities: comparisonCities,
      },
      null,
      2,
    ),
  );
  console.log(
    "backfill hours",
    hourly.size,
    "cities with a day",
    comparisonCities.filter((city) => city.measuredDays > 0).length,
    "overlap cities",
    comparisonCities.filter((city) => city.overlapDays > 0).length,
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
