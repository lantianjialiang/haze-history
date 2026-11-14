import { mkdir, readFile, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import { upstream } from "../../upstream.ts";
import { csvRows, hourInShanghai } from "./parse.ts";
import { dateRange, today, yearsBetween } from "../../../shared/dates.ts";

const base = "https://openaq-data-archive.s3.amazonaws.com/";
const fetchArchive = upstream(Number(process.env.STATEAIR_INTERVAL_MS ?? 250));
const prefix = "records/csv.gz/locationid=21/";
const output = "data/spike-samples";
const end = today();
const full = process.argv.includes("--full");
const from = full ? "2013-01-01" : "2022-08-01";
const to = full ? end : "2023-12-31";

async function readMonth(month: string) {
  const query = new URLSearchParams({
    "list-type": "2",
    prefix:
      prefix + "year=" + month.slice(0, 4) + "/month=" + month.slice(5) + "/",
  });
  const list = await fetchArchive(base + "?" + query);
  if (!list.ok) throw new Error("S3 list returned " + list.status);
  const xml = await list.text();
  const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(([, key]) => key);
  const hours = new Map<string, number>();
  const raw: string[][] = [];
  let failures = 0;
  for (const key of keys) {
    try {
      const response = await fetchArchive(base + key);
      if (!response.ok) {
        failures++;
        continue;
      }
      const [header, ...rows] = csvRows(
        gunzipSync(Buffer.from(await response.arrayBuffer())).toString(),
      );
      const datetime = header.indexOf("datetime"),
        parameter = header.indexOf("parameter"),
        value = header.indexOf("value"),
        units = header.indexOf("units");
      if (Math.min(datetime, parameter, value, units) < 0)
        throw new Error("Unexpected OpenAQ columns");
      if (!raw.length) raw.push(header, ...rows.slice(0, 3));
      for (const row of rows) {
        if (
          row[parameter] !== "pm25" ||
          !["µg/m³", "μg/m³", "ug/m3"].includes(row[units]) ||
          !row[value]
        )
          continue;
        const reading = Number(row[value]);
        if (Number.isFinite(reading) && reading >= 0)
          hours.set(hourInShanghai(row[datetime]), reading);
      }
    } catch {
      failures++;
    }
  }
  console.log(
    month,
    keys.length,
    "files",
    hours.size,
    "hours",
    failures,
    "failures",
  );
  return { month, keys: keys.length, failures, hours: [...hours], raw };
}
await mkdir(output, { recursive: true });
const start = performance.now();
const months = [
  ...new Set([...dateRange(from, to)].map((day) => day.slice(0, 7))),
];
const results = await Promise.allSettled(months.map(readMonth));
const days = new Map<string, number[]>();
const raw: string[][] = [];
const coverage = results.map((result, index) => {
  if (result.status === "rejected")
    return { month: months[index], error: String(result.reason) };
  const { month, keys, failures, hours, raw: sample } = result.value;
  for (const [hour, value] of hours) {
    const date = hour.slice(0, 10);
    const row = days.get(date) ?? [];
    row.push(value);
    days.set(date, row);
  }
  if (sample.length && raw.length < 12) raw.push(...sample);
  return { month, keys, failures };
});
const measured = Object.fromEntries(
  [...days]
    .filter(([, row]) => row.length >= 18)
    .map(([day, row]) => [
      day,
      row.reduce((sum, value) => sum + value, 0) / row.length,
    ]),
);
const model = JSON.parse(
  await readFile(output + "/cams_CN-110100.json", "utf8"),
).pmDaily as Record<string, number>;
const pairs = Object.entries(measured).flatMap(([date, value]) =>
  model[date] == null ? [] : [{ date, measured: value, model: model[date] }],
);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
const mean = (values: number[]) => sum(values) / values.length;
const averageModel = mean(pairs.map((pair) => pair.model));
const averageMeasured = mean(pairs.map((pair) => pair.measured));
const deviations = pairs.map((pair) => [
  pair.model - averageModel,
  pair.measured - averageMeasured,
]);
const correlation =
  sum(deviations.map(([a, b]) => a * b)) /
  Math.sqrt(
    sum(deviations.map(([a]) => a * a)) * sum(deviations.map(([, b]) => b * b)),
  );
const overlap = {
  days: pairs.length,
  from: pairs[0]?.date,
  to: pairs.at(-1)?.date,
  correlation,
  meanBias: averageModel - averageMeasured,
  counts: [35, 75].map((value) => ({
    value,
    model: pairs.filter((pair) => pair.model > value).length,
    measured: pairs.filter((pair) => pair.measured > value).length,
  })),
};
const dates = Object.keys(measured);
const annual = Object.fromEntries(
  yearsBetween(from, to).map((year) => [
    year,
    dates.filter((date) => date.startsWith(year)).length,
  ]),
);
const json = JSON.stringify(
  {
    city: "CN-110100",
    station: "OpenAQ location 21",
    from,
    to,
    annual,
    coverage,
    overlap,
    measured,
    raw,
    wallMs: Math.round(performance.now() - start),
  },
  null,
  2,
);
if (Buffer.byteLength(json) > 200_000) throw new Error("Sample limit exceeded");
await writeFile(output + "/stateair_CN-110100.json", json);
console.log(overlap);
