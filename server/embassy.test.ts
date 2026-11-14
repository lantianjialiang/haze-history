import { describe, expect, it } from "vitest";
import { EmbassyStore, parseEmbassyCsv, parseStateAirCsv } from "./embassy.ts";
import { pm25ToAqi } from "../shared/aqi.ts";

describe("embassy csv", () => {
  it("reads the US Post column and builds daily means", () => {
    const text = [
      "No,year,month,day,hour,PM_Dongsi,PM_US Post",
      "1,2013,1,2,0,10,100",
      "2,2013,1,2,1,12,120",
      ...Array.from({ length: 10 }, (_, hour) =>
        [hour + 3, 2013, 1, 2, hour + 2, 11, 80 + hour].join(","),
      ),
    ].join("\n");
    const rows = parseEmbassyCsv(text, "CN-110100");
    expect(rows[0]).toMatchObject({
      cityId: "CN-110100",
      date: "2013-01-02",
      hour: 0,
      pm25: 100,
    });
    const store = new EmbassyStore(":memory:");
    store.ingest(rows);
    const days = store.cityDays("CN-110100", "2013-01-02", "2013-01-02");
    expect(days[0]?.valid_hours).toBe(12);
    expect(days[0]?.aqi).toBe(pm25ToAqi(days[0]!.pm25!));
    expect(store.cityHours("CN-110100", "2013-01-02")[0]?.pm25).toBe(100);
    store.close();
  });

  it("reads the UCI Beijing pm2.5 column", () => {
    const rows = parseEmbassyCsv(
      "No,year,month,day,hour,pm2.5\n1,2010,1,2,0,129",
      "CN-110100",
    );
    expect(rows).toEqual([
      { cityId: "CN-110100", date: "2010-01-02", hour: 0, pm25: 129 },
    ]);
  });
});

describe("stateair csv", () => {
  it("uses Raw Conc. and drops Missing/Invalid hours", () => {
    const rows = parseStateAirCsv(
      [
        "Site,Parameter,Date (LT),Year,Month,Day,Hour,NowCast Conc.,AQI,AQI Category,Raw Conc.,Conc. Unit,Duration,QC Name",
        "Beijing,PM2.5 - Principal,2016-01-01 01:00 AM,2016,01,01,01,222.3,272,Very Unhealthy,231.0,UG/M3,1 Hr,Valid",
        "Beijing,PM2.5 - Principal,2016-02-25 12:00 PM,2016,02,25,12,18.9,65,Moderate,-999.0,UG/M3,1 Hr,Missing",
        "Beijing,PM2.5 - Principal,2016-02-25 01:00 PM,2016,02,25,13,-999.0,-999,N/A,-15.0,UG/M3,1 Hr,Invalid",
      ].join("\n"),
      "CN-110100",
    );
    expect(rows).toEqual([
      { cityId: "CN-110100", date: "2016-01-01", hour: 1, pm25: 231 },
      { cityId: "CN-110100", date: "2016-02-25", hour: 12, pm25: null },
      { cityId: "CN-110100", date: "2016-02-25", hour: 13, pm25: null },
    ]);
  });

  it("merges later hours into an existing daily mean", () => {
    const store = new EmbassyStore(":memory:");
    store.ingest(
      Array.from({ length: 12 }, (_, hour) => ({
        cityId: "CN-110100",
        date: "2016-06-01",
        hour,
        pm25: 100,
      })),
    );
    store.ingest([
      { cityId: "CN-110100", date: "2016-06-01", hour: 12, pm25: 10 },
    ]);
    expect(store.cityDays("CN-110100", "2016-06-01", "2016-06-01")[0]).toMatchObject({
      valid_hours: 13,
      pm25: 93.1,
    });
    store.close();
  });
});
