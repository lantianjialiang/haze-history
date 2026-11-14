import { readFile, stat, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { checked, csvRows, hourInShanghai, relativeHumidity } from "./spike/parse.ts";

const path = "data/reference/xian-isd-2024.gz";
const previousPath = "data/reference/xian-global-hourly-2023.csv";
const previous = await readFile(previousPath, "utf8");
const [columns, ...previousRows] = csvRows(previous);
const field = (row: string[], name: string) => row[columns.indexOf(name)];
const observations = new Map<string, { visibility: number; rh: number }>();
function add(hour: string, visibility: number | null, temp: number | null, dew: number | null, report: string) {
  if (!/^202[34]-/.test(hour) || observations.has(hour) || visibility == null || temp == null || dew == null) return;
  observations.set(hour, {
    visibility: report === "FM-15" && visibility === 9.999 ? 10 : visibility,
    rh: relativeHumidity(temp, dew),
  });
}
for (const row of previousRows) {
  if (field(row, "STATION") !== "57036099999") throw new Error("Unexpected station");
  add(hourInShanghai(field(row, "DATE") + "Z"), checked(field(row, "VIS"), 999999, 1000),
    checked(field(row, "TMP"), 9999, 10), checked(field(row, "DEW"), 9999, 10), field(row, "REPORT_TYPE"));
}
const rows = gunzipSync(await readFile(path))
  .toString()
  .trimEnd()
  .split(/\r?\n/);
for (const row of rows) {
  if (row.slice(4, 15) !== "57036099999") throw new Error("Unexpected station");
  const stamp = row.slice(15, 27);
  const utc = stamp.replace(
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})$/,
    "$1-$2-$3T$4:$5:00Z",
  );
  const hour = hourInShanghai(utc);
  const visibility = checked(row.slice(78, 84) + "," + row[84], 999999, 1000);
  const temp = checked(row.slice(87, 92) + "," + row[92], 9999, 10);
  const dew = checked(row.slice(93, 98) + "," + row[98], 9999, 10);
  add(hour, visibility, temp, dew, row.slice(41, 46));
}
const days = new Map<
  string,
  { visibility: number; rh: number; hours: number }
>();
for (const [hour, reading] of observations) {
  const date = hour.slice(0, 10);
  const day = days.get(date) ?? { visibility: 0, rh: 0, hours: 0 };
  day.visibility += reading.visibility;
  day.rh += reading.rh;
  day.hours++;
  days.set(date, day);
}
const values = [...days]
  .filter(([, day]) => day.hours >= 18)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([date, day]) => ({
    date,
    visibility_km: day.visibility / day.hours,
    rh: day.rh / day.hours,
    validHours: day.hours,
  }));
await writeFile(
  "data/reference/xian-isd-daily.json",
  JSON.stringify(
    {
      fetchedAt: new Date(Math.max((await stat(path)).mtimeMs, (await stat(previousPath)).mtimeMs)).toISOString(),
      cities: { "CN-610100": values },
    },
    null,
    2,
  ) + "\n",
);
console.log({
  rows: rows.length,
  pairedHours: observations.size,
  validDays: values.length,
  hazeDays: values.filter((day) => day.visibility_km < 10 && day.rh < 90)
    .length,
});
