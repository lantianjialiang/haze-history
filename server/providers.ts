import { dateRange, FIRST_DAY } from "../shared/dates.ts";
import type {
  CityRef,
  DailyRecord,
  Metric,
  ProviderMeta,
  SeriesResponse,
} from "../shared/types.ts";

export interface DataProvider {
  meta: ProviderMeta;
  getDailySeries(
    city: CityRef,
    from: string,
    to: string,
    metrics: Metric[],
  ): Promise<SeriesResponse>;
}
export class ProviderRegistry {
  private providers = new Map<string, DataProvider>();
  register(provider: DataProvider) {
    if (this.providers.has(provider.meta.id))
      throw new Error("Duplicate provider ID");
    this.providers.set(provider.meta.id, provider);
  }
  get(id: string) {
    return this.providers.get(id);
  }
  list(metric?: Metric) {
    return [...this.providers.values()]
      .map((provider) => provider.meta)
      .filter((meta) => metric == null || meta.metrics.includes(metric));
  }
}
export function missingRate(records: DailyRecord[], requested: Metric[]) {
  const counts = new Map<string, { total: number; missing: number }>();
  for (const record of records) {
    const year = record.date.slice(0, 4);
    const row = counts.get(year) ?? { total: 0, missing: 0 };
    row.total++;
    if (!requested.length || requested.some((metric) => record[metric] == null))
      row.missing++;
    counts.set(year, row);
  }
  return Object.fromEntries(
    [...counts].map(([year, row]) => [year, row.missing / row.total]),
  );
}
export const emptyDay = (date: string): DailyRecord => ({
  date,
  pm25: null,
  pm10: null,
  aqi: null,
  visibility_km: null,
  rh: null,
});

const samples: [string, string, string, Metric[]][] = [
  [
    "mock-pm-grid",
    "空气质量演示 A",
    "Air quality demo A",
    ["pm25", "pm10", "aqi"],
  ],
  [
    "mock-pm-station",
    "空气质量演示 B",
    "Air quality demo B",
    ["pm25", "pm10", "aqi"],
  ],
  ["mock-meteo", "气象演示", "Weather demo", ["visibility_km", "rh"]],
];
function random(key: string) {
  let hash = 2166136261;
  for (const char of key) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  hash = Math.imul(hash ^ (hash >>> 16), 0x45d9f3b);
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
}
export class MockProvider implements DataProvider {
  readonly meta: ProviderMeta;
  constructor([id, zh, en, metrics]: (typeof samples)[number]) {
    this.meta = {
      id,
      name: { zh, en },
      sourceType: "model",
      metrics,
      requiresKey: false,
      coverage: { from: FIRST_DAY, to: "now" },
      license: "Synthetic demonstration data",
      notes: {
        zh: "合成演示数据，不代表城市实际观测。",
        en: "Synthetic data for demonstration only.",
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
    const records = [...dateRange(from, to)].map((date) => {
      const year = +date.slice(0, 4);
      const month = +date.slice(5, 7);
      const seed = city.id + date + this.meta.id;
      const record = emptyDay(date);
      if (
        year < 2015 ||
        random(seed + "quality") < (year === 2015 ? 0.38 : 0.045)
      )
        return record;
      const winter = (1 + Math.cos(((month - 1) * Math.PI) / 6)) / 2;
      const pollution = Math.max(
        4,
        Math.round(
          23 +
            55 * winter +
            58 * random(seed + "weather") ** 3 +
            (random(city.id) - 0.5) * 38 -
            (year - 2015) * 3.4,
        ),
      );
      const values = {
        pm25: pollution,
        pm10: Math.round(pollution * 1.47),
        aqi: Math.round(pollution * 1.32),
        visibility_km:
          Math.round((5 + 16 * random(seed + "vis") - 4 * winter) * 10) / 10,
        rh: Math.round(36 + 61 * random(seed + "rh")),
      };
      for (const metric of metricsReturned) record[metric] = values[metric];
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
}
export function mockRegistry() {
  const registry = new ProviderRegistry();
  samples.forEach((sample) => registry.register(new MockProvider(sample)));
  return registry;
}
