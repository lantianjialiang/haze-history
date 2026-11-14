import { describe, expect, it } from "vitest";
import {
  aggregate,
  classifyDay,
  longestStreak,
  parseRule,
  serializeRule,
  validateRule,
  yearOverYear,
} from "./rules.ts";
import { presets } from "./presets.ts";
import { validDate } from "./dates.ts";
import type { DailyRecord, DayStatus, RuleConfig } from "./types.ts";
import en from "./locales/en.json";
import zh from "./locales/zh-CN.json";

const readings = [0, 1, null];
const expected: Record<string, DayStatus[]> = {
  AND: [
    "clear",
    "clear",
    "clear",
    "clear",
    "haze",
    "nodata",
    "clear",
    "nodata",
    "nodata",
  ],
  OR: [
    "clear",
    "haze",
    "nodata",
    "haze",
    "haze",
    "haze",
    "nodata",
    "haze",
    "nodata",
  ],
};
const record = (pm25: number | null, aqi: number | null): DailyRecord => ({
  date: "2024-02-29",
  pm25,
  aqi,
  visibility_km: null,
  rh: null,
});
describe("missing data truth tables", () => {
  for (const combine of ["AND", "OR"] as const) {
    readings
      .flatMap((a) => readings.map((b) => [a, b]))
      .forEach(([a, b], index) => {
        it(combine + " " + a + " " + b, () => {
          const rule: RuleConfig = {
            ...presets[0],
            combine,
            conditions: [
              { metric: "pm25", op: ">", value: 0 },
              { metric: "aqi", op: ">", value: 0 },
            ],
          };
          expect(classifyDay(record(a, b), rule)).toBe(
            expected[combine][index],
          );
        });
      });
  }
});
describe("presets and validation", () => {
  for (const rule of presets)
    it(rule.id, () => {
      const high = { ...record(300, 300), visibility_km: 4, rh: 85 };
      const exact = { ...high };
      for (const { metric, value } of rule.conditions) exact[metric] = value;
      expect(classifyDay(high, rule)).toBe("haze");
      expect(classifyDay(exact, rule)).toBe("clear");
      expect(parseRule(serializeRule(rule))).toEqual({ valid: true, rule });
    });
  it("rejects illegal RH, an empty rule, and invalid serializations", () => {
    expect(
      validateRule({
        ...presets[0],
        conditions: [{ metric: "rh", op: ">", value: 101 }],
      }).valid,
    ).toBe(false);
    expect(validateRule({ ...presets[0], conditions: [] }).valid).toBe(false);
    expect(parseRule("broken").valid).toBe(false);
  });
  it("uses the same keys in both languages", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(zh).sort());
  });
});
it("counts natural days across leap-year and current-year boundaries", () => {
  const statuses = [
    { date: "2023-12-31", status: "nodata" },
    { date: "2024-01-01", status: "clear" },
    { date: "2024-02-29", status: "haze" },
    { date: "2025-01-01", status: "clear" },
  ] as const;
  const annual = aggregate([...statuses], "year", 0.8, "2025-01-01");
  expect(annual).toMatchObject([
    { totalDays: 365, status: "nodata" },
    { totalDays: 366, status: "insufficient" },
    { totalDays: 1, status: "ok" },
  ]);
  expect(
    aggregate([...statuses], "month", 0.8, "2025-01-01").find(
      (row) => row.period === "2024-02",
    )?.totalDays,
  ).toBe(29);
  expect(yearOverYear(annual)).toEqual({ 2023: null, 2024: null, 2025: -1 });
  expect(validDate("2023-02-29")).toBe(false);
});
it("breaks streaks on missing or skipped dates", () => {
  expect(
    longestStreak([
      { date: "2024-01-01", status: "haze" },
      { date: "2024-01-02", status: "nodata" },
      { date: "2024-01-03", status: "haze" },
      { date: "2024-01-05", status: "haze" },
      { date: "2024-01-06", status: "haze" },
    ]),
  ).toEqual({ from: "2024-01-05", to: "2024-01-06", days: 2 });
});
