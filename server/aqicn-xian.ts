import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pm25ToAqi } from "../shared/aqi.ts";
import type { CityRef, DailyRecord, Metric, SeriesResponse } from "../shared/types.ts";
import {
  emptyDay,
  missingRate,
  type DataProvider,
  type ProviderRegistry,
} from "./providers.ts";
import { dateRange } from "../shared/dates.ts";

export const XIAN_ID = "CN-610100";

export interface AqicnDay {
  date: string;
  pm25: number | null;
  pm10: number | null;
  aqi: number | null;
}

export interface AqicnBundle {
  source: string;
  sourceUrl: string;
  fetchedAt: string;
  cities: Record<string, AqicnDay[]>;
}

function numeric(cell: string | undefined) {
  if (cell == null) return null;
  const trimmed = cell.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function parseSlashDate(raw: string): string | null {
  const trimmed = raw.trim();
  const parts = trimmed.split("/");
  if (parts.length !== 3) return null;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (
    !Number.isInteger(y) ||
    !Number.isInteger(m) ||
    !Number.isInteger(d) ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  )
    return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function dayFromParts(pm25: number | null, pm10: number | null): AqicnDay | null {
  if (pm25 == null && pm10 == null) return null;
  return {
    date: "",
    pm25,
    pm10,
    aqi: pm25 == null ? null : pm25ToAqi(pm25),
  };
}

function mergeDay(existing: AqicnDay | undefined, incoming: AqicnDay, date: string): AqicnDay {
  const pm25 = incoming.pm25 ?? existing?.pm25 ?? null;
  const pm10 = incoming.pm10 ?? existing?.pm10 ?? null;
  return {
    date,
    pm25,
    pm10,
    aqi: pm25 == null ? null : pm25ToAqi(pm25),
  };
}

/** AQICN historical CSV: `date, pm25, pm10, o3, ...` with `YYYY/M/D` dates. */
export function parseAqicnCsv(text: string, cityId = XIAN_ID): AqicnDay[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  if (lines.length < 2) return [];
  const byDate = new Map<string, AqicnDay>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",").map((cell) => cell.trim());
    if (cells.length < 3) continue;
    const date = parseSlashDate(cells[0]);
    if (!date) continue;
    const pm25 = numeric(cells[1]);
    const pm10 = numeric(cells[2]);
    const partial = dayFromParts(pm25, pm10);
    if (!partial) continue;
    partial.date = date;
    byDate.set(date, mergeDay(byDate.get(date), partial, date));
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function readBundle(root: string): AqicnBundle | null {
  const path = resolve(root, "data/reference/xian-aqicn-daily.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as AqicnBundle;
}

class AqicnXianProvider implements DataProvider {
  readonly meta: DataProvider["meta"];
  private values: Map<string, Map<string, Partial<DailyRecord>>>;

  constructor(
    private fetchedAt: string,
    bundle: AqicnBundle,
  ) {
    const days = bundle.cities[XIAN_ID] ?? [];
    const map = new Map<string, Partial<DailyRecord>>();
    for (const day of days) {
      map.set(day.date, {
        pm25: day.pm25,
        pm10: day.pm10,
        aqi: day.aqi,
      });
    }
    this.values = new Map([[XIAN_ID, map]]);
    const first = days[0]?.date ?? "2014-01-01";
    const last = days[days.length - 1]?.date ?? first;
    this.meta = {
      id: "aqicn-xian",
      name: {
        zh: "AQICN 西安历史日值",
        en: "AQICN Xi’an historical daily",
      },
      sourceType: "measured",
      metrics: ["pm25", "pm10", "aqi"],
      coverage: { from: first, to: last },
      requiresKey: false,
      license: "World Air Quality Index / aqicn.org historical export",
      notes: {
        zh: "来自 aqicn.org 历史页导出的西安日值（用户本地下载）。非监测总站官方序列；AQI 由 PM2.5 按 HJ 633 单指标折算，与 AQICN 页面显示的指数可能不一致。仅西安可用。",
        en: "Daily values for Xi’an from an aqicn.org historical CSV export (local download). Not an official CNEMC series; AQI here is HJ 633 from PM2.5 only and may differ from AQICN’s on-site index. Xi’an only.",
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
    const days = this.values.get(city.id);
    const records = [...dateRange(from, to)].map((date) => {
      const record = emptyDay(date);
      const hit = days?.get(date);
      if (!hit) return record;
      for (const metric of metricsReturned) {
        const value = hit[metric];
        if (typeof value === "number") record[metric] = value;
      }
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

export function registerAqicnXian(registry: ProviderRegistry, root: string) {
  const bundle = readBundle(root);
  const days = bundle?.cities?.[XIAN_ID];
  if (!days?.length) return;
  registry.register(
    new AqicnXianProvider(bundle!.fetchedAt, bundle!),
  );
}

export function bundleFromCsv(
  text: string,
  fetchedAt = new Date().toISOString(),
): AqicnBundle {
  const days = parseAqicnCsv(text);
  return {
    source: "aqicn.org historical CSV",
    sourceUrl: "https://aqicn.org/historical/#!city:xian",
    fetchedAt,
    cities: { [XIAN_ID]: days },
  };
}