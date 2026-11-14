import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, ScatterChart } from "echarts/charts";
import {
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { TFunction } from "i18next";
import type {
  DayResult,
  PeriodStat,
  StatsResponse,
} from "../../shared/types.ts";
echarts.use([
  BarChart,
  HeatmapChart,
  ScatterChart,
  CalendarComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  CanvasRenderer,
]);
export { echarts };

export type Theme = "light" | "dark";
export type ChartKind = "trend" | "monthly" | "calendar";
export type Basis = "pm" | "meteo";
export interface ChartData {
  stats: StatsResponse;
  days: DayResult[];
}
export const colors = (theme: Theme) =>
  theme === "dark"
    ? {
        text: "#dce5db",
        muted: "#a8b9ad",
        grid: "#364941",
        panel: "#1a2822",
        pm: "#79b9a4",
        meteo: "#f4bc78",
        missing: "#54635b",
        clear: "#263d34",
      }
    : {
        text: "#172e25",
        muted: "#51675d",
        grid: "#dfe6de",
        panel: "#fff",
        pm: "#286d59",
        meteo: "#c17a39",
        missing: "#c7cdc7",
        clear: "#e5efe7",
      };
const decal = {
  symbol: "rect",
  symbolSize: 1,
  dashArrayX: [1, 0],
  dashArrayY: [2, 3],
  rotation: -Math.PI / 4,
  color: "rgba(82,96,86,.55)",
};

const tooltipRow = (t: TFunction, lang: string, row?: PeriodStat) =>
  row && row.status !== "nodata"
    ? new Intl.NumberFormat(lang).format(row.hazeDays) +
      " " +
      t("days") +
      " · " +
      t(row.status) +
      " · " +
      new Intl.NumberFormat(lang, {
        style: "percent",
        maximumFractionDigits: 1,
      }).format(row.coverage)
    : t("nodata");

export function chartOption(
  kind: ChartKind,
  data: Record<Basis, ChartData>,
  basis: Basis,
  year: number,
  theme: Theme,
  t: TFunction,
  lang: string,
  width: number,
): echarts.EChartsCoreOption {
  const c = colors(theme);
  const shortMonth = new Intl.DateTimeFormat(lang, {
    month: "short",
    timeZone: "UTC",
  });
  const months = Array.from({ length: 12 }, (_, index) =>
    shortMonth.format(new Date(Date.UTC(2024, index, 1))),
  );
  const base = {
    animation: false,
    textStyle: {
      color: c.text,
      fontFamily: "system-ui, Microsoft YaHei, sans-serif",
    },
    tooltip: {
      confine: true,
      renderMode: "richText",
      backgroundColor: c.panel,
      textStyle: { color: c.text },
    },
  };
  if (kind === "trend") {
    const years = data.pm.stats.yearly.map((row) => row.period);
    const all = [...data.pm.stats.yearly, ...data.meteo.stats.yearly];
    const max = Math.max(
      30,
      Math.ceil(Math.max(...all.map((stat) => stat.hazeDays)) / 30) * 30,
    );
    return {
      ...base,
      grid: { left: 42, right: 18, top: 38, bottom: 32 },
      legend: {
        data: [t("pm"), t("meteo")],
        textStyle: { color: c.muted },
        right: 5,
        top: 0,
      },
      xAxis: {
        type: "category",
        data: years,
        axisTick: { show: false },
        axisLine: { lineStyle: { color: c.grid } },
        axisLabel: { color: c.muted, hideOverlap: true },
      },
      yAxis: {
        type: "value",
        max,
        axisLabel: { color: c.muted },
        splitLine: { lineStyle: { color: c.grid, type: "dashed" } },
      },
      tooltip: {
        ...base.tooltip,
        trigger: "axis",
        formatter: (items: unknown) => {
          const row = (items as { axisValue: string }[])[0];
          if (!row) return "";
          return [
            row.axisValue,
            ...(["pm", "meteo"] as const).map(
              (key) =>
                t(key) +
                " · " +
                tooltipRow(
                  t,
                  lang,
                  data[key].stats.yearly.find(
                    (stat) => stat.period === row.axisValue,
                  ),
                ),
            ),
          ].join("\n");
        },
      },
      series: [
        ...(["pm", "meteo"] as const).map((key) => ({
          type: "bar",
          name: t(key),
          barMaxWidth: 20,
          itemStyle: { color: c[key] },
          data: data[key].stats.yearly.map((stat) => ({
            value: stat.status === "nodata" ? null : stat.hazeDays,
            itemStyle: {
              color: c[key],
              borderRadius: [3, 3, 0, 0],
              opacity: stat.status === "insufficient" ? 0.56 : 1,
              decal: stat.status === "insufficient" ? decal : undefined,
            },
          })),
        })),
        ...(["pm", "meteo"] as const).map((key, index) => ({
          type: "scatter",
          name: t(key),
          symbol: "rect",
          symbolSize: [8, 4],
          symbolOffset: [index ? 6 : -6, 0],
          data: data[key].stats.yearly
            .filter((row) => row.status === "nodata")
            .map((row) => [row.period, max * 0.025]),
          itemStyle: { color: c.missing, decal },
        })),
      ],
    };
  }
  const stats = data[basis].stats;
  if (kind === "monthly") {
    const years = stats.yearly.map((row) => row.period).reverse();
    const byMonth = new Map(stats.monthly.map((row) => [row.period, row]));
    return {
      ...base,
      grid: { left: 50, right: 12, top: 33, bottom: 8 },
      visualMap: {
        show: false,
        min: 0,
        max: 31,
        dimension: 2,
        inRange: { color: [c.clear, c[basis]] },
        outOfRange: { color: c.missing },
      },
      xAxis: {
        type: "category",
        data: months,
        position: "top",
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: c.muted, hideOverlap: true },
      },
      yAxis: {
        type: "category",
        data: years,
        inverse: true,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { color: c.muted },
      },
      tooltip: {
        ...base.tooltip,
        formatter: (params: unknown) => {
          const {
            data: { period },
          } = params as { data: { period: string } };
          return period + " · " + tooltipRow(t, lang, byMonth.get(period));
        },
      },
      series: [
        {
          type: "heatmap",
          data: years.flatMap((label, y) =>
            months.flatMap((_, x) => {
              const period = label + "-" + String(x + 1).padStart(2, "0");
              const row = byMonth.get(period);
              if (!row) return [];
              const missing = row.status === "nodata",
                low = row.status === "insufficient";
              // The visual dimension uses a separate out-of-range palette index for missing cells.
              return [
                {
                  period,
                  value: [x, y, missing ? -1 : row.hazeDays],
                  itemStyle: {
                    borderWidth: 2,
                    borderColor: c.panel,
                    borderRadius: 3,
                    color: missing ? c.missing : undefined,
                    opacity: low ? 0.75 : 1,
                    decal: missing || low ? decal : undefined,
                  },
                },
              ];
            }),
          ),
        },
      ],
    };
  }
  const narrow = width < 600;
  return {
    ...base,
    visualMap: {
      show: false,
      type: "piecewise",
      dimension: 1,
      pieces: [
        { value: 0, color: c.missing },
        { value: 1, color: c.clear },
        { value: 2, color: c[basis] },
      ],
    },
    calendar: {
      range: String(year),
      orient: narrow ? "vertical" : "horizontal",
      left: narrow ? "center" : 42,
      right: narrow ? undefined : 10,
      top: 32,
      cellSize: narrow
        ? [Math.max(15, Math.min(30, (width - 72) / 7)), 12]
        : ["auto", 22],
      yearLabel: { show: false },
      monthLabel: { nameMap: months, color: c.muted, margin: 10 },
      dayLabel: {
        firstDay: 1,
        color: c.muted,
        nameMap: Array.from({ length: 7 }, (_, index) =>
          new Intl.DateTimeFormat(lang, {
            weekday: "short",
            timeZone: "UTC",
          }).format(new Date(Date.UTC(2024, 0, 7 + index))),
        ),
      },
      itemStyle: { color: c.panel, borderColor: c.grid, borderWidth: 0.5 },
      splitLine: { show: false },
    },
    tooltip: {
      ...base.tooltip,
      formatter: (params: unknown) => {
        const {
          data: { value, status },
        } = params as {
          data: { value: [string, number | null]; status: string };
        };
        return value[0] + " · " + t(status);
      },
    },
    series: [
      {
        type: "heatmap",
        coordinateSystem: "calendar",
        data: data[basis].days
          .filter((day) => day.date.startsWith(String(year)))
          .map((day) => ({
            value: [day.date, { nodata: 0, clear: 1, haze: 2 }[day.status]],
            status: day.status,
            itemStyle: {
              color:
                day.status === "nodata"
                  ? c.missing
                  : day.status === "haze"
                    ? c[basis]
                    : c.clear,
              borderColor: c.panel,
              borderWidth: 1.4,
              decal: day.status === "nodata" ? decal : undefined,
            },
          })),
      },
    ],
  };
}
export function chartHeight(kind: ChartKind, width: number, years: number) {
  return kind === "trend"
    ? width < 600
      ? 250
      : 292
    : kind === "monthly"
      ? Math.max(165, years * 21 + 48)
      : width < 600
        ? 690
        : 212;
}
