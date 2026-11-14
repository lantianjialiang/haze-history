import type { RuleConfig } from "./types.ts";
const threshold = (
  id: string,
  zh: string,
  en: string,
  metric: "pm25" | "aqi",
  value: number,
  reference: string,
): RuleConfig => ({
  id,
  name: { zh, en },
  basis: "pm",
  combine: "AND",
  conditions: [{ metric, op: ">", value }],
  reference,
});
const aqiReference =
  "HJ 633–2026 · https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/jcffbz/202602/t20260225_1144441.shtml";
export const presets: RuleConfig[] = [
  threshold(
    "cn-pm25-75",
    "中国 PM2.5 · 75",
    "China PM2.5 · 75",
    "pm25",
    75,
    "GB 3095–2012 · https://www.mee.gov.cn/ywdt/zbft/202602/t20260225_1144479.shtml",
  ),
  threshold(
    "us-pm25-35",
    "美国 PM2.5 · 35",
    "US PM2.5 · 35",
    "pm25",
    35,
    "US EPA · https://www.epa.gov/pm-pollution/timeline-particulate-matter-pm-national-ambient-air-quality-standards-naaqs",
  ),
  threshold(
    "who-pm25-15",
    "世卫 PM2.5 · 15",
    "WHO PM2.5 · 15",
    "pm25",
    15,
    "WHO 2021 · https://www.who.int/Publications/i/Item/9789240034228",
  ),
  ...[100, 150, 200].map((value) =>
    threshold(
      "aqi-" + value,
      "AQI · " + value,
      "AQI · " + value,
      "aqi",
      value,
      aqiReference,
    ),
  ),
  {
    id: "meteo-default",
    name: { zh: "能见度与湿度", en: "Visibility and humidity" },
    basis: "meteo",
    combine: "AND",
    conditions: [
      { metric: "visibility_km", op: "<", value: 10 },
      { metric: "rh", op: "<", value: 90 },
    ],
    reference: "§1 / §12",
  },
];
