import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import overview from "../../data/cities-overview.json" with { type: "json" };

const cities = overview as { id: string; lat: number; lon: number }[];
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = resolve(root, "data/recent");

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
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

async function pull(url: string) {
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(45000),
        headers: { "User-Agent": "haze-history-local" },
      });
      if (!response.ok) throw new Error("HTTP " + response.status);
      return await response.json();
    } catch (error) {
      last = error;
      console.log("retry", attempt, error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
  }
  throw last;
}

function daily(time: string[], values: (number | null)[], minHours: number) {
  const groups = new Map<string, number[]>();
  time.forEach((stamp, index) => {
    const value = values[index];
    if (value == null) return;
    const date = stamp.slice(0, 10);
    groups.set(date, [...(groups.get(date) ?? []), value]);
  });
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, samples]) => ({
      date,
      value: samples.length >= minHours ? round(mean(samples)) : null,
      validHours: samples.length,
    }));
}

async function batch(
  base: string,
  hourly: string,
  params: Record<string, string>,
) {
  const rows: {
    id: string;
    time: string[];
    values: Record<string, (number | null)[]>;
  }[] = [];
  for (let index = 0; index < cities.length; index += 8) {
    const chunk = cities.slice(index, index + 8);
    const query = new URLSearchParams({
      latitude: chunk.map((city) => city.lat).join(","),
      longitude: chunk.map((city) => city.lon).join(","),
      hourly,
      timezone: "Asia/Shanghai",
      ...params,
    });
    const payload = await pull(base + "?" + query);
    const list = Array.isArray(payload) ? payload : [payload];
    list.forEach((item, offset) => {
      const city = chunk[offset];
      if (!city?.id || !item?.hourly) return;
      const values: Record<string, (number | null)[]> = {};
      for (const key of hourly.split(",")) values[key] = item.hourly[key] ?? [];
      rows.push({ id: city.id, time: item.hourly.time, values });
    });
    console.log(base.includes("air-quality") ? "cams" : "weather", index + chunk.length);
    await new Promise((resolve) => setTimeout(resolve, 1200));
  }
  return rows;
}

const end = new Date(Date.now() - 24 * 3600000).toLocaleDateString("en-CA", {
  timeZone: "Asia/Shanghai",
});
const camsRows = await batch(
  "https://air-quality-api.open-meteo.com/v1/air-quality",
  "pm2_5,pm10",
  { start_date: "2026-10-15", end_date: end, domains: "cams_global" },
);
const camsCities: Record<string, unknown[]> = {};
const cams24h: Record<string, number | null> = {};
for (const row of camsRows) {
  const pm = daily(row.time, row.values.pm2_5 ?? [], 18);
  const pm10 = daily(row.time, row.values.pm10 ?? [], 18);
  const pm10ByDate = new Map(pm10.map((day) => [day.date, day.value]));
  camsCities[row.id] = pm.map((day) => ({
    date: day.date,
    pm25: day.value,
    pm10: pm10ByDate.get(day.date) ?? null,
    aqi: day.value == null ? null : pm25ToAqi(day.value),
    validHours: day.validHours,
  }));
  const recent = (row.values.pm2_5 ?? []).filter(
    (value): value is number => value != null,
  );
  const window = recent.slice(-24);
  cams24h[row.id] = window.length >= 18 ? round(mean(window)) : null;
}
const meteoCities: Record<string, unknown[]> = {};
try {
  const weather = await batch(
    "https://api.open-meteo.com/v1/forecast",
    "relative_humidity_2m,visibility",
    { past_days: "31", forecast_days: "1" },
  );
  for (const row of weather) {
    const rh = daily(row.time, row.values.relative_humidity_2m ?? [], 18);
    const visibility = daily(
      row.time,
      (row.values.visibility ?? []).map((value) =>
        value == null ? null : value / 1000,
      ),
      18,
    );
    const visibilityByDate = new Map(visibility.map((day) => [day.date, day.value]));
    meteoCities[row.id] = rh.map((day) => ({
      date: day.date,
      rh: day.value == null ? null : Math.round(day.value),
      visibility_km: visibilityByDate.get(day.date) ?? null,
      validHours: day.validHours,
    }));
  }
} catch (error) {
  console.log("weather unavailable", error instanceof Error ? error.message : error);
}
await mkdir(out, { recursive: true });
const fetchedAt = new Date().toISOString();
await writeFile(
  resolve(out, "cams.json"),
  JSON.stringify({
    fetchedAt,
    from: "2026-10-15",
    to: end,
    cams24h,
    cities: camsCities,
  }),
);
await writeFile(
  resolve(out, "meteo.json"),
  JSON.stringify({ fetchedAt, from: "2026-10-15", to: end, cities: meteoCities }),
);
console.log("models", Object.keys(camsCities).length, Object.keys(meteoCities).length);
