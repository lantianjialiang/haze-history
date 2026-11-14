import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pm25ToAqi } from "../shared/aqi.ts";
import { dateRange } from "../shared/dates.ts";
import type {
  CityRef,
  HourlyRecord,
  Metric,
  ProviderMeta,
  SeriesResponse,
} from "../shared/types.ts";
import {
  emptyDay,
  missingRate,
  type DataProvider,
  type ProviderRegistry,
} from "./providers.ts";
import type { HourSlot } from "./quotsoft.ts";

export const EMBASSY_START = "2010-01-01";
export const EMBASSY_END = "2015-12-31";
const MIN_HOURS = 12;
export const embassyCities: Record<string, string> = {
  beijing: "CN-110100",
  shanghai: "CN-310100",
  guangzhou: "CN-440100",
  chengdu: "CN-510100",
  shenyang: "CN-210100",
};

function numeric(value: string | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "NA" || trimmed === "—" || trimmed === "-")
    return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function pad(value: number) {
  return String(value).padStart(2, "0");
}

function headerIndex(header: string[], pattern: RegExp) {
  return header.findIndex((name) => pattern.test(name.replaceAll('"', "").trim()));
}

export function parseEmbassyCsv(text: string, cityId: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map((name) => name.replaceAll('"', "").trim());
  const year = headerIndex(header, /^year$/i);
  const month = headerIndex(header, /^month$/i);
  const day = headerIndex(header, /^day$/i);
  const hour = headerIndex(header, /^hour$/i);
  const pm =
    headerIndex(header, /US.?Post/i) >= 0
      ? headerIndex(header, /US.?Post/i)
      : headerIndex(header, /^pm2\.?5$/i);
  if (Math.min(year, month, day, hour, pm) < 0) return [];
  const hours: { cityId: string; date: string; hour: number; pm25: number | null }[] =
    [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const y = Number(cells[year]);
    const m = Number(cells[month]);
    const d = Number(cells[day]);
    const h = Number(cells[hour]);
    if (
      !Number.isInteger(y) ||
      !Number.isInteger(m) ||
      !Number.isInteger(d) ||
      !Number.isInteger(h) ||
      h < 0 ||
      h > 23
    )
      continue;
    hours.push({
      cityId,
      date: `${y}-${pad(m)}-${pad(d)}`,
      hour: h,
      pm25: numeric(cells[pm]),
    });
  }
  return hours;
}

export function parseStateAirCsv(text: string, cityId: string) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0]
    .replace(/^\uFEFF/, "")
    .split(",")
    .map((name) => name.replaceAll('"', "").trim());
  const year = headerIndex(header, /^year$/i);
  const month = headerIndex(header, /^month$/i);
  const day = headerIndex(header, /^day$/i);
  const hour = headerIndex(header, /^hour$/i);
  const parameter = headerIndex(header, /^parameter$/i);
  const qc = headerIndex(header, /qc/i);
  const raw = headerIndex(header, /raw\s*conc/i);
  const pm = raw >= 0 ? raw : headerIndex(header, /^value$/i);
  if (Math.min(year, month, day, hour, pm) < 0) return [];
  const hours: { cityId: string; date: string; hour: number; pm25: number | null }[] =
    [];
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    if (parameter >= 0 && !/pm\s*2\.?5/i.test(cells[parameter] ?? "")) continue;
    const y = Number(cells[year]);
    const m = Number(cells[month]);
    const d = Number(cells[day]);
    const h = Number(cells[hour]);
    if (
      !Number.isInteger(y) ||
      !Number.isInteger(m) ||
      !Number.isInteger(d) ||
      !Number.isInteger(h) ||
      h < 0 ||
      h > 23
    )
      continue;
    const invalid = /missing|invalid/i.test((cells[qc] ?? "").trim());
    hours.push({
      cityId,
      date: `${y}-${pad(m)}-${pad(d)}`,
      hour: h,
      pm25: invalid ? null : numeric(cells[pm]),
    });
  }
  return hours;
}

function dailyFromHours(
  cityId: string,
  date: string,
  values: (number | null)[],
) {
  const pm25Hours = values.filter((value): value is number => value != null);
  const pm25 =
    pm25Hours.length >= MIN_HOURS
      ? round(mean(pm25Hours))
      : pm25Hours.length
        ? round(mean(pm25Hours))
        : null;
  return {
    cityId,
    date,
    pm25,
    aqi: pm25 == null ? null : pm25ToAqi(pm25),
    validHours: pm25Hours.length,
  };
}

export class EmbassyStore {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS hourly (
        city_id TEXT NOT NULL,
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        pm25 REAL,
        PRIMARY KEY (city_id, date, hour)
      );
      CREATE TABLE IF NOT EXISTS daily (
        city_id TEXT NOT NULL,
        date TEXT NOT NULL,
        pm25 REAL,
        aqi REAL,
        valid_hours INTEGER,
        PRIMARY KEY (city_id, date)
      );
    `);
  }
  close() {
    this.db.close();
  }
  ingest(rows: { cityId: string; date: string; hour: number; pm25: number | null }[]) {
    const hourWrite = this.db.prepare(
      `INSERT INTO hourly VALUES (?, ?, ?, ?)
       ON CONFLICT(city_id, date, hour) DO UPDATE SET pm25=excluded.pm25`,
    );
    const dayWrite = this.db.prepare(
      `INSERT INTO daily VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(city_id, date) DO UPDATE SET
         pm25=excluded.pm25, aqi=excluded.aqi, valid_hours=excluded.valid_hours`,
    );
    const dayDelete = this.db.prepare(
      "DELETE FROM daily WHERE city_id=? AND date=?",
    );
    const grouped = new Map<string, (number | null)[]>();
    for (const row of rows) {
      if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
      const key = row.cityId + "|" + row.date;
      if (!grouped.has(key)) {
        const hours = Array.from({ length: 24 }, () => null as number | null);
        for (const slot of this.cityHours(row.cityId, row.date))
          hours[slot.hour] = slot.pm25;
        grouped.set(key, hours);
      }
    }
    this.db.exec("BEGIN");
    try {
      for (const row of rows) {
        if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour > 23) continue;
        hourWrite.run(row.cityId, row.date, row.hour, row.pm25);
        grouped.get(row.cityId + "|" + row.date)![row.hour] = row.pm25;
      }
      for (const [key, hours] of grouped) {
        const [cityId, date] = key.split("|");
        const day = dailyFromHours(cityId, date, hours);
        if (day.validHours === 0) {
          dayDelete.run(cityId, date);
          continue;
        }
        dayWrite.run(cityId, date, day.pm25, day.aqi, day.validHours);
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  cityDays(cityId: string, from: string, to: string) {
    return this.db
      .prepare(
        "SELECT date, pm25, aqi, valid_hours FROM daily WHERE city_id=? AND date>=? AND date<=? ORDER BY date",
      )
      .all(cityId, from, to) as {
      date: string;
      pm25: number | null;
      aqi: number | null;
      valid_hours: number | null;
    }[];
  }
  cityHours(cityId: string, date: string): HourSlot[] {
    const rows = this.db
      .prepare(
        "SELECT hour, pm25 FROM hourly WHERE city_id=? AND date=? ORDER BY hour",
      )
      .all(cityId, date) as { hour: number; pm25: number | null }[];
    const byHour = new Map(rows.map((row) => [row.hour, row.pm25]));
    return Array.from({ length: 24 }, (_, hour) => ({
      hour,
      pm25: byHour.get(hour) ?? null,
      pm10: null,
      aqi: byHour.has(hour) && byHour.get(hour) != null
        ? pm25ToAqi(byHour.get(hour)!)
        : null,
    }));
  }
  status() {
    const range = this.db
      .prepare(
        "SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS n FROM daily",
      )
      .get() as { first: string | null; last: string | null; n: number };
    return {
      records: range.n,
      cities: (
        this.db
          .prepare("SELECT COUNT(DISTINCT city_id) AS n FROM daily")
          .get() as { n: number }
      ).n,
      first: range.first,
      last: range.last,
    };
  }
}

export class EmbassyProvider implements DataProvider {
  readonly meta: ProviderMeta;
  constructor(private store: EmbassyStore) {
    const last = store.status().last;
    this.meta = {
      id: "stateair-embassy",
      name: { zh: "美国大使馆监测", en: "US Embassy measurements" },
      sourceType: "measured" as const,
      metrics: ["pm25", "aqi"] as Metric[],
      coverage: {
        from: "2013-01-01",
        to: last && last > EMBASSY_END ? last : EMBASSY_END,
      },
      requiresKey: false,
      license:
        "U.S. Department of State AirNow / UCI Five Chinese Cities / EPA historical snapshot",
      notes: {
        zh: "北京、上海、广州、成都、沈阳使馆馆区 PM2.5。2010–2015 来自 UCI 五城数据集；2016 年起为美国国务院 AirNow 使馆小时值（EPA 历史快照：北京/上海/广州/沈阳至 2025 年 3 月，成都至 2020）。本站从 2013 年起展示。AQI 由 PM2.5 按 HJ 633—2012 单指标折算，不是 AirNow 美标 AQI。",
        en: "PM2.5 at US Embassy compounds in Beijing, Shanghai, Guangzhou, Chengdu and Shenyang. 2010–2015 is the UCI five-city set; 2016 onward is Department of State AirNow hourly data from an EPA historical snapshot (Beijing/Shanghai/Guangzhou/Shenyang through March 2025, Chengdu through 2020). This site shows 2013 onward. AQI is a single-pollutant HJ 633—2012 estimate from PM2.5, not AirNow US AQI.",
      },
    };
  }
  async getDailySeries(
    city: CityRef,
    from: string,
    to: string,
    requested: Metric[],
  ): Promise<SeriesResponse> {
    const metricsReturned = this.meta.metrics.filter((metric) =>
      requested.includes(metric),
    );
    const rows = new Map(
      this.store.cityDays(city.id, from, to).map((row) => [row.date, row]),
    );
    const records = [...dateRange(from, to)].map((date) => {
      const record = emptyDay(date);
      const hit = rows.get(date);
      if (!hit) return record;
      if (metricsReturned.includes("pm25")) record.pm25 = hit.pm25;
      if (metricsReturned.includes("aqi")) record.aqi = hit.aqi;
      record.validHours = hit.valid_hours ?? undefined;
      return record;
    });
    return {
      city,
      providerId: this.meta.id,
      sourceType: this.meta.sourceType,
      metricsReturned,
      records,
      meta: {
        fetchedAt: new Date().toISOString(),
        cacheHit: false,
        missingRateByYear: missingRate(records, metricsReturned),
      },
    };
  }
  async getHourly(city: CityRef, date: string): Promise<HourlyRecord[]> {
    return this.store.cityHours(city.id, date).map((slot) => ({
      ...slot,
      visibility_km: null,
      rh: null,
    }));
  }
}

export function embassyPath(root: string) {
  return resolve(root, "data/embassy-history.sqlite");
}

export function registerEmbassy(registry: ProviderRegistry, root: string) {
  registry.register(new EmbassyProvider(new EmbassyStore(embassyPath(root))));
}
