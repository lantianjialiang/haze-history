import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.ts";
import { geocode } from "./geocode.ts";
import { mockRegistry } from "./mock-provider.test-fixture.ts";
import { presets } from "../shared/presets.ts";
let app: ReturnType<typeof buildApp> | undefined;
afterEach(async () => {
  await app?.close();
  app = undefined;
});

describe("offline geocoding", () => {
  const queries: [string, string[]][] = [
    ["北京", ["CN-110100"]],
    ["Beijing", ["CN-110100"]],
    ["bj", ["CN-110100"]],
    [" 北京市 ", ["CN-110100"]],
    ["ＢＥＩＪＩＮＧ", ["CN-110100"]],
    ["朝阳", ["CN-211300", "CN-110105"]],
    ["Chaoyang", ["CN-211300", "CN-110105"]],
    ["乌鲁木齐", ["CN-650100"]],
    ["wulumuqi", ["CN-650100"]],
    ["Urumqi", ["CN-650100"]],
    ["Xian", ["CN-610100"]],
    ["xiam", ["CN-350200"]],
    ["深证", []],
    ["", []],
    ["   ", []],
    ["广州", ["CN-440100"]],
  ];
  it.each(queries)("matches %j", (query, ids) =>
    expect(geocode(query).map((city) => city.id)).toEqual(ids),
  );
});
const url =
  "/api/series?cityId=CN-110100&providerId=mock-pm-grid&from=2013-01-01&to=2013-01-03&metrics=pm25";
it("returns all requested days and avoids repeat provider calls", async () => {
  const registry = mockRegistry();
  const provider = registry.get("mock-pm-grid")!;
  const calls = vi.spyOn(provider, "getDailySeries");
  app = buildApp({ cachePath: ":memory:", registry });
  const [first, concurrent] = await Promise.all([
    app.inject(url),
    app.inject(url),
  ]);
  expect(first.statusCode).toBe(200);
  expect(concurrent.statusCode).toBe(200);
  expect(first.json()).toMatchObject({
    records: [
      { date: "2013-01-01", pm25: null },
      { date: "2013-01-02", pm25: null },
      { date: "2013-01-03", pm25: null },
    ],
    meta: { cacheHit: false, missingRateByYear: { 2013: 1 } },
  });
  expect((await app.inject(url)).json().meta.cacheHit).toBe(true);
  expect(calls).toHaveBeenCalledTimes(1);
  expect(
    (await app.inject({ method: "POST", url: "/api/cache/invalidate" })).json()
      .removed,
  ).toBe(1);
  expect((await app.inject(url)).json().meta.cacheHit).toBe(false);
  expect(calls).toHaveBeenCalledTimes(2);
});
it("reports structured parameter and provider errors and a missing-data period", async () => {
  app = buildApp({ cachePath: ":memory:", registry: mockRegistry() });
  expect((await app.inject("/api/health")).statusCode).toBe(200);
  expect(
    (await app.inject(url.replace("2013-01-03", "2013-02-29"))).json().code,
  ).toBe("INVALID_PARAMS");
  expect(
    (await app.inject(url.replace("mock-pm-grid", "unavailable"))).json(),
  ).toMatchObject({
    code: "PROVIDER_UNAVAILABLE",
    suggestProviderIds: ["mock-pm-grid", "mock-pm-station"],
  });
  const payload = {
    cityId: "CN-110100",
    providerId: "mock-pm-grid",
    from: "2013-01-01",
    to: "2013-12-31",
    rule: presets[0],
  };
  const response = await app.inject({
    method: "POST",
    url: "/api/stats",
    payload,
  });
  expect(response.statusCode).toBe(200);
  expect(response.json().yearly).toMatchObject([
    { period: "2013", coverage: 0, status: "nodata" },
  ]);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/api/stats",
        payload: { ...payload, rule: {} },
      })
    ).json().code,
  ).toBe("INVALID_RULE");
});
