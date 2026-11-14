import type { TFunction } from "i18next";
import { today } from "../../shared/dates.ts";
import { ruleText } from "../../shared/rules.ts";
import { copyright } from "../../shared/copyright.ts";
import {
  chartHeight,
  chartOption,
  colors,
  echarts,
  type Basis,
  type ChartKind,
  type Theme,
} from "./charts.ts";
import type { DisplayData } from "./Chart.tsx";
import type { Language } from "./i18n.ts";
export const sizes = {
  "social-square": [1080, 1080],
  "social-wide": [1600, 900],
  "a4-portrait": [1240, 1754],
  "4k": [3840, 2160],
} as const;
export interface ExportOptions {
  format: "png";
  preset: keyof typeof sizes;
  scale: 1 | 2 | 3;
  theme: Theme;
  includeWatermark: boolean;
  lang: Language;
}
export interface ExportTarget {
  kind: ChartKind | "poster";
  data: DisplayData;
  basis: Basis;
  year: number;
  from: number;
  to: number;
}
function wrap(context: CanvasRenderingContext2D, text: string, width: number) {
  const lines: string[] = [];
  let line = "";
  const chunks =
    text.match(/[^\s\p{Script=Han}]+\s*|\p{Script=Han}|\s+/gu) ?? [];
  for (const chunk of chunks) {
    if (line && context.measureText(line + chunk).width > width) {
      lines.push(line);
      line = "";
    }
    line += chunk;
  }
  lines.push(line);
  return lines;
}
export async function exportImage(
  target: ExportTarget,
  options: ExportOptions,
  t: TFunction,
  preview = false,
): Promise<Blob> {
  await document.fonts.ready;
  const [fullWidth, fullHeight] = sizes[options.preset];
  const scale = preview
    ? Math.min(1, 800 / fullWidth, 900 / fullHeight)
    : options.scale;
  const width = 960,
    height = Math.round((width * fullHeight) / fullWidth);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(fullWidth * scale);
  canvas.height = Math.round(fullHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.scale(canvas.width / width, canvas.height / height);
  const c = colors(options.theme);
  const { data, kind, basis, year } = target;
  const lang = options.lang === "en" ? "en" : "zh";
  const city = data.definitions.pm.stats.city;
  const shown =
    kind === "poster" || kind === "trend"
      ? (["pm", "meteo"] as const)
      : [basis];
  const pad = 36,
    inner = width - pad * 2;
  const font = (size: number, weight = 400) =>
    (ctx.font =
      weight +
      " " +
      size +
      'px system-ui, "Microsoft YaHei", "Noto Sans CJK SC", sans-serif');
  ctx.fillStyle = c.panel;
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = c.text;
  font(34, 700);
  ctx.fillText(t("heading", { city: city.name[lang] }), pad, 55);
  ctx.fillStyle = c.muted;
  font(17);
  ctx.fillText(
    target.from +
      "–" +
      target.to +
      " · " +
      t(kind === "poster" ? "trend" : kind) +
      (kind === "calendar" ? " · " + year : ""),
    pad,
    84,
  );
  ctx.fillStyle = c[basis];
  font(15, 700);
  const sourceKind = (key: (typeof shown)[number]) =>
    data.series[key].sourceType === "measured" ? "observed" : "model";
  ctx.fillText(shown.map((key) => t(sourceKind(key))).join(" · "), pad, 108);
  const yearSummaries = shown.map((key) => {
    const latest = data.definitions[key].stats.yearly
      .filter((row) => Number(row.period) < Number(today().slice(0, 4)))
      .at(-1);
    return latest
      ? t(key) +
          " " +
          latest.period +
          " · " +
          (latest.status === "nodata"
            ? t("nodata")
            : latest.hazeDays + " " + t("days"))
      : t(key) + " · " + t("nodata");
  });
  if (kind === "poster") {
    font(17, 700);
    ctx.fillText(yearSummaries.join("     "), pad, 133);
  }
  const charts: ChartKind[] =
    kind === "poster" ? ["trend", "monthly", "calendar"] : [kind];
  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(options.lang, {
      dateStyle: "medium",
      timeZone: "Asia/Shanghai",
    }).format(new Date(value));
  const footer = shown.map(
    (key) =>
      data.sources[key].name[lang] +
      " · " +
      t(sourceKind(key)) +
      " · " +
      ruleText(
        data.definitions[key].stats.rule,
        t,
        t(data.definitions[key].stats.rule.combine),
      ) +
      " · " +
      t("updated", { date: formatDate(data.series[key].meta.fetchedAt) }),
  );
  footer.push(
    t("nodata") +
      " · " +
      t("insufficient") +
      " · " +
      t("generated", { date: formatDate(today() + "T12:00:00+08:00") }),
  );
  footer.push(t("recentInfo"));
  if (kind === "calendar" || kind === "poster") {
    const row = data.definitions[basis].stats.yearly.find(
      (item) => item.period === String(year),
    );
    footer.push(
      t("calendarTotal", {
        year,
        countLabel:
          !row || row.status === "nodata"
            ? t("nodata")
            : new Intl.NumberFormat(options.lang).format(row.hazeDays) +
              " " +
              t("days"),
      }),
    );
  }
  if (shown.some((key) => data.series[key].providerId === "noaa-isd-xian")) {
    footer.push(t("airportVisibilityNote"));
  }
  if (options.includeWatermark) footer.push(t("brand"));
  footer.push(copyright);
  font(15);
  const footerLines = footer.flatMap((line) => wrap(ctx, line, inner));
  const footerHeight = footerLines.length * 19 + 24;
  let y = kind === "poster" ? 150 : 125;
  const slot = (height - y - footerHeight) / charts.length;
  for (const chartKind of charts) {
    const compact = slot < 200;
    const virtualWidth = compact ? 960 : inner;
    const virtualHeight = chartHeight(
      chartKind,
      virtualWidth,
      data.definitions.pm.stats.yearly.length,
    );
    const instance = echarts.init(document.createElement("div"), undefined, {
      renderer: "canvas",
      width: virtualWidth,
      height: virtualHeight,
      devicePixelRatio: Math.min(3, canvas.width / width),
    });
    try {
      instance.setOption(
        chartOption(
          chartKind,
          data.definitions,
          basis,
          year,
          options.theme,
          t,
          options.lang,
          virtualWidth,
        ),
      );
      const image = instance.renderToCanvas();
      const label =
        kind === "poster"
          ? t(chartKind) + (chartKind === "trend" ? "" : " · " + t(basis))
          : "";
      if (label) {
        ctx.fillStyle = c.text;
        font(16, 700);
        ctx.fillText(label, pad, y + 14);
      }
      const gap = label ? 16 : 0;
      ctx.drawImage(
        image,
        pad,
        y + gap,
        inner,
        Math.min(virtualHeight, slot - gap - 4),
      );
      y += slot;
    } finally {
      instance.dispose();
    }
  }
  ctx.fillStyle = c.muted;
  font(15);
  y += 14;
  for (const line of footerLines) {
    ctx.fillText(line, pad, y);
    y += 19;
  }
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob ? resolve(blob) : reject(new Error("PNG encoding failed")),
      "image/png",
    ),
  );
}
export function exportFilename(target: ExportTarget, lang: Language) {
  const stat = target.data.definitions[target.basis].stats;
  const city = stat.city.name[lang === "en" ? "en" : "zh"].replace(
    /[^\p{L}\p{N}-]+/gu,
    "-",
  );
  const rule =
    target.kind === "trend" || target.kind === "poster"
      ? target.data.definitions.pm.stats.rule.id +
        "-" +
        target.data.definitions.meteo.stats.rule.id
      : stat.rule.id;
  return (
    "haze_" +
    city +
    "_" +
    target.from +
    "-" +
    target.to +
    "_" +
    rule +
    "_" +
    today().replaceAll("-", "") +
    ".png"
  );
}
