import { mkdir, writeFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import cities from "../../../data/cities-overview.json";
import {
  dateRange,
  FIRST_DAY,
  today,
  yearsBetween,
} from "../../../shared/dates.ts";
import { upstream } from "../../upstream.ts";
import {
  checked,
  csvRows,
  distance,
  hourInShanghai,
  relativeHumidity,
} from "./parse.ts";
import type { CityRef } from "../../../shared/types.ts";

const sampleCities = [
  "110100",
  "310100",
  "510100",
  "130100",
  "440100",
  "650100",
];
const stationIds = ["54511", "58367", "56294", "53698", "59287", "51463"];
const stationCenters = [
  [39.933, 116.283],
  [31.417, 121.45],
  [30.667, 104.017],
  [38.033, 114.417],
  [23.167, 113.333],
  [43.783, 87.617],
];
const selected = sampleCities.map((code) =>
  cities.find((city) => city.adcode === code)!,
);
const end = today();
const start = FIRST_DAY;
const years = yearsBetween(start, end);
const out = "data/spike-samples";
const noaa = upstream(Number(process.env.NOAA_INTERVAL_MS ?? 500));
const meteostat = upstream(Number(process.env.METEOSTAT_INTERVAL_MS ?? 500));
const cams = upstream(Number(process.env.CAMS_INTERVAL_MS ?? 1800));
const geocode = upstream(750);
const openaq = upstream(1500);
type Hour = {
  hour: string;
  pm25?: number | null;
  vis?: number | null;
  rh?: number | null;
};
type Attempt = {
  year: string;
  status: string;
  ms: number;
  rows: Hour[];
  sample?: unknown;
};

async function attempt(
  year: string,
  request: () => Promise<Response>,
  parse: (response: Response) => Promise<Pick<Attempt, "rows" | "sample">>,
): Promise<Attempt> {
  const clock = Date.now();
  try {
    const response = await request();
    if (!response.ok) {
      const sample = (await response.text()).slice(0, 800);
      return {
        year,
        ms: Date.now() - clock,
        status: String(response.status),
        rows: [],
        sample,
      };
    }
    const data = await parse(response);
    return {
      year,
      ms: Date.now() - clock,
      status: String(response.status),
      ...data,
    };
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    return {
      year,
      ms: Date.now() - clock,
      status: [String(error), cause ? String(cause) : ""].join(" ").trim(),
      rows: [],
    };
  }
}
function measure(
  attempts: Attempt[],
  fields: ("pm25" | "vis" | "rh")[],
  candidateStart: string,
) {
  const hours = new Map<string, Hour>();
  for (const { rows } of attempts)
    for (const row of rows) {
      if (row.hour.slice(0, 10) < start || row.hour.slice(0, 10) > end)
        continue;
      const previous = hours.get(row.hour);
      const combined = { ...previous, hour: row.hour };
      for (const field of fields)
        combined[field] = previous?.[field] ?? row[field] ?? null;
      hours.set(row.hour, combined);
    }
  const daily = new Map<
    string,
    {
      counts: Record<string, number>;
      paired: number;
      sums: Record<string, number>;
    }
  >();
  for (const hour of hours.values()) {
    const day = hour.hour.slice(0, 10);
    const row = daily.get(day) ?? { counts: {}, sums: {}, paired: 0 };
    for (const metric of fields)
      if (hour[metric] != null) {
        row.counts[metric] = (row.counts[metric] ?? 0) + 1;
        row.sums[metric] = (row.sums[metric] ?? 0) + hour[metric]!;
      }
    if (hour.vis != null && hour.rh != null) row.paired++;
    daily.set(day, row);
  }
  const annual = Object.fromEntries(
    years.map((year) => {
      const days = [
        ...dateRange(
          year + "-01-01",
          year === end.slice(0, 4) ? end : year + "-12-31",
        ),
      ];
      const run = attempts.find((item) => item.year === year);
      const measured = run?.status === "200" || run?.status === "404";
      const valid = (filter: (day: string) => boolean) =>
        measured ? days.filter(filter).length : null;
      return [
        year,
        {
          total: days.length,
          status:
            run?.status ??
            (year < candidateStart ? "outside documented period" : "untested"),
          valid: Object.fromEntries(
            fields.map((field) => [
              field,
              valid((day) => (daily.get(day)?.counts[field] ?? 0) >= 18),
            ]),
          ),
          paired: fields.includes("vis")
            ? Object.fromEntries(
                [1, 8, 18].map((min) => [
                  min,
                  valid((day) => (daily.get(day)?.paired ?? 0) >= min),
                ]),
              )
            : undefined,
        },
      ];
    }),
  );
  const pmDaily = Object.fromEntries(
    [...daily]
      .filter(([, row]) => (row.counts.pm25 ?? 0) >= 18)
      .map(([day, row]) => [
        day,
        +(row.sums.pm25 / row.counts.pm25).toFixed(3),
      ]),
  );
  return { annual, pmDaily };
}
async function put(
  source: string,
  city: CityRef,
  attempts: Attempt[],
  fields: ("pm25" | "vis" | "rh")[] = [],
  candidateStart = "2013",
  station?: { id: string; distanceKm: number },
) {
  const data = measure(attempts, fields, candidateStart);
  const samples = attempts.flatMap((item) =>
    item.sample == null ? [] : [{ year: item.year, sample: item.sample }],
  );
  const report = {
    city: city.id,
    source,
    station,
    ...data,
    requests: attempts.map(({ year, status, ms }) => ({ year, status, ms })),
    raw: samples.slice(0, 3),
  };
  const json = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(json) > 200_000)
    throw new Error("Sample limit exceeded");
  await writeFile(out + "/" + source + "_" + city.id + ".json", json);
  console.log(
    source,
    city.id,
    report.requests.map((item) => item.status).join(" "),
  );
}
async function runCams(city: CityRef, from = start, to = end) {
  const attempts: Attempt[] = [];
  for (const year of yearsBetween(from, to).filter((year) => +year >= 2022)) {
    const startDate = [from, year + "-01-01", "2022-08-01"].sort().at(-1)!;
    const endDate = [to, year + "-12-31"].sort()[0];
    if (startDate > endDate) continue;
    const params = new URLSearchParams({
      latitude: String(city.lat),
      longitude: String(city.lon),
      hourly: "pm2_5",
      timezone: "Asia/Shanghai",
      start_date: startDate,
      end_date: endDate,
      domains: "cams_global",
    });
    attempts.push(
      await attempt(
        year,
        () =>
          cams(
            "https://air-quality-api.open-meteo.com/v1/air-quality?" + params,
          ),
        async (response) => {
          const json = (await response.json()) as {
            hourly: { time: string[]; pm2_5: (number | null)[] };
          };
          return {
            rows: json.hourly.time.map((hour, i) => ({
              hour: hour.slice(0, 13),
              pm25: json.hourly.pm2_5[i],
            })),
            sample: {
              time: json.hourly.time.slice(0, 24),
              pm25: json.hourly.pm2_5.slice(0, 24),
            },
          };
        },
      ),
    );
  }
  return attempts;
}
async function runNoaa(city: CityRef, index: number) {
  const station = stationIds[index] + "099999";
  const [lat, lon] = stationCenters[index];
  const attempts: Attempt[] = [];
  for (const year of [...years, String(Number(years[0]) - 1)]) {
    attempts.push(
      await attempt(
        year,
        () =>
          noaa(
            "https://www.ncei.noaa.gov/pub/data/noaa/" +
              year +
              "/" +
              station.slice(0, 6) +
              "-99999-" +
              year +
              ".gz",
          ),
        async (response) => {
          const rows = gunzipSync(Buffer.from(await response.arrayBuffer()))
            .toString()
            .trimEnd()
            .split(/\r?\n/);
          if (rows[0].slice(4, 15) !== station)
            throw new Error("Unexpected NOAA record format");
          return {
            sample: rows.slice(0, 4).map((row) => row.slice(0, 105)),
            rows: rows.map((row) => {
              const utc =
                row.slice(15, 19) +
                "-" +
                row.slice(19, 21) +
                "-" +
                row.slice(21, 23) +
                "T" +
                row.slice(23, 25) +
                ":" +
                row.slice(25, 27) +
                ":00Z";
              const temperature = checked(
                row.slice(87, 92) + "," + row[92],
                9999,
                10,
              );
              const dewpoint = checked(
                row.slice(93, 98) + "," + row[98],
                9999,
                10,
              );
              return {
                hour: hourInShanghai(utc),
                vis: checked(row.slice(78, 84) + "," + row[84], 999999, 1000),
                rh:
                  temperature == null || dewpoint == null
                    ? null
                    : relativeHumidity(temperature, dewpoint),
              };
            }),
          };
        },
      ),
    );
  }
  await put("noaa-isd", city, attempts, ["vis", "rh"], "2013", {
    id: station,
    distanceKm: +distance(city.lat, city.lon, lat, lon).toFixed(2),
  });
}
async function runMeteostat(city: CityRef, index: number) {
  const attempts: Attempt[] = [];
  for (const year of [...years, String(Number(years[0]) - 1)]) {
    attempts.push(
      await attempt(
        year,
        () =>
          meteostat(
            "https://data.meteostat.net/hourly/" +
              year +
              "/" +
              stationIds[index] +
              ".csv.gz",
          ),
        async (response) => {
          const [headers, ...rows] = csvRows(
            gunzipSync(Buffer.from(await response.arrayBuffer())).toString(),
          );
          const [y, m, d, hour] = ["year", "month", "day", "hour"].map(
            (field) => headers.indexOf(field),
          );
          const v = headers.indexOf("vis"),
            h = headers.indexOf("rhum");
          if (Math.min(y, m, d, hour) < 0)
            throw new Error("Missing Meteostat date columns");
          return {
            sample: [headers, ...rows.filter((row) => row[y]).slice(0, 3)],
            rows: rows
              .filter((row) => row[y])
              .map((row) => ({
                hour: hourInShanghai(
                  row[y] +
                    "-" +
                    row[m].padStart(2, "0") +
                    "-" +
                    row[d].padStart(2, "0") +
                    "T" +
                    row[hour].padStart(2, "0") +
                    ":00:00Z",
                ),
                vis:
                  row[v] && Number.isFinite(Number(row[v]))
                    ? Number(row[v]) / 1000
                    : null,
                rh:
                  row[h] && Number.isFinite(Number(row[h]))
                    ? Number(row[h])
                    : null,
              })),
          };
        },
      ),
    );
  }
  await put("meteostat", city, attempts, ["vis", "rh"]);
}
async function runMetadata(city: CityRef) {
  const q = new URLSearchParams({
    name: city.name.en,
    countryCode: "CN",
    count: "8",
    language: "en",
  });
  await put("geocoding", city, [
    await attempt(
      "lookup",
      () => geocode("https://geocoding-api.open-meteo.com/v1/search?" + q),
      async (response) => ({ rows: [], sample: await response.json() }),
    ),
  ]);
  const coords = new URLSearchParams({
    coordinates: city.lat + "," + city.lon,
    radius: "25000",
    parameters_id: "2",
    limit: "10",
  });
  const key = process.env.OPENAQ_API_KEY;
  await put(
    "openaq",
    city,
    [
      await attempt(
        "lookup",
        () =>
          openaq(
            "https://api.openaq.org/v3/locations?" + coords,
            key ? { "X-API-Key": key } : undefined,
          ),
        async (response) => ({ rows: [], sample: await response.json() }),
      ),
    ],
    ["pm25"],
  );
}

await mkdir(out, { recursive: true });
if (process.argv.includes("--overview")) {
  const started = performance.now();
  const batches = await Promise.all(cities.map((city) => runCams(city)));
  const incremental = performance.now();
  const increments = await Promise.all(
    cities.map((city) => runCams(city, end, end)),
  );
  const summary = (list: Attempt[][]) => ({
    cities: list.length,
    requests: list.flat().length,
    failedRequests: list.flat().filter((item) => item.status !== "200").length,
    failedCities: list.filter((items) =>
      items.some((item) => item.status !== "200"),
    ).length,
  });
  await writeFile(
    out + "/overview-timing.json",
    JSON.stringify(
      {
        full: { ...summary(batches), ms: Math.round(incremental - started) },
        incremental: {
          ...summary(increments),
          ms: Math.round(performance.now() - incremental),
        },
      },
      null,
      2,
    ),
  );
} else {
  const tasks = selected.flatMap((city, i) =>
    process.argv.includes("--weather")
      ? [runNoaa(city, i), runMeteostat(city, i)]
      : [
          runCams(city).then((attempts) =>
            put("cams", city, attempts, ["pm25"], "2022"),
          ),
          runNoaa(city, i),
          runMeteostat(city, i),
          runMetadata(city),
        ],
  );
  const results = await Promise.allSettled(tasks);
  for (const result of results)
    if (result.status === "rejected") {
      process.exitCode = 1;
      console.error(result.reason);
    }
}
