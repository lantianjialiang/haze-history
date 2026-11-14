import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { dateRange } from "../shared/dates.ts";
import type {
  CityRef,
  DailyRecord,
  Metric,
  SeriesResponse,
} from "../shared/types.ts";
import {
  emptyDay,
  missingRate,
  type DataProvider,
  type ProviderRegistry,
} from "./providers.ts";

interface MeasuredDay {
  date: string;
  pm25: number | null;
  pm10: number | null;
  aqi: number | null;
  validHours?: number;
}
interface MeteoDay {
  date: string;
  rh: number | null;
  visibility_km: number | null;
  validHours?: number;
}
interface Bundle<T> {
  fetchedAt?: string;
  cities?: Record<string, T[]>;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

class SnapshotProvider implements DataProvider {
  constructor(
    readonly meta: DataProvider["meta"],
    private values: Map<string, Map<string, Partial<DailyRecord>>>,
    private fetchedAt: string,
  ) {}
  async getDailySeries(
    city: CityRef,
    from: string,
    to: string,
    requested: Metric[],
  ): Promise<SeriesResponse> {
    const metricsReturned = this.meta.metrics.filter((metric) =>
      requested.includes(metric),
    );
    const days = this.values.get(city.id);
    const records = [...dateRange(from, to)].map((date) => {
      const record = emptyDay(date);
      const hit = days?.get(date);
      if (!hit) return record;
      for (const metric of metricsReturned) {
        const value = hit[metric];
        if (typeof value === "number") record[metric] = value;
      }
      record.validHours = hit.validHours;
      return record;
    });
    return {
      city,
      providerId: this.meta.id,
      sourceType: this.meta.sourceType,
      metricsReturned,
      records,
      meta: {
        fetchedAt: this.fetchedAt,
        cacheHit: false,
        missingRateByYear: missingRate(records, metricsReturned),
      },
    };
  }
}

function indexMeasured(days: MeasuredDay[] | undefined) {
  const map = new Map<string, Partial<DailyRecord>>();
  for (const day of days ?? []) {
    map.set(day.date, {
      pm25: day.pm25,
      pm10: day.pm10,
      aqi: day.aqi,
      validHours: day.validHours,
    });
  }
  return map;
}

export function registerRecent(registry: ProviderRegistry, root: string) {
  const dir = resolve(root, "data/recent");
  const measured = readJson<Bundle<MeasuredDay>>(resolve(dir, "measured.json"));
  const cams = readJson<Bundle<MeasuredDay>>(resolve(dir, "cams.json"));
  const meteo = readJson<Bundle<MeteoDay>>(resolve(dir, "meteo.json"));
  const measuredAt = measured?.fetchedAt ?? new Date(0).toISOString();
  const modelAt = cams?.fetchedAt ?? measuredAt;
  registry.register(
    new SnapshotProvider(
      {
        id: "cnemc-recent",
        name: { zh: "监测总站近期实测", en: "CNEMC recent measurements" },
        sourceType: "measured",
        metrics: ["pm25", "pm10", "aqi"],
        coverage: { from: "2026-10-15", to: "now" },
        requiresKey: false,
        license: "中国环境监测总站公开发布；本站仅缓存近期快照",
        notes: {
          zh: "城市值为国控站算术平均。日值至少需要 12 个有效小时。AQI 只由 PM2.5 日均按 HJ 633 折算。",
          en: "City values average national stations. A day needs at least 12 valid hours. AQI is the HJ 633 index of daily PM2.5 only.",
        },
      },
      new Map(
        Object.entries(measured?.cities ?? {}).map(([id, days]) => [
          id,
          indexMeasured(days),
        ]),
      ),
      measuredAt,
    ),
  );
  registry.register(
    new SnapshotProvider(
      {
        id: "cams-recent",
        name: { zh: "CAMS 近期模型", en: "CAMS recent model" },
        sourceType: "model",
        metrics: ["pm25", "pm10", "aqi"],
        coverage: { from: "2026-10-15", to: "now" },
        requiresKey: false,
        license: "Open-Meteo / Copernicus CAMS, CC BY 4.0",
        notes: {
          zh: "CAMS 全球格点。日均至少 18 个小时。AQI 只由 PM2.5 折算。",
          en: "CAMS global grid. Daily means need 18 hours. AQI is derived from PM2.5 only.",
        },
      },
      new Map(
        Object.entries(cams?.cities ?? {}).map(([id, days]) => [
          id,
          indexMeasured(days),
        ]),
      ),
      modelAt,
    ),
  );
  registry.register(
    new SnapshotProvider(
      {
        id: "open-meteo-recent",
        name: { zh: "Open-Meteo 近期气象", en: "Open-Meteo recent weather" },
        sourceType: "model",
        metrics: ["visibility_km", "rh"],
        coverage: { from: "2026-10-15", to: "now" },
        requiresKey: false,
        license: "Open-Meteo, CC BY 4.0",
        notes: {
          zh: "模式分析的能见度和相对湿度，不是气象站实测。日均至少 18 个小时。",
          en: "Model visibility and humidity, not a weather-station observation. Daily means need 18 hours.",
        },
      },
      new Map(
        Object.entries(meteo?.cities ?? {}).map(([id, days]) => [
          id,
          new Map(
            (days ?? []).map((day) => [
              day.date,
              {
                visibility_km: day.visibility_km,
                rh: day.rh,
                validHours: day.validHours,
              },
            ]),
          ),
        ]),
      ),
      meteo?.fetchedAt ?? modelAt,
    ),
  );
}

export function readComparison(root: string) {
  return (
    readJson<unknown>(resolve(root, "data/recent/comparison.json")) ?? {
      fetchedAt: null,
      cities: [],
    }
  );
}
