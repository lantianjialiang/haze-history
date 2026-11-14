# Haze History

A bilingual, locally hosted dashboard for Chinese city haze-day counts. The default PM source is the **CNEMC national-network archive** (compiled by [quotsoft](https://quotsoft.net/air/) and mirrored in [CN-AIR](https://atomgit.com/GewisLab/CN-AIR)): every city from 13 May 2014, Beijing from 6 December 2013, through yesterday.

The UI sits PM2.5 / AQI rules next to a visibility / humidity definition. Thresholds are editable. Missing observations stay `null` — they are never filled with zero.

[中文说明](README.zh.md)

## Run locally

1. Install [Node.js](https://nodejs.org/) 22.11 or a newer LTS release.
2. From the project root: `npm ci`
3. `npm run dev` and open the URL after `Local:` (usually [http://127.0.0.1:5173/](http://127.0.0.1:5173/)).
4. `http://127.0.0.1:5173/api/health` checks the API. SQLite files are created on first start.

On Windows, `start-local.cmd` installs missing dependencies and starts both services. If PowerShell blocks `npm.ps1`, use `npm.cmd`. Copy `.env.example` to `.env` only when you need to change ports, cache TTL, or coverage.

Historical charts need `data/quotsoft-history.sqlite`. If that file is missing, run:

```bash
npm run history -- --national
```

That command ingests a local `data/cn-air` clone when present, then downloads remaining days from quotsoft. Optional env vars: `HISTORY_SKIP_REMOTE=1`, `HISTORY_CONCURRENCY=4`, `HISTORY_DELAY_MS=200`.

Daily refresh: `npm run data:update` (same as `npm run update`). It backfills the last seven national city files into the history database, then refreshes measured / CAMS / weather snapshots. `npm run recent` also archives any completed city-days that are not already in SQLite, and merges finished CAMS and weather days into `data/recent/` so the rolling window does not drop older rows. The current incomplete day stays on the “recent” sources only.

## Layout

```
web/        Vite + React UI
server/     Fastify API, providers, ingest scripts
shared/     types, haze-day rules, i18n strings
data/       city lists and local databases  (see data/README.md)
docs/       source notes, licenses, OpenAPI
scripts/    combined API + Vite dev process
```

## Data

| Source | Role | Coverage in this repo |
| --- | --- | --- |
| CNEMC hourly city files via quotsoft / CN-AIR | Default PM / AQI history | National archive starts 2014-05-13; separate Beijing data starts 2013-12-06. Check /api/history-coverage for actual coverage. |
| US Embassy PM2.5 | Optional measured comparison | Beijing, Shanghai, Guangzhou, Chengdu, Shenyang from 2013 (`npm run data:embassy`). UCI to 2015; AirNow/EPA snapshot 2016–2025 (Chengdu ends 2020). |
| CNEMC live hours | Recent measured snapshot | About the last day |
| Open-Meteo CAMS | Model comparison only | Recent hours |
| Open-Meteo archive | Weather definition | Humidity exists for some recent days; visibility is still empty |

A day uses the hourly mean when at least 12 local hours exist (`Asia/Shanghai`); otherwise the last published 24-hour mean. Archive holes that quotsoft itself does not host (for example 2014-07-15–23, 2015-01-01, 2018-12-22–26, 2019-08-24) stay missing. National cities before 13 May 2014 are not available for free except Beijing. Paid options for 2013 are listed in [docs/paid-sources.md](docs/paid-sources.md). City comparison is a table; a China map is blocked until a basemap with an official review number is available.

Attribution and reuse notes: [docs/licenses.md](docs/licenses.md). Earlier CAMS / NOAA / OpenAQ probes: [docs/data-source-report.md](docs/data-source-report.md).

## Tests

```bash
npm run build          # strict TypeScript + Vite build
npm test               # Vitest (rules, geocode, API, CSV parsers)
npx playwright install chromium
npm run test:e2e -- --repeat-each=3
```

Set `PLAYWRIGHT_CHANNEL=msedge` to use an installed Edge browser.

## License of the code

Project source is for local research use. Upstream air-quality files remain under their original CNEMC / quotsoft / CAMS terms.
