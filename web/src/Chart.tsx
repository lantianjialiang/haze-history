import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { HourlyRecord, HourlyResponse, SeriesResponse } from "../../shared/types.ts";
import { ruleText } from "../../shared/rules.ts";
import {
  chartHeight,
  chartOption,
  echarts,
  hourlyOption,
  type Basis,
  type ChartData,
  type ChartKind,
  type Theme,
} from "./charts.ts";
import { api } from "./api.ts";
import { Icon } from "./icons.tsx";
export interface DisplayData {
  definitions: Record<Basis, ChartData>;
  series: Record<Basis, SeriesResponse>;
  sources: Record<Basis, { name: { zh: string; en: string } }>;
}
export function Chart({
  kind,
  data,
  basis,
  year,
  theme,
  onExport,
  onBasis,
  yearPicker,
  cityId,
  providerId,
}: {
  kind: ChartKind;
  data: DisplayData;
  basis: Basis;
  year: number;
  theme: Theme;
  onExport: () => void;
  onBasis?: (basis: Basis) => void;
  yearPicker?: React.ReactNode;
  cityId?: string;
  providerId?: string;
}) {
  const { t, i18n } = useTranslation();
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(820);
  const lang = i18n.language === "en" ? "en" : "zh";
  const shown = kind === "trend" ? (["pm", "meteo"] as const) : [basis];
  const years = data.definitions.pm.stats.yearly.length;
  const height = chartHeight(kind, width, years);
  const calendarStats = data.definitions[basis].stats.yearly.find(
    (row) => row.period === String(year),
  );
  const calendarRule = data.definitions[basis].stats.rule;
  const [day, setDay] = useState<string>();
  const [hours, setHours] = useState<HourlyRecord[] | null>(null);
  const hourly = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (kind !== "calendar") return;
    const days = data.definitions[basis].days.filter((row) =>
      row.date.startsWith(String(year)),
    );
    const latest =
      [...days].reverse().find((row) => row.status !== "nodata") ?? days.at(-1);
    setDay(latest?.date);
  }, [kind, data, basis, year]);
  useEffect(() => {
    if (kind !== "calendar" || !day || !cityId || !providerId) return;
    const controller = new AbortController();
    setHours(null);
    const query = new URLSearchParams({ cityId, providerId, date: day });
    api<HourlyResponse>("/hours?" + query, controller.signal)
      .then((payload) => {
        if (!controller.signal.aborted) setHours(payload.hours);
      })
      .catch(() => {
        if (!controller.signal.aborted) setHours([]);
      });
    return () => controller.abort();
  }, [kind, day, cityId, providerId]);
  useLayoutEffect(() => {
    const element = host.current!;
    const measure = () =>
      setWidth(Math.round(element.getBoundingClientRect().width) || 320);
    const observer = new ResizeObserver(measure);
    measure();
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const chart = echarts.init(host.current!, undefined, {
      renderer: "canvas",
      width,
      height,
    });
    chart.setOption(
      chartOption(
        kind,
        data.definitions,
        basis,
        year,
        theme,
        t,
        i18n.language,
        width,
      ),
    );
    if (kind === "calendar") {
      chart.on("click", (params) => {
        const date = (params.data as { value?: [string, number] } | undefined)
          ?.value?.[0];
        if (typeof date === "string") setDay(date);
      });
    }
    return () => chart.dispose();
  }, [kind, data, basis, year, theme, t, i18n.language, width, height]);
  useLayoutEffect(() => {
    if (kind !== "calendar" || !hourly.current || !hours?.length) return;
    const chart = echarts.init(hourly.current, undefined, {
      renderer: "canvas",
      width,
      height: 220,
    });
    chart.setOption(hourlyOption(hours, day ?? "", theme, t, i18n.language));
    return () => chart.dispose();
  }, [kind, hours, day, theme, t, i18n.language, width]);
  const nf = new Intl.NumberFormat(i18n.language, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  return (
    <section className="surface chart-card">
      <div className="chart-header">
        <div>
          <h2>{t(kind)}</h2>
          <p>
            {t(kind + "Info")}
            {kind === "calendar" ? " " + t("hourlyHint") : ""}
          </p>
        </div>
        <button className="button compact" onClick={onExport}>
          <Icon name="download" />
          {t("export")}
        </button>
      </div>
      {onBasis && (
        <div className="chart-controls">
          <div className="segment" aria-label={t("basis")}>
            {(["pm", "meteo"] as const).map((key) => (
              <button
                key={key}
                onClick={() => onBasis(key)}
                aria-pressed={basis === key}
              >
                {t(key)}
              </button>
            ))}
          </div>
          {yearPicker}
        </div>
      )}
      {kind === "calendar" && (
        <div className="calendar-summary">
          <strong>
            {t("calendarTotal", {
              year,
              countLabel:
                !calendarStats || calendarStats.status === "nodata"
                  ? t("nodata")
                  : new Intl.NumberFormat(i18n.language).format(
                      calendarStats.hazeDays,
                    ) +
                    " " +
                    t("days"),
            })}
          </strong>
          {calendarStats && (
            <span>
              {t(calendarStats.status)} · {t("coverage")}{" "}
              {nf.format(calendarStats.coverage)}
            </span>
          )}
          <span>
            {t("rule")} · {ruleText(calendarRule, t, t(calendarRule.combine))}
          </span>
        </div>
      )}
      {shown.some((key) => data.series[key].providerId === "noaa-isd-xian") && (
        <p className="chart-provenance">{t("airportVisibilityNote")}</p>
      )}
      <div
        ref={host}
        className="chart"
        role="img"
        aria-label={t(kind)}
        style={{ height }}
      />
      {kind === "calendar" && day && (
        <div className="hourly-panel">
          <h3>
            {t("hourly")} · {day}
          </h3>
          {hours == null ? (
            <p>{t("loading")}</p>
          ) : hours.some(
              (hour) =>
                hour.pm25 != null ||
                hour.pm10 != null ||
                hour.aqi != null ||
                hour.visibility_km != null ||
                hour.rh != null,
            ) ? (
            <div
              ref={hourly}
              className="chart hourly-chart"
              role="img"
              aria-label={t("hourly")}
              style={{ height: 220 }}
            />
          ) : (
            <p>{t("hourlyEmpty")}</p>
          )}
        </div>
      )}
      <div className="legend-strip">
        {kind === "calendar" && (
          <>
            <span>
              <i className={"swatch " + basis} />
              {t("haze")}
            </span>
            <span>
              <i className="swatch clear" />
              {t("clear")}
            </span>
          </>
        )}
        <span>
          <i className="swatch missing" />
          {t("nodata")}
        </span>
        {kind !== "calendar" && (
          <span>
            <i className="swatch low" />
            {t("insufficient")}
          </span>
        )}
      </div>
      <div className="chart-provenance">
        {shown.map((key) => {
          const { stats } = data.definitions[key];
          const meta = data.series[key].meta;
          const date = new Intl.DateTimeFormat(i18n.language, {
            dateStyle: "medium",
            timeZone: "Asia/Shanghai",
          }).format(new Date(meta.fetchedAt));
          const missing = meta.missingRateByYear[String(year)];
          return (
            <div key={key}>
              <strong>{data.sources[key].name[lang]}</strong> ·{" "}
              {t(
                data.series[key].sourceType === "measured"
                  ? "observed"
                  : "model",
              )}{" "}
              · {ruleText(stats.rule, t, t(stats.rule.combine))}
              {" · "}
              {t("updated", { date })}
              {missing != null &&
                " · " + year + " " + t("missing") + " " + nf.format(missing)}
              {meta.stationInfo &&
                " · " +
                  t("station") +
                  " " +
                  meta.stationInfo.name +
                  " (" +
                  meta.stationInfo.distanceKm +
                  " km)"}
            </div>
          );
        })}
      </div>
      <details className="data-table">
        <summary>{t("table")}</summary>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{t(kind === "calendar" ? "date" : "period")}</th>
                <th>{t("basis")}</th>
                <th>{t("status")}</th>
                {kind !== "calendar" && (
                  <>
                    <th>{t("days")}</th>
                    <th>{t("coverage")}</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {shown.flatMap((key) => {
                const entry = data.definitions[key];
                if (kind === "calendar")
                  return entry.days
                    .filter((day) => day.date.startsWith(String(year)))
                    .map((day) => (
                      <tr key={key + day.date}>
                        <td>{day.date}</td>
                        <td>{t(key)}</td>
                        <td>{t(day.status)}</td>
                      </tr>
                    ));
                return (
                  kind === "trend" ? entry.stats.yearly : entry.stats.monthly
                ).map((row) => (
                  <tr key={key + row.period}>
                    <td>{row.period}</td>
                    <td>{t(key)}</td>
                    <td>{t(row.status)}</td>
                    <td>{row.status === "nodata" ? "—" : row.hazeDays}</td>
                    <td>{nf.format(row.coverage)}</td>
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
