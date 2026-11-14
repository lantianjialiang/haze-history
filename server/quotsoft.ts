import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import overview from "../data/cities-overview.json" with { type: "json" };
import { dateRange } from "../shared/dates.ts";
import type {
  CityRef,
  HourlyRecord,
  Metric,
  SeriesResponse,
} from "../shared/types.ts";
import {
  emptyDay,
  missingRate,
  type DataProvider,
  type ProviderRegistry,
} from "./providers.ts";

export const CITIES_START = "2014-05-13";
export const BEIJING_START = "2013-12-06";
const MIN_HOURS = 12;

export interface CityColumn {
  id: string;
  name: string;
}

export interface DailyValue {
  cityId: string;
  date: string;
  pm25: number | null;
  pm10: number | null;
  aqi: number | null;
  validHours: number;
  method: "hourly-mean" | "published-24h" | "nodata";
}
export interface HourSlot {
  hour: number;
  pm25: number | null;
  pm10: number | null;
  aqi: number | null;
}

function numeric(value: string | undefined) {
  if (value == null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === "—" || trimmed === "-" || trimmed === "NA")
    return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function round(value: number, digits = 1) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function lastDefined(values: (number | null)[]) {
  for (let index = values.length - 1; index >= 0; index--) {
    const value = values[index];
    if (value != null) return value;
  }
  return null;
}

function summarize(
  date: string,
  cityId: string,
  hours: HourBucket,
): DailyValue {
  const pm25Hours = hours.pm25.filter((value) => value != null) as number[];
  const pm10Hours = hours.pm10.filter((value) => value != null) as number[];
  const aqiHours = hours.aqi.filter((value) => value != null) as number[];
  const enough = pm25Hours.length >= MIN_HOURS;
  const fallback = lastDefined(hours.pm25_24h);
  const pm25 = enough
    ? round(mean(pm25Hours))
    : (fallback ?? (pm25Hours.length ? round(mean(pm25Hours)) : null));
  const pm10 =
    pm10Hours.length >= MIN_HOURS
      ? round(mean(pm10Hours))
      : pm10Hours.length
        ? round(mean(pm10Hours))
        : null;
  const aqi =
    aqiHours.length >= MIN_HOURS
      ? Math.round(mean(aqiHours))
      : lastDefined(hours.aqi);
  return {
    cityId,
    date,
    pm25,
    pm10,
    aqi,
    validHours: pm25Hours.length,
    method: enough
      ? "hourly-mean"
      : fallback != null
        ? "published-24h"
        : pm25 == null
          ? "nodata"
          : "hourly-mean",
  };
}

interface HourBucket {
  pm25: (number | null)[];
  pm10: (number | null)[];
  aqi: (number | null)[];
  pm25_24h: (number | null)[];
}

function emptyBucket(): HourBucket {
  return { pm25: [], pm10: [], aqi: [], pm25_24h: [] };
}

export function cityIndex(header: string[], cities: CityColumn[]) {
  const byName = new Map(cities.map((city) => [city.name, city.id]));
  for (const city of cities) byName.set(city.name + "市", city.id);
  const indexes = new Map<string, number>();
  header.forEach((name, index) => {
    const id = byName.get(name);
    if (id) indexes.set(id, index);
  });
  return indexes;
}

export function parseCityCsv(
  text: string,
  cities: CityColumn[],
  includeUnmapped = false,
): DailyValue[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const indexes = cityIndex(header, cities);
  if (includeUnmapped) {
    const matched = new Set(indexes.values());
    header.slice(3).forEach((name, offset) => {
      const label = name.trim();
      if (label && !matched.has(offset + 3))
        indexes.set("CNEMC:" + label, offset + 3);
    });
  }
  const hours = new Map<string, HourBucket>();
  for (const [id] of indexes) hours.set(id, emptyBucket());
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const type = cells[2];
    if (
      type !== "PM2.5" &&
      type !== "PM2.5_24h" &&
      type !== "PM10" &&
      type !== "AQI"
    )
      continue;
    for (const [id, index] of indexes) {
      const bucket = hours.get(id)!;
      const value = numeric(cells[index]);
      if (type === "PM2.5") bucket.pm25.push(value);
      else if (type === "PM2.5_24h") bucket.pm25_24h.push(value);
      else if (type === "PM10") bucket.pm10.push(value);
      else bucket.aqi.push(value);
    }
  }
  const dateCell = lines[1]?.split(",")[0] ?? "";
  const date = /^\d{8}$/.test(dateCell)
    ? `${dateCell.slice(0, 4)}-${dateCell.slice(4, 6)}-${dateCell.slice(6, 8)}`
    : dateCell.replaceAll("/", "-");
  return [...hours].map(([id, bucket]) => summarize(date, id, bucket));
}

export function parseBeijingCsv(
  text: string,
  cityId = "CN-110100",
): DailyValue[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const header = lines[0].split(",");
  const stations = header
    .map((name, index) => ({ name, index }))
    .filter(
      (column) =>
        column.index >= 3 &&
        !column.name.includes("对照") &&
        column.name.trim(),
    );
  const bucket = emptyBucket();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const type = cells[2];
    if (
      type !== "PM2.5" &&
      type !== "PM2.5_24h" &&
      type !== "PM10" &&
      type !== "AQI"
    )
      continue;
    const values = stations
      .map((station) => numeric(cells[station.index]))
      .filter((value): value is number => value != null);
    const value = values.length ? round(mean(values)) : null;
    if (type === "PM2.5") bucket.pm25.push(value);
    else if (type === "PM2.5_24h") bucket.pm25_24h.push(value);
    else if (type === "PM10") bucket.pm10.push(value);
    else bucket.aqi.push(value);
  }
  const dateCell = lines[1]?.split(",")[0] ?? "";
  const date = /^\d{8}$/.test(dateCell)
    ? `${dateCell.slice(0, 4)}-${dateCell.slice(4, 6)}-${dateCell.slice(6, 8)}`
    : dateCell.replaceAll("/", "-");
  return [summarize(date, cityId, bucket)];
}

function hourSlots(byHour: Map<number, HourSlot>) {
  return Array.from({ length: 24 }, (_, hour) => {
    const hit = byHour.get(hour);
    return {
      hour,
      pm25: hit?.pm25 ?? null,
      pm10: hit?.pm10 ?? null,
      aqi: hit?.aqi ?? null,
    };
  });
}

function applyHourType(
  slot: HourSlot,
  type: string,
  value: number | null,
) {
  if (type === "PM2.5") slot.pm25 = value;
  else if (type === "PM10") slot.pm10 = value;
  else if (type === "AQI") slot.aqi = value;
}

export function parseCityHourlyCsv(text: string, cities: CityColumn[]) {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return new Map<string, HourSlot[]>();
  const header = lines[0].split(",");
  const indexes = cityIndex(header, cities);
  const byCity = new Map<string, Map<number, HourSlot>>();
  for (const [id] of indexes) byCity.set(id, new Map());
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const type = cells[2];
    if (type !== "PM2.5" && type !== "PM10" && type !== "AQI") continue;
    const hour = Number(cells[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    for (const [id, index] of indexes) {
      const hours = byCity.get(id)!;
      const slot = hours.get(hour) ?? {
        hour,
        pm25: null,
        pm10: null,
        aqi: null,
      };
      applyHourType(slot, type, numeric(cells[index]));
      hours.set(hour, slot);
    }
  }
  return new Map(
    [...byCity].map(([id, hours]) => [id, hourSlots(hours)] as const),
  );
}

export function parseBeijingHourlyCsv(
  text: string,
  cityId = "CN-110100",
): HourSlot[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return hourSlots(new Map());
  const header = lines[0].split(",");
  const stations = header
    .map((name, index) => ({ name, index }))
    .filter(
      (column) =>
        column.index >= 3 &&
        !column.name.includes("对照") &&
        column.name.trim(),
    );
  const byHour = new Map<number, HourSlot>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const type = cells[2];
    if (type !== "PM2.5" && type !== "PM10" && type !== "AQI") continue;
    const hour = Number(cells[1]);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) continue;
    const values = stations
      .map((station) => numeric(cells[station.index]))
      .filter((value): value is number => value != null);
    const value = values.length ? round(mean(values)) : null;
    const slot = byHour.get(hour) ?? {
      hour,
      pm25: null,
      pm10: null,
      aqi: null,
    };
    applyHourType(slot, type, value);
    byHour.set(hour, slot);
  }
  return hourSlots(byHour);
}

function toHourlyRecords(hours: HourSlot[]): HourlyRecord[] {
  return hours.map((slot) => ({
    ...slot,
    visibility_km: null,
    rh: null,
  }));
}

const cityColumns = (overview as { id: string; name: { zh: string } }[]).map(
  (city) => ({ id: city.id, name: city.name.zh }),
) satisfies CityColumn[];

async function fetchQuotsoftCsv(file: string) {
  const response = await fetch("https://quotsoft.net/air/data/" + file, {
    headers: { "User-Agent": "haze-history-local/0.2" },
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error("HTTP " + response.status);
  return await response.text();
}

export class HistoryStore {
  db: DatabaseSync;
  private chain = Promise.resolve();
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=8000;
      CREATE TABLE IF NOT EXISTS days (
        date TEXT NOT NULL,
        kind TEXT NOT NULL,
        status TEXT NOT NULL,
        bytes INTEGER,
        fetched_ms INTEGER NOT NULL,
        PRIMARY KEY (date, kind)
      );
      CREATE TABLE IF NOT EXISTS daily (
        city_id TEXT NOT NULL,
        date TEXT NOT NULL,
        pm25 REAL,
        pm10 REAL,
        aqi REAL,
        valid_hours INTEGER,
        method TEXT,
        PRIMARY KEY (city_id, date)
      );
      CREATE TABLE IF NOT EXISTS hourly (
        city_id TEXT NOT NULL,
        date TEXT NOT NULL,
        hour INTEGER NOT NULL,
        pm25 REAL,
        pm10 REAL,
        aqi REAL,
        PRIMARY KEY (city_id, date, hour)
      );
    `);
  }
  close() {
    this.db.close();
  }
  private exclusive<T>(work: () => T) {
    const result = this.chain.then(work);
    this.chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
  done(date: string, kind: string) {
    const row = this.db
      .prepare("SELECT status FROM days WHERE date=? AND kind=?")
      .get(date, kind) as { status: string } | undefined;
    return row?.status === "ok" || row?.status === "missing";
  }
  saveDay(
    date: string,
    kind: string,
    status: "ok" | "missing" | "error",
    rows: DailyValue[],
    bytes = 0,
  ) {
    return this.exclusive(() => this.writeDay(date, kind, status, rows, bytes));
  }
  private writeDay(
    date: string,
    kind: string,
    status: "ok" | "missing" | "error",
    rows: DailyValue[],
    bytes = 0,
  ) {
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `INSERT INTO days VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(date, kind) DO UPDATE SET status=excluded.status, bytes=excluded.bytes, fetched_ms=excluded.fetched_ms`,
        )
        .run(date, kind, status, bytes, Date.now());
      if (status === "ok") {
        const write = this.db.prepare(
          `INSERT INTO daily VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(city_id, date) DO UPDATE SET
             pm25=excluded.pm25, pm10=excluded.pm10, aqi=excluded.aqi,
             valid_hours=excluded.valid_hours, method=excluded.method`,
        );
        for (const row of rows) {
          if (row.method === "nodata" && row.pm25 == null && row.aqi == null)
            continue;
          write.run(
            row.cityId,
            row.date,
            row.pm25,
            row.pm10,
            row.aqi,
            row.validHours,
            row.method,
          );
        }
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  status() {
    const days = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM days GROUP BY status")
      .all() as { status: string; n: number }[];
    const range = this.db
      .prepare(
        "SELECT MIN(date) AS first, MAX(date) AS last, COUNT(*) AS n FROM daily",
      )
      .get() as { first: string | null; last: string | null; n: number };
    return {
      days: Object.fromEntries(days.map((row) => [row.status, row.n])),
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
  cityHours(cityId: string, date: string) {
    return this.db
      .prepare(
        "SELECT hour, pm25, pm10, aqi FROM hourly WHERE city_id=? AND date=? ORDER BY hour",
      )
      .all(cityId, date) as unknown as HourSlot[];
  }
  saveHours(cityId: string, date: string, hours: HourSlot[]) {
    return this.exclusive(() => {
      const write = this.db.prepare(
        `INSERT INTO hourly VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(city_id, date, hour) DO UPDATE SET
           pm25=excluded.pm25, pm10=excluded.pm10, aqi=excluded.aqi`,
      );
      this.db.exec("BEGIN");
      try {
        for (const slot of hours) {
          write.run(
            cityId,
            date,
            slot.hour,
            slot.pm25,
            slot.pm10,
            slot.aqi,
          );
        }
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    });
  }
  cityDays(cityId: string, from: string, to: string) {
    return this.db
      .prepare(
        "SELECT date, pm25, pm10, aqi, valid_hours FROM daily WHERE city_id=? AND date>=? AND date<=? ORDER BY date",
      )
      .all(cityId, from, to) as {
      date: string;
      pm25: number | null;
      pm10: number | null;
      aqi: number | null;
      valid_hours: number | null;
    }[];
  }
  cityCoverage() {
    return this.db
      .prepare(
        "SELECT city_id AS cityId, MIN(date) AS first, MAX(date) AS last, COUNT(pm25) AS pm25Days, COUNT(aqi) AS aqiDays FROM daily GROUP BY city_id ORDER BY city_id",
      )
      .all();
  }
}

export class QuotsoftProvider implements DataProvider {
  readonly meta = {
    id: "quotsoft-cnemc",
    name: { zh: "监测总站历史归档", en: "CNEMC historical archive" },
    sourceType: "measured" as const,
    metrics: ["pm25", "pm10", "aqi"] as Metric[],
    coverage: { from: BEIJING_START, to: "now" as const },
    requiresKey: false,
    license: "中国环境监测总站公开发布；归档来自 quotsoft.net",
    notes: {
      zh: "全国城市自 2014-05-13；北京自 2013-12-06。小时值按城市归档列读取。满 12 小时用算术日均，否则用当日最后一次 24 小时均值。AQI 为归档中的小时 AQI 平均。",
      en: "National cities from 2014-05-13; Beijing from 2013-12-06. A day uses the hourly mean when 12 hours exist, otherwise the last 24-hour average. AQI is the mean of published hourly AQI.",
    },
  };
  constructor(private store: HistoryStore) {}
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
      if (metricsReturned.includes("pm10")) record.pm10 = hit.pm10;
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
    const cached = this.store.cityHours(city.id, date);
    if (
      cached.length === 24 &&
      cached.some(
        (slot) => slot.pm25 != null || slot.pm10 != null || slot.aqi != null,
      )
    )
      return toHourlyRecords(cached);
    const stamp = date.replaceAll("-", "");
    const beijingOnly = city.id === "CN-110100" && date < CITIES_START;
    const file = beijingOnly
      ? `beijing_all_${stamp}.csv`
      : `china_cities_${stamp}.csv`;
    const text = await fetchQuotsoftCsv(file);
    if (!text) return toHourlyRecords(hourSlots(new Map()));
    if (beijingOnly) {
      const hours = parseBeijingHourlyCsv(text, city.id);
      await this.store.saveHours(city.id, date, hours);
      return toHourlyRecords(hours);
    }
    const parsed = parseCityHourlyCsv(text, cityColumns);
    for (const [id, hours] of parsed) await this.store.saveHours(id, date, hours);
    return toHourlyRecords(parsed.get(city.id) ?? hourSlots(new Map()));
  }
}

export function historyPath(root: string) {
  return resolve(root, "data/quotsoft-history.sqlite");
}

export function registerHistory(registry: ProviderRegistry, root: string) {
  registry.register(new QuotsoftProvider(new HistoryStore(historyPath(root))));
}
