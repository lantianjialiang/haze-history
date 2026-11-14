import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import overview from "../../data/cities-overview.json";
import cityList from "../../data/cities-cn.json";
import { today } from "../../shared/dates.ts";
import { classifyDays, serializeRule } from "../../shared/rules.ts";
import type {
  ApiError,
  CityRef,
  ProviderMeta,
  SeriesResponse,
  StatsResponse,
} from "../../shared/types.ts";
import { api } from "./api.ts";
import { Chart, type DisplayData } from "./Chart.tsx";
import type { Basis, ChartKind, Theme } from "./charts.ts";
import { ExportDialog } from "./ExportDialog.tsx";
import type { ExportTarget } from "./export.ts";
import { Icon } from "./icons.tsx";
import { remember, stored } from "./i18n.ts";
import { RuleEditor } from "./RuleEditor.tsx";
import { Search } from "./Search.tsx";
import {
  currentYear,
  readSettings,
  syncSettings,
  years,
  type Settings,
} from "./state.ts";

const bases = ["pm", "meteo"] as const;
const popular = [
  "110100",
  "310100",
  "510100",
  "440100",
  "130100",
  "650100",
].map((code) => overview.find((city) => city.adcode === code)!);
const ipSources = [
  {
    name: "中国环境监测总站空气质量发布",
    url: "https://air.cnemc.cn:18007/",
  },
  {
    name: "quotsoft 空气质量历史归档",
    url: "https://quotsoft.net/air/",
  },
  {
    name: "Open-Meteo / Copernicus CAMS",
    url: "https://open-meteo.com/en/docs/air-quality-api",
  },
  {
    name: "NOAA / NCEI Global Hourly",
    url: "https://www.ncei.noaa.gov/products/land-based-station/integrated-surface-database",
  },
  { name: "OpenAQ", url: "https://docs.openaq.org/about/about" },
  { name: "Meteostat", url: "https://dev.meteostat.net/data" },
];

interface RecentComparison {
  fetchedAt: string | null;
  anchor?: string;
  cities: {
    id: string;
    name: { zh: string; en: string };
    latest: {
      pm25: number | null;
      pm25_24h: number | null;
      aqi: number | null;
      stations: number;
    } | null;
    cams24h: number | null;
    overlapDays: number;
    bias: number | null;
    measuredOver75: number;
    modelOver75: number;
  }[];
}

function ComparisonTable({
  data,
  lang,
}: {
  data: RecentComparison | null;
  lang: "zh" | "en";
}) {
  const { t } = useTranslation();
  const rows = [...(data?.cities ?? [])].sort(
    (a, b) => (b.latest?.pm25_24h ?? -1) - (a.latest?.pm25_24h ?? -1),
  );
  const nf = new Intl.NumberFormat(lang === "zh" ? "zh-CN" : "en", {
    maximumFractionDigits: 1,
  });
  const num = (value: number | null | undefined) =>
    value == null ? "—" : nf.format(value);
  return (
    <section className="surface map-placeholder">
      <h2>{t("compare")}</h2>
      <p>{t("compareLead")}</p>
      {data?.anchor && (
        <p>
          {data.anchor}
          {data.fetchedAt
            ? " · " +
              new Intl.DateTimeFormat(lang === "zh" ? "zh-CN" : "en", {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "Asia/Shanghai",
              }).format(new Date(data.fetchedAt))
            : ""}
        </p>
      )}
      {rows.length === 0 ? (
        <p>{t("compareEmpty")}</p>
      ) : (
        <div className="table-scroll compare-table">
          <table>
            <thead>
              <tr>
                <th>{t("colCity")}</th>
                <th>{t("colPm")}</th>
                <th>{t("colPm24")}</th>
                <th>{t("colAqi")}</th>
                <th>{t("colCams24")}</th>
                <th>{t("colBias")}</th>
                <th>{t("colOverlap")}</th>
                <th>{t("colOver75")}</th>
                <th>{t("colModelOver75")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.name[lang]}</td>
                  <td>{num(row.latest?.pm25)}</td>
                  <td>{num(row.latest?.pm25_24h)}</td>
                  <td>{num(row.latest?.aqi)}</td>
                  <td>{num(row.cams24h)}</td>
                  <td>{num(row.bias)}</td>
                  <td>{row.overlapDays}</td>
                  <td>
                    {row.measuredOver75}/{row.overlapDays}
                  </td>
                  <td>
                    {row.modelOver75}/{row.overlapDays}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p>{t("mapWaiting")}</p>
    </section>
  );
}

export function App() {
  const { t, i18n } = useTranslation();
  const [route, setRoute] = useState(() => ({
    ...readSettings(),
    pathname: location.pathname,
  }));
  const settings = route.settings;
  const lang = settings.lang === "en" ? "en" : "zh";
  const city = cityList.find((candidate) => candidate.id === settings.cityId)!;
  const [theme, setTheme] = useState<Theme>(() =>
    stored("haze.theme") === "dark" ? "dark" : "light",
  );
  const [basis, setBasis] = useState<Basis>("pm");
  const [exportTarget, setExport] = useState<ExportTarget>();
  const [attempt, setAttempt] = useState(0);
  const [sources, setSources] = useState<ProviderMeta[]>([]);
  const [comparison, setComparison] = useState<RecentComparison | null>(null);
  const [last, setLast] = useState<{
    key: string;
    data: DisplayData;
    settings: Settings;
  }>();
  const [problem, setProblem] = useState<{ key: string; error: ApiError }>();
  const requestKey = JSON.stringify([
    settings.cityId,
    settings.from,
    settings.to,
    settings.pm,
    settings.meteo,
    serializeRule(settings.pmRule),
    serializeRule(settings.meteoRule),
    attempt,
  ]);
  const isNotes = route.pathname === "/about";
  const activeProblem = problem?.key === requestKey ? problem.error : undefined;
  const updating = last?.key !== requestKey && !activeProblem;

  useEffect(() => {
    syncSettings(route.settings, route.pathname, true);
    const onPop = () =>
      setRoute({ ...readSettings(), pathname: location.pathname });
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
    // The initial URL is normalized once. Subsequent navigation is explicit.
  }, []);
  useEffect(() => {
    document.documentElement.lang = settings.lang;
    void i18n.changeLanguage(settings.lang);
    remember("haze.lang", settings.lang);
  }, [settings.lang, i18n]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    remember("haze.theme", theme);
  }, [theme]);
  useEffect(() => {
    document.title = t("brand");
  }, [t]);
  useEffect(() => {
    const controller = new AbortController();
    api<ProviderMeta[]>("/sources", controller.signal)
      .then(setSources)
      .catch(() => {});
    return () => controller.abort();
  }, [attempt]);
  useEffect(() => {
    if (settings.view !== "compare") return;
    const controller = new AbortController();
    api<RecentComparison>("/recent-comparison", controller.signal)
      .then(setComparison)
      .catch(() => setComparison({ fetchedAt: null, cities: [] }));
    return () => controller.abort();
  }, [settings.view, attempt]);
  useEffect(() => {
    if (isNotes || settings.view === "compare") return;
    const controller = new AbortController();
    const from = settings.from + "-01-01";
    const to = settings.to === currentYear ? today() : settings.to + "-12-31";
    Promise.all(
      bases.map(async (key) => {
        const rule = key === "pm" ? settings.pmRule : settings.meteoRule;
        const providerId = settings[key];
        const params = { cityId: settings.cityId, providerId, from, to };
        const metricList = [
          ...new Set(rule.conditions.map((condition) => condition.metric)),
        ].join(",");
        const q = new URLSearchParams({ ...params, metrics: metricList });
        const [stats, series] = await Promise.all([
          api<StatsResponse>("/stats", controller.signal, { ...params, rule }),
          api<SeriesResponse>("/series?" + q, controller.signal),
        ]);
        return { stats, series, days: classifyDays(series.records, rule) };
      }),
    )
      .then(([pm, meteo]) => {
        if (controller.signal.aborted) return;
        const name = (id: string) =>
          sources.find((source) => source.id === id)?.name ?? {
            zh: id,
            en: id,
          };
        setLast({
          key: requestKey,
          settings,
          data: {
            definitions: { pm, meteo },
            series: { pm: pm.series, meteo: meteo.series },
            sources: {
              pm: { name: name(settings.pm) },
              meteo: { name: name(settings.meteo) },
            },
          },
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setProblem({
            key: requestKey,
            error: { ...error, code: error.code ?? "INTERNAL" },
          });
      });
    return () => controller.abort();
    // Only data inputs should initiate a new request.
  }, [requestKey, isNotes, settings.view, sources]);

  function update(patch: Partial<Settings>, pathname = route.pathname) {
    const next = { ...settings, ...patch };
    next.calendar = Math.max(next.from, Math.min(next.to, next.calendar));
    syncSettings(next, pathname);
    setRoute({ settings: next, pathname, invalid: false });
  }
  function selectCity(next: CityRef) {
    update({ cityId: next.id, view: "single" }, "/city/" + next.id);
  }
  const exportChart = (kind: ChartKind | "poster") => {
    if (!last) return;
    const range = last.settings;
    setExport({
      kind,
      data: last.data,
      basis,
      year: Math.max(range.from, Math.min(range.to, settings.calendar)),
      from: range.from,
      to: range.to,
    });
  };
  const percent = new Intl.NumberFormat(settings.lang, {
    style: "percent",
    maximumFractionDigits: 1,
  });
  const nf = new Intl.NumberFormat(settings.lang);
  const chartYear = last
    ? Math.max(
        last.settings.from,
        Math.min(last.settings.to, settings.calendar),
      )
    : settings.calendar;
  const yearPicker = (
    <label className="inline-field">
      {t("year")}{" "}
      <select
        value={chartYear}
        onChange={(e) => update({ calendar: Number(e.target.value) })}
      >
        {years
          .filter((y) => y >= settings.from && y <= settings.to)
          .map((y) => (
            <option key={y}>{y}</option>
          ))}
      </select>
    </label>
  );

  return (
    <>
      <header className="topbar">
        <div className="shell topbar-inner">
          <a
            className="brand"
            href="/"
            onClick={(e) => {
              e.preventDefault();
              update({ cityId: "CN-110100", view: "single" }, "/");
            }}
          >
            <span className="brand-mark">
              <Icon name="wind" />
            </span>
            <span>{t("brand")}</span>
          </a>
          <nav aria-label={t("home")}>
            <a
              href="/"
              aria-current={!isNotes ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                update({ view: "single" }, "/city/" + settings.cityId);
              }}
            >
              {t("home")}
            </a>
            <a
              href="/about"
              aria-current={isNotes ? "page" : undefined}
              onClick={(e) => {
                e.preventDefault();
                update({}, "/about");
              }}
            >
              {t("methods")}
            </a>
          </nav>
          <div className="top-actions">
            <button
              className="button language"
              aria-label={t("language")}
              onClick={() => update({ lang: lang === "zh" ? "en" : "zh-CN" })}
            >
              {lang === "zh" ? "EN" : "中文"}
            </button>
            <button
              className="icon-button"
              aria-label={t(theme === "light" ? "dark" : "light")}
              onClick={() => setTheme(theme === "light" ? "dark" : "light")}
            >
              <Icon name={theme === "light" ? "moon" : "sun"} />
            </button>
          </div>
        </div>
      </header>
      {isNotes ? (
        <main className="shell notes surface">
          <h1>{t("footerTitle")}</h1>
          <p>{t("notesIntro")}</p>
          <p>{t("modelNotes")}</p>
          <p>{t("thresholdNotes")}</p>
          <p>{t("qualityNotes", { coverage: percent.format(0.8) })}</p>
          <h2>{t("providerNotes")}</h2>
          <ul>
            {ipSources.map((source) => (
              <li key={source.name}>
                <a href={source.url}>{source.name}</a>
              </li>
            ))}
          </ul>
          <p>{t("recentInfo")}</p>
          <p>{t("demoInfo")}</p>
        </main>
      ) : (
        <main className="shell">
          <section className="hero">
            <div className="hero-content">
              <div className="eyebrow">
                <Icon name="wind" />
                {t("subtitle")}
              </div>
              <h1>{t("heading", { city: city.name[lang] })}</h1>
              <p>{t("intro")}</p>
              <Search lang={lang} onSelect={selectCity} />
              <div className="popular" aria-label={t("cities")}>
                {popular.map((item) => (
                  <button
                    key={item.id}
                    aria-pressed={item.id === settings.cityId}
                    onClick={() => selectCity(item)}
                  >
                    {item.name[lang]}
                  </button>
                ))}
                <label className="city-picker">
                  <span className="sr-only">{t("allCities")}</span>
                  <select
                    value=""
                    onChange={(event) => {
                      const next = overview.find(
                        (item) => item.id === event.target.value,
                      );
                      if (next) selectCity(next);
                    }}
                  >
                    <option value="">{t("allCities")}</option>
                    {overview.map((item) => (
                      <option value={item.id} key={item.id}>
                        {item.name[lang]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
              <i />
              <i />
            </div>
          </section>
          <div className="workspace-heading">
            <div className="view-switch" aria-label={t("basis")}>
              <button
                aria-pressed={settings.view === "single"}
                onClick={() => update({ view: "single" })}
              >
                <Icon name="chart" />
                {t("single")}
              </button>
              <button
                aria-pressed={settings.view === "compare"}
                onClick={() => update({ view: "compare" })}
              >
                <Icon name="map" />
                {t("compare")}
              </button>
            </div>
            {settings.view === "single" && (
              <button
                className="button primary"
                disabled={!last || updating || !!activeProblem}
                onClick={() => exportChart("poster")}
              >
                <Icon name="download" />
                {t("poster")}
              </button>
            )}
          </div>
          <div className="notice" role="status">
            <Icon name="info" />
            <strong>
              {t(settings.pm.startsWith("mock") ? "demo" : "observed")}
            </strong>
            <span>
              {t(settings.pm.startsWith("mock") ? "demoInfo" : "recentInfo")}
            </span>
          </div>
          {route.invalid && (
            <p role="status" className="notice">
              {t("invalidLink")}
            </p>
          )}
          {settings.view === "compare" ? (
            <ComparisonTable data={comparison} lang={lang} />
          ) : (
            <div className="workspace">
              <aside className="surface filters">
                <h2>
                  <Icon name="sliders" />
                  {t("filters")}
                </h2>
                {bases.map((key) => {
                  const available = sources.filter((source) =>
                    source.metrics.includes(
                      key === "pm" ? "pm25" : "visibility_km",
                    ),
                  );
                  const source = available.find(
                    (source) => source.id === settings[key],
                  );
                  return (
                    <div className="filter-group" key={key}>
                      <h3>
                        <i className={"swatch " + key} />
                        {t(key)}
                      </h3>
                      <label>
                        {t("source")}
                        <select
                          aria-label={t("source")}
                          value={settings[key]}
                          onChange={(e) => update({ [key]: e.target.value })}
                        >
                          {!source && (
                            <option value={settings[key]}>{t("demo")}</option>
                          )}
                          {available.map((item) => (
                            <option value={item.id} key={item.id}>
                              {item.name[lang]}
                            </option>
                          ))}
                        </select>
                      </label>
                      <RuleEditor
                        rule={
                          key === "pm" ? settings.pmRule : settings.meteoRule
                        }
                        available={source?.metrics ?? []}
                        basis={key}
                        lang={lang}
                        onChange={(rule) =>
                          update(
                            key === "pm"
                              ? { pmRule: rule }
                              : { meteoRule: rule },
                          )
                        }
                      />
                    </div>
                  );
                })}
                <div className="filter-group">
                  <h3>{t("years")}</h3>
                  <div className="year-range">
                    <label>
                      {t("from")}
                      <select
                        value={settings.from}
                        onChange={(e) =>
                          update({ from: Number(e.target.value) })
                        }
                      >
                        {years
                          .filter((year) => year <= settings.to)
                          .map((year) => (
                            <option key={year}>{year}</option>
                          ))}
                      </select>
                    </label>
                    <label>
                      {t("to")}
                      <select
                        value={settings.to}
                        onChange={(e) => update({ to: Number(e.target.value) })}
                      >
                        {years
                          .filter((year) => year >= settings.from)
                          .map((year) => (
                            <option key={year}>{year}</option>
                          ))}
                      </select>
                    </label>
                  </div>
                </div>
                <a
                  className="methods-link"
                  href="/about"
                  onClick={(e) => {
                    e.preventDefault();
                    update({}, "/about");
                  }}
                >
                  <Icon name="book" />
                  {t("methods")}
                  <Icon name="arrow" />
                </a>
              </aside>
              <section className="results" aria-busy={updating}>
                {updating && (
                  <div className="updating" role="status">
                    <span />
                    {t("loading")}
                  </div>
                )}
                {activeProblem && (
                  <div className="notice problem" role="alert">
                    <span>{t(activeProblem.code)}</span>
                    <button
                      className="button"
                      onClick={() => setAttempt((value) => value + 1)}
                    >
                      {t("retry")}
                    </button>
                    {activeProblem.suggestProviderIds
                      ?.filter(
                        (id) => id !== settings.pm && id !== settings.meteo,
                      )
                      .map((id) => (
                        <button
                          className="button"
                          key={id}
                          onClick={() =>
                            update(
                              id.includes("meteo") ? { meteo: id } : { pm: id },
                            )
                          }
                        >
                          {t("switchSource")} ·{" "}
                          {sources.find((source) => source.id === id)?.name[
                            lang
                          ] ?? id}
                        </button>
                      ))}
                  </div>
                )}
                {!last && !activeProblem && (
                  <div className="skeleton surface" aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </div>
                )}
                {last && (
                  <div
                    className={
                      updating && last.settings.cityId !== settings.cityId
                        ? "old-results"
                        : ""
                    }
                  >
                    <div className="summary-grid">
                      {bases.map((key) => {
                        const stats = last.data.definitions[key].stats;
                        const complete = stats.yearly
                          .filter(
                            (row) =>
                              +row.period < currentYear &&
                              row.status !== "nodata",
                          )
                          .at(-1);
                        const current = stats.yearly.find(
                          (row) =>
                            +row.period === currentYear &&
                            row.status !== "nodata",
                        );
                        const row = complete ?? current;
                        const yoy = row && stats.extras?.yoy[row.period];
                        return (
                          <article className="surface summary" key={key}>
                            <h2>
                              <i className={"swatch " + key} />
                              {t(key)}
                            </h2>
                            <div className="value">
                              {row && row.status !== "nodata"
                                ? nf.format(row.hazeDays)
                                : "—"}{" "}
                              <small>{t("days")}</small>
                            </div>
                            <p>
                              {row
                                ? complete
                                  ? t("latest", { year: row.period })
                                  : t("partial") + " · " + row.period
                                : t("nodata")}
                            </p>
                            <div className="summary-note">
                              {row?.status === "ok"
                                ? t("coverage") +
                                  " " +
                                  percent.format(row.coverage)
                                : t(row?.status ?? "nodata")}
                              {yoy != null && (
                                <span>
                                  {t("yoy")} {yoy > 0 ? "+" : ""}
                                  {nf.format(yoy)}
                                </span>
                              )}
                            </div>
                          </article>
                        );
                      })}
                      <article className="surface summary">
                        <h2>
                          <Icon name="wind" />
                          {t("streak")}
                        </h2>
                        <div className="value">
                          {last.data.definitions[basis].stats.extras
                            ?.longestStreak?.days ?? "—"}{" "}
                          <small>{t("days")}</small>
                        </div>
                        <p>
                          {last.data.definitions[basis].stats.extras
                            ?.longestStreak
                            ? last.data.definitions[basis].stats.extras!
                                .longestStreak!.from +
                              " – " +
                              last.data.definitions[basis].stats.extras!
                                .longestStreak!.to
                            : t("noStreak")}
                        </p>
                        <div className="summary-note">{t(basis)}</div>
                      </article>
                    </div>
                    <Chart
                      kind="trend"
                      data={last.data}
                      basis={basis}
                      year={chartYear}
                      theme={theme}
                      onExport={() => exportChart("trend")}
                    />
                    <Chart
                      kind="monthly"
                      data={last.data}
                      basis={basis}
                      year={chartYear}
                      theme={theme}
                      onExport={() => exportChart("monthly")}
                      onBasis={setBasis}
                    />
                    <Chart
                      kind="calendar"
                      data={last.data}
                      basis={basis}
                      year={chartYear}
                      theme={theme}
                      onExport={() => exportChart("calendar")}
                      onBasis={setBasis}
                      yearPicker={yearPicker}
                    />
                  </div>
                )}
              </section>
            </div>
          )}
        </main>
      )}
      <footer className="shell site-footer">
        <span>
          <Icon name="wind" />
          {t("brand")}
        </span>
        <span>{t("footer")}</span>
      </footer>
      {exportTarget && (
        <ExportDialog
          target={exportTarget}
          theme={theme}
          lang={settings.lang}
          onClose={() => setExport(undefined)}
        />
      )}
    </>
  );
}
