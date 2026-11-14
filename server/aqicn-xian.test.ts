import { describe, expect, it } from "vitest";
import { parseAqicnCsv } from "./aqicn-xian.ts";

describe("parseAqicnCsv", () => {
  it("parses slash dates and pollutants", () => {
    const rows = parseAqicnCsv(`date, pm25, pm10, o3
2014/3/2, 213, 195, 
2026/11/14, 194, , `);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ date: "2014-03-02", pm25: 213, pm10: 195 });
    expect(rows[1]).toMatchObject({ date: "2026-11-14", pm25: 194, pm10: null });
    expect(rows[1].aqi).toBeGreaterThan(0);
  });

  it("merges duplicate dates", () => {
    const rows = parseAqicnCsv(`date, pm25, pm10
2020/1/1, 50, 60
2020/1/1, , 70`);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ date: "2020-01-01", pm25: 50, pm10: 70 });
  });
});