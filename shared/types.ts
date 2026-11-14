export const metrics = ["pm25", "pm10", "aqi", "visibility_km", "rh"] as const;
export type Metric = (typeof metrics)[number];
export type SourceType = "measured" | "model";
export type Localized = { zh: string; en: string };
export interface ProviderMeta {
  id: string;
  name: Localized;
  sourceType: SourceType;
  metrics: Metric[];
  coverage: { from: string; to: string | "now" };
  requiresKey: boolean;
  license: string;
  notes?: Localized;
}
export interface DailyRecord {
  date: string;
  pm25: number | null;
  pm10?: number | null;
  aqi: number | null;
  visibility_km: number | null;
  rh: number | null;
  validHours?: number;
}
export interface CityRef {
  id: string;
  name: Localized;
  province: Localized;
  lat: number;
  lon: number;
  adcode?: string;
}
export interface SeriesResponse {
  city: CityRef;
  providerId: string;
  sourceType: SourceType;
  metricsReturned: Metric[];
  records: DailyRecord[];
  meta: {
    fetchedAt: string;
    cacheHit: boolean;
    stationInfo?: { id: string; name: string; distanceKm: number };
    missingRateByYear: Record<string, number>;
  };
}
export const operators = [">", ">=", "<", "<="] as const;
export type Op = (typeof operators)[number];
export interface Condition {
  metric: Metric;
  op: Op;
  value: number;
}
export interface RuleConfig {
  id: string;
  name: Localized;
  combine: "AND" | "OR";
  conditions: Condition[];
  basis: "pm" | "meteo";
  reference?: string;
}
export type DayStatus = "haze" | "clear" | "nodata";
export interface DayResult {
  date: string;
  status: DayStatus;
}
export interface PeriodStat {
  period: string;
  hazeDays: number;
  clearDays: number;
  validDays: number;
  totalDays: number;
  coverage: number;
  status: "ok" | "insufficient" | "nodata";
}
export interface StatsResponse {
  city: CityRef;
  rule: RuleConfig;
  providerId: string;
  yearly: PeriodStat[];
  monthly: PeriodStat[];
  extras?: {
    longestStreak: { days: number; from: string; to: string } | null;
    yoy: Record<string, number | null>;
    severity?: Record<string, number>;
  };
}
export interface ApiError {
  code:
    | "GEOCODE_NOT_FOUND"
    | "PROVIDER_UNAVAILABLE"
    | "PROVIDER_RATE_LIMITED"
    | "NO_DATA"
    | "INVALID_RULE"
    | "INVALID_PARAMS"
    | "INTERNAL";
  message: Localized;
  suggestProviderIds?: string[];
}
