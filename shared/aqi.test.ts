import { describe, expect, it } from "vitest";
import { pm25ToAqi } from "./aqi.ts";

describe("pm25ToAqi", () => {
  it("uses HJ 633—2012 PM2.5 breakpoints", () => {
    expect(pm25ToAqi(0)).toBe(0);
    expect(pm25ToAqi(35)).toBe(50);
    expect(pm25ToAqi(75)).toBe(100);
    expect(pm25ToAqi(115)).toBe(150);
  });
});
