import {
  aggregate,
  classifyDays,
  longestStreak,
  yearOverYear,
} from "../../shared/rules.ts";
import type { RuleConfig, SeriesResponse, StatsResponse } from "../../shared/types.ts";

const MIN_COVERAGE = 0.8;

export function computeStats(
  series: SeriesResponse,
  rule: RuleConfig,
): StatsResponse {
  const statuses = classifyDays(series.records, rule);
  const yearly = aggregate(statuses, "year", MIN_COVERAGE);
  return {
    city: series.city,
    rule,
    providerId: series.providerId,
    yearly,
    monthly: aggregate(statuses, "month", MIN_COVERAGE),
    extras: {
      longestStreak: longestStreak(statuses),
      yoy: yearOverYear(yearly),
    },
  };
}