import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { dateRange, today, yearsBetween } from "../shared/dates.ts";
import type { CityRef, Metric, SeriesResponse } from "../shared/types.ts";
import { emptyDay, missingRate, type DataProvider } from "./providers.ts";

export class SeriesCache {
  private db: DatabaseSync;
  private pending = new Map<string, Promise<SeriesResponse>>();
  private generation = 0;
  constructor(
    path: string,
    private ttlHours = 12,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS series (
        city_id TEXT NOT NULL, provider_id TEXT NOT NULL, year TEXT NOT NULL,
        payload TEXT NOT NULL, through_date TEXT NOT NULL, fetched_ms INTEGER NOT NULL,
        PRIMARY KEY (city_id, provider_id, year)
      );
      PRAGMA user_version=1;
    `);
  }
  close() {
    this.db.close();
  }
  invalidate() {
    this.generation++;
    return Number(this.db.prepare("DELETE FROM series").run().changes);
  }

  private async year(
    city: CityRef,
    provider: DataProvider,
    year: string,
    now: string,
  ) {
    const id = provider.meta.id;
    const end = year === now.slice(0, 4) ? now : year + "-12-31";
    const cached = this.db
      .prepare(
        "SELECT payload, through_date, fetched_ms FROM series WHERE city_id=? AND provider_id=? AND year=?",
      )
      .get(city.id, id, year) as
      { payload: string; through_date: string; fetched_ms: number } | undefined;
    const fresh =
      cached != null &&
      Date.now() - cached.fetched_ms < this.ttlHours * 3600000;
    if (
      cached &&
      cached.through_date >= end &&
      (id === "quotsoft-cnemc" || id === "noaa-isd-xian" || id.endsWith("-recent") ? fresh : end < now || fresh)
    ) {
      return { data: JSON.parse(cached.payload) as SeriesResponse, hit: true };
    }
    const generation = this.generation;
    const key = [city.id, id, year, end, generation].join("/");
    let request = this.pending.get(key);
    if (!request) {
      request = provider
        .getDailySeries(city, year + "-01-01", end, provider.meta.metrics)
        .then((data) => {
          if (generation !== this.generation) return data;
          this.db
            .prepare(
              `INSERT INTO series VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(city_id,provider_id,year) DO UPDATE SET payload=excluded.payload,through_date=excluded.through_date,fetched_ms=excluded.fetched_ms`,
            )
            .run(city.id, id, year, JSON.stringify(data), end, Date.now());
          return data;
        })
        .finally(() => this.pending.delete(key));
      this.pending.set(key, request);
    }
    return { data: await request, hit: false };
  }
  async series(
    city: CityRef,
    provider: DataProvider,
    from: string,
    to: string,
    requested: Metric[],
  ) {
    const now = today();
    const years = await Promise.all(
      yearsBetween(from, to).map((year) =>
        this.year(city, provider, year, now),
      ),
    );
    const readings = new Map(
      years.flatMap((year) =>
        year.data.records.map((row) => [row.date, row] as const),
      ),
    );
    const metricsReturned = provider.meta.metrics.filter((metric) =>
      requested.includes(metric),
    );
    const records = [...dateRange(from, to)].map((date) => {
      const source = readings.get(date);
      const row = emptyDay(date);
      for (const metric of metricsReturned)
        row[metric] = source?.[metric] ?? null;
      if (source?.validHours != null) row.validHours = source.validHours;
      return row;
    });
    const latest = years
      .map((year) => year.data)
      .sort((a, b) => b.meta.fetchedAt.localeCompare(a.meta.fetchedAt))[0];
    return {
      ...latest,
      city,
      records,
      metricsReturned,
      meta: {
        ...latest.meta,
        cacheHit: years.every((year) => year.hit),
        missingRateByYear: missingRate(records, requested),
      },
    };
  }
}
