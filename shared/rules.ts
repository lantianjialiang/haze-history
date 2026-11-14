import { z } from "zod";
import { dateRange, shiftDate, today } from "./dates.ts";
import {
  metrics,
  operators,
  type DailyRecord,
  type DayResult,
  type DayStatus,
  type Op,
  type PeriodStat,
  type RuleConfig,
} from "./types.ts";

export const maxima = {
  pm25: 5000,
  pm10: 5000,
  aqi: 500,
  visibility_km: 1000,
  rh: 100,
};
const localized = z.object({
  zh: z.string().trim().min(1).max(100),
  en: z.string().trim().min(1).max(100),
});
export const ruleSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]{1,40}$/),
  name: localized,
  combine: z.enum(["AND", "OR"]),
  conditions: z
    .array(
      z
        .object({
          metric: z.enum(metrics),
          op: z.enum(operators),
          value: z.number().finite().min(0),
        })
        .refine((condition) => condition.value <= maxima[condition.metric], {
          path: ["value"],
        }),
    )
    .min(1)
    .max(5),
  basis: z.enum(["pm", "meteo"]),
  reference: z.string().max(500).optional(),
});
export function validateRule(input: unknown) {
  const result = ruleSchema.safeParse(input);
  if (result.success) return { valid: true as const, rule: result.data };
  return {
    valid: false as const,
    errors: result.error.issues.map((issue) => ({
      path: issue.path,
      key: "ruleInvalid",
    })),
  };
}
export const serializeRule = (rule: RuleConfig) => JSON.stringify(rule);
export function parseRule(raw: string) {
  try {
    return validateRule(JSON.parse(raw));
  } catch {
    return {
      valid: false as const,
      errors: [{ path: [], key: "ruleInvalid" }],
    };
  }
}
const compare: Record<Op, (a: number, b: number) => boolean> = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
};
export function classifyDay(record: DailyRecord, rule: RuleConfig): DayStatus {
  let missing = false;
  for (const { metric, op, value } of rule.conditions) {
    const reading = record[metric];
    if (reading == null || !Number.isFinite(reading)) {
      missing = true;
      continue;
    }
    const passes = compare[op](reading, value);
    if (rule.combine === "AND" && !passes) return "clear";
    if (rule.combine === "OR" && passes) return "haze";
  }
  return missing ? "nodata" : rule.combine === "AND" ? "haze" : "clear";
}
export const classifyDays = (
  records: DailyRecord[],
  rule: RuleConfig,
): DayResult[] =>
  records.map((record) => ({
    date: record.date,
    status: classifyDay(record, rule),
  }));
export function aggregate(
  statuses: DayResult[],
  unit: "year" | "month",
  minCoverage = 0.8,
  asOf = today(),
): PeriodStat[] {
  const groups = new Map<string, Pick<PeriodStat, "hazeDays" | "clearDays">>();
  for (const day of new Map(statuses.map((day) => [day.date, day])).values()) {
    if (day.date > asOf) continue;
    const period = day.date.slice(0, unit === "year" ? 4 : 7);
    const group = groups.get(period) ?? { hazeDays: 0, clearDays: 0 };
    if (day.status === "haze") group.hazeDays++;
    if (day.status === "clear") group.clearDays++;
    groups.set(period, group);
  }
  return [...groups]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, group]) => {
      const start = period + (unit === "year" ? "-01-01" : "-01");
      const date = new Date(start + "T00:00:00Z");
      if (unit === "year") date.setUTCFullYear(date.getUTCFullYear() + 1);
      else date.setUTCMonth(date.getUTCMonth() + 1);
      const lastDay = shiftDate(date.toISOString().slice(0, 10), -1);
      const totalDays = [...dateRange(start, lastDay < asOf ? lastDay : asOf)]
        .length;
      const validDays = group.hazeDays + group.clearDays;
      const coverage = validDays / totalDays;
      return {
        period,
        ...group,
        validDays,
        totalDays,
        coverage,
        status:
          coverage === 0
            ? "nodata"
            : coverage < minCoverage
              ? "insufficient"
              : "ok",
      };
    });
}
export function longestStreak(statuses: DayResult[]) {
  let best: { days: number; from: string; to: string } | null = null;
  let days = 0;
  let from = "";
  let previous = "";
  for (const day of statuses) {
    if (day.status !== "haze") {
      days = 0;
      continue;
    }
    if (!days || shiftDate(previous, 1) !== day.date) {
      days = 0;
      from = day.date;
    }
    days++;
    previous = day.date;
    if (!best || days > best.days) best = { days, from, to: day.date };
  }
  return best;
}
export function yearOverYear(yearly: PeriodStat[]) {
  const byYear = new Map(yearly.map((year) => [year.period, year]));
  return Object.fromEntries(
    yearly.map((year) => {
      const last = byYear.get(String(Number(year.period) - 1));
      return [
        year.period,
        last && last.status !== "nodata" && year.status !== "nodata"
          ? year.hazeDays - last.hazeDays
          : null,
      ];
    }),
  );
}
export const ruleText = (
  rule: RuleConfig,
  label: (metric: (typeof metrics)[number]) => string,
  joiner: string,
) =>
  rule.conditions
    .map((condition) =>
      [label(condition.metric), condition.op, condition.value].join(" "),
    )
    .join(" " + joiner + " ");
