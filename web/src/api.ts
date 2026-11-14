import { dateRange, yearsBetween } from "../../shared/dates.ts";
import type {
  ApiError,
  DailyRecord,
  HourlyResponse,
  Metric,
  ProviderMeta,
  RuleConfig,
  SeriesResponse,
  StatsResponse,
} from "../../shared/types.ts";
import { staticCities } from "../../shared/geocode.ts";
import { computeStats } from "./stats.ts";

const staticSite = import.meta.env.VITE_STATIC === "1";
const dataRoot = import.meta.env.BASE_URL + "data/";

function emptyDay(date: string): DailyRecord {
  return {
    date,
    pm25: null,
    pm10: null,
    aqi: null,
    visibility_km: null,
    rh: null,
  };
}

function missingRate(records: DailyRecord[], requested: Metric[]) {
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

async function readJson<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal });
  if (!response.ok) throw { code: "INTERNAL" } satisfies Pick<ApiError, "code">;
  return response.json() as Promise<T>;
}

async function staticSeries(
  params: {
    cityId: string;
    providerId: string;
    from: string;
    to: string;
    metrics: Metric[];
  },
  signal: AbortSignal,
): Promise<SeriesResponse> {
  const years = yearsBetween(params.from, params.to);
  const chunks = await Promise.all(
    years.map((year) =>
      fetch(
        `${dataRoot}series/${params.cityId}/${params.providerId}/${year}.json`,
        { signal },
      ).then(async (response) =>
        response.ok ? ((await response.json()) as SeriesResponse) : null,
      ),
    ),
  );
  const readings = new Map(
    chunks
      .filter((chunk): chunk is SeriesResponse => chunk != null)
      .flatMap((chunk) => chunk.records.map((row) => [row.date, row] as const)),
  );
  const sample = chunks.find((chunk) => chunk != null);
  if (!sample) throw { code: "NO_DATA" } satisfies Pick<ApiError, "code">;
  const metricsReturned = sample.metricsReturned.filter((metric) =>
    params.metrics.includes(metric),
  );
  const records = [...dateRange(params.from, params.to)].map((date) => {
    const row = emptyDay(date);
    const hit = readings.get(date);
    if (!hit) return row;
    for (const metric of metricsReturned) row[metric] = hit[metric] ?? null;
    if (hit.validHours != null) row.validHours = hit.validHours;
    return row;
  });
  return {
    ...sample,
    records,
    metricsReturned,
    meta: {
      ...sample.meta,
      cacheHit: true,
      missingRateByYear: missingRate(records, params.metrics),
    },
  };
}

async function staticHours(
  query: string,
  signal: AbortSignal,
): Promise<HourlyResponse> {
  const params = new URLSearchParams(query);
  const cityId = params.get("cityId");
  const providerId = params.get("providerId");
  const date = params.get("date");
  if (!cityId || !providerId || !date)
    throw { code: "INVALID_PARAMS" } satisfies Pick<ApiError, "code">;
  const year = date.slice(0, 4);
  const shard = await readJson<Record<string, HourlyResponse["hours"]>>(
    `${dataRoot}hours/${cityId}/${providerId}/${year}.json`,
    signal,
  ).catch((): Record<string, HourlyResponse["hours"]> => ({}));
  const city = staticCities.get(cityId);
  if (!city) throw { code: "GEOCODE_NOT_FOUND" } satisfies Pick<ApiError, "code">;
  return {
    city,
    providerId,
    date,
    hours: shard[date] ?? [],
  };
}

export async function api<T>(
  path: string,
  signal: AbortSignal,
  body?: unknown,
): Promise<T> {
  if (staticSite && path === "/sources") {
    return readJson<T>(dataRoot + "sources.json", signal);
  }
  if (staticSite && path === "/recent-comparison") {
    return readJson<T>(dataRoot + "recent-comparison.json", signal);
  }
  if (staticSite && path.startsWith("/series?")) {
    const params = new URLSearchParams(path.slice("/series?".length));
    return staticSeries(
      {
        cityId: params.get("cityId")!,
        providerId: params.get("providerId")!,
        from: params.get("from")!,
        to: params.get("to")!,
        metrics: (params.get("metrics") ?? "").split(",") as Metric[],
      },
      signal,
    ) as Promise<T>;
  }
  if (staticSite && path.startsWith("/hours?")) {
    return staticHours(path.slice("/hours?".length), signal) as Promise<T>;
  }
  if (staticSite && path === "/stats" && body) {
    const payload = body as {
      cityId: string;
      providerId: string;
      from: string;
      to: string;
      rule: RuleConfig;
    };
    const metrics = [
      ...new Set(payload.rule.conditions.map((condition) => condition.metric)),
    ];
    const series = await staticSeries(
      {
        cityId: payload.cityId,
        providerId: payload.providerId,
        from: payload.from,
        to: payload.to,
        metrics,
      },
      signal,
    );
    return computeStats(series, payload.rule) as T;
  }

  const response = await fetch(
    "/api" + path,
    body === undefined
      ? { signal }
      : {
          method: "POST",
          signal,
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  if (response.ok) return response.json() as Promise<T>;
  throw await response
    .json()
    .catch(() => ({ code: "INTERNAL" }) satisfies Pick<ApiError, "code">);
}

export const isStaticSite = staticSite;