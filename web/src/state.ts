import cityList from "../../data/cities-cn.json";
import { today } from "../../shared/dates.ts";
import { presets } from "../../shared/presets.ts";
import { parseRule, serializeRule } from "../../shared/rules.ts";
import type { RuleConfig } from "../../shared/types.ts";
import { remember, stored, validLanguage, type Language } from "./i18n.ts";

export const currentYear = Number(today().slice(0, 4));
export const years = Array.from(
  { length: currentYear - 2012 },
  (_, i) => 2013 + i,
);
export const sourceIds = {
  pm: [
    "quotsoft-cnemc",
    "cnemc-recent",
    "cams-recent",
    "stateair-embassy",
    "aqicn-xian",
  ],
  meteo: ["open-meteo-recent", "noaa-isd-xian"],
} as const;
export interface Settings {
  cityId: string;
  lang: Language;
  view: "single" | "compare";
  pm: string;
  meteo: string;
  from: number;
  to: number;
  calendar: number;
  basis: "pm" | "meteo";
  pmRule: RuleConfig;
  meteoRule: RuleConfig;
}
export function readSettings() {
  const query = new URLSearchParams(location.search);
  let invalid = false;
  function read<T>(
    key: string,
    fallback: T,
    parse: (raw: string) => T | undefined,
  ): T {
    const raw = query.get(key);
    if (raw == null) return fallback;
    const value = parse(raw);
    if (value !== undefined) return value;
    invalid = true;
    return fallback;
  }
  const numeric = (raw: string) =>
    years.includes(Number(raw)) && /^\d{4}$/.test(raw)
      ? Number(raw)
      : undefined;
  const rules = (key: string, basis: "pm" | "meteo") =>
    read(
      key,
      presets.find((rule) => rule.basis === basis)!,
      (raw) => {
        const preset = presets.find(
          (rule) => rule.id === raw && rule.basis === basis,
        );
        if (preset) return preset;
        const result = parseRule(raw);
        return result.valid && result.rule.basis === basis
          ? result.rule
          : undefined;
      },
    );
  const candidate =
    location.pathname.match(/^\/city\/([^/]+)\/?$/)?.[1] ?? "CN-610100";
  const cityId = cityList.some((city) => city.id === candidate)
    ? candidate
    : ((invalid = true), "CN-610100");
  let from = read("from", currentYear, numeric);
  let to = read("to", currentYear, numeric);
  if (from > to) {
    from = 2013;
    to = currentYear;
    invalid = true;
  }
  const saved = stored("haze.lang");
  const settings: Settings = {
    cityId,
    lang: read("lang", validLanguage(saved) ? saved : "zh-CN", (raw) =>
      validLanguage(raw) ? raw : undefined,
    ),
    view: read<Settings["view"]>("view", "single", (raw) =>
      raw === "single" || raw === "compare" ? raw : undefined,
    ),
    pm: read<string>("pm", sourceIds.pm[0], (raw) =>
      sourceIds.pm.some((id) => id === raw) ? raw : undefined,
    ),
    meteo: read<string>("meteo", sourceIds.meteo[0], (raw) =>
      sourceIds.meteo.some((id) => id === raw) ? raw : undefined,
    ),
    from,
    to,
    basis: read<Settings["basis"]>("basis", "pm", (raw) =>
      raw === "pm" || raw === "meteo" ? raw : undefined,
    ),
    calendar: read(
      "calendar",
      Math.max(from, Math.min(to, currentYear - 1)),
      (raw) =>
        Number(raw) >= from && Number(raw) <= to ? numeric(raw) : undefined,
    ),
    pmRule: rules("pmRule", "pm"),
    meteoRule: rules("meteoRule", "meteo"),
  };
  return { settings, invalid };
}
export function syncSettings(
  settings: Settings,
  pathname: string,
  replace = false,
) {
  const q = new URLSearchParams({
    lang: settings.lang,
    view: settings.view,
    pm: settings.pm,
    meteo: settings.meteo,
    from: String(settings.from),
    to: String(settings.to),
    calendar: String(settings.calendar),
    basis: settings.basis,
  });
  for (const key of ["pmRule", "meteoRule"] as const) {
    const rule = settings[key];
    q.set(key, presets.includes(rule) ? rule.id : serializeRule(rule));
    remember("haze." + key, serializeRule(rule));
  }
  const url = pathname + "?" + q;
  if (location.pathname + location.search !== url) {
    if (replace) history.replaceState(null, "", url);
    else history.pushState(null, "", url);
  }
}
