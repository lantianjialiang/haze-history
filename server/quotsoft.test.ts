import { describe, expect, it } from "vitest";
import { parseBeijingCsv, parseCityCsv } from "./quotsoft.ts";

const cities = [
  { id: "CN-110100", name: "北京" },
  { id: "CN-310100", name: "上海" },
];

describe("quotsoft city csv", () => {
  it("uses hourly means when 12 hours exist", () => {
    const hours = Array.from({ length: 12 }, (_, hour) => {
      const stamp = String(hour);
      return [
        `20240101,${stamp},PM2.5,80,20`,
        `20240101,${stamp},PM2.5_24h,90,25`,
        `20240101,${stamp},AQI,110,30`,
      ].join("\n");
    });
    const rows = parseCityCsv(
      "date,hour,type,北京,上海\n" + hours.join("\n"),
      cities,
    );
    expect(rows).toMatchObject([
      { cityId: "CN-110100", date: "2024-01-01", pm25: 80, aqi: 110, method: "hourly-mean" },
      { cityId: "CN-310100", date: "2024-01-01", pm25: 20, aqi: 30, method: "hourly-mean" },
    ]);
  });

  it("falls back to the last 24-hour value", () => {
    const rows = parseCityCsv(
      "date,hour,type,北京,上海\n20240102,22,PM2.5,70,10\n20240102,22,PM2.5_24h,88,12\n20240102,22,AQI,120,20",
      cities,
    );
    expect(rows[0]).toMatchObject({
      cityId: "CN-110100",
      pm25: 88,
      aqi: 120,
      method: "published-24h",
      validHours: 1,
    });
  });
});

describe("beijing station csv", () => {
  it("averages stations and skips reference sites", () => {
    const rows = parseBeijingCsv(
      "date,hour,type,东四,天坛,定陵(对照点)\n20131206,1,PM2.5,80,100,10\n20131206,1,AQI,110,130,20",
    );
    expect(rows[0]).toMatchObject({
      cityId: "CN-110100",
      date: "2013-12-06",
      pm25: 90,
      aqi: 120,
      method: "hourly-mean",
    });
  });
});
