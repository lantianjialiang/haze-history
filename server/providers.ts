import type {
  CityRef,
  DailyRecord,
  HourlyRecord,
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
  getHourly?(city: CityRef, date: string): Promise<HourlyRecord[]>;
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
