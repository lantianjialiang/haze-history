import { expect, it } from "vitest";
import { compareBases } from "./overlap.ts";
import type { DayStatus } from "./types.ts";

it("compares only shared valid dates in the selected year", () => {
  const day = (index: number, status: DayStatus) => ({
    date: "2024-01-0" + index,
    status,
  });
  expect(
    compareBases(
      [
        day(1, "haze"),
        day(2, "haze"),
        day(3, "clear"),
        day(4, "nodata"),
        day(5, "haze"),
        day(6, "clear"),
      ],
      [
        day(1, "haze"),
        day(2, "clear"),
        day(3, "haze"),
        day(4, "haze"),
        day(6, "clear"),
      ],
      2024,
    ),
  ).toEqual({ valid: 4, both: 1, onlyPm: 1, onlyMeteo: 1 });
});
