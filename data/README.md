# data/

## In git

- `cities-cn.json` / `cities-overview.json` — preset cities for search, API, and history ingest.
- `recent/` — rolling CNEMC / CAMS / Open-Meteo snapshots for “recent” providers.
- `reference/` — small reference CSV/JSON (e.g. Xi’an official annual stats, AQICN import, NOAA ISD samples).
- `spike-samples/` — Phase 0 probe payloads cited by `docs/data-source-report.md`.

## Local only (gitignored)

Large SQLite files are **not** in the repository. Build them on your machine after `npm ci`.

| File | Role | How to create |
|------|------|----------------|
| `quotsoft-history.sqlite` | CNEMC daily archive (**监测总站历史归档**) | See [docs/data-local.md](../docs/data-local.md) |
| `embassy-history.sqlite` | US Embassy PM2.5 (5 cities) | `npm run data:embassy` |
| `haze.sqlite` | HTTP series cache | Created on first `npm run dev` |

Also gitignored:

- `*.sqlite-wal` / `*.sqlite-shm` — SQLite WAL sidecars.
- `cn-air/` — CN-AIR sparse clone: `npm run data:cn-air` ([docs/cn-air-clone.md](../docs/cn-air-clone.md)).
- `embassy/` — raw embassy CSV cache from `npm run data:embassy`.
- `archive/` — timestamped copies from each `npm run recent` run.

Without `quotsoft-history.sqlite`, historical charts and `npm run build:static` have no archive data until you run the ingest steps in `docs/data-local.md`.