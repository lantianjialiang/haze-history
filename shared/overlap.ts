import type { DayResult } from "./types.ts";

export function compareBases(
  pm: DayResult[],
  meteo: DayResult[],
  year: number,
) {
  const weather = new Map(meteo.map((day) => [day.date, day.status]));
  const result = { valid: 0, both: 0, onlyPm: 0, onlyMeteo: 0 };
  for (const day of pm) {
    if (day.date.slice(0, 4) !== String(year) || day.status === "nodata")
      continue;
    const other = weather.get(day.date);
    if (!other || other === "nodata") continue;
    result.valid++;
    if (day.status === "haze" && other === "haze") result.both++;
    else if (day.status === "haze") result.onlyPm++;
    else if (other === "haze") result.onlyMeteo++;
  }
  return result;
}
