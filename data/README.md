# data/

Committed files:

- `cities-cn.json` / `cities-overview.json` — the 40 preset cities used by search, the API, and history ingest.
- `recent/` — last CNEMC / CAMS / Open-Meteo snapshots for the “recent” providers. `npm run recent` also writes completed CNEMC city-days into `quotsoft-history.sqlite`, and merges finished CAMS / weather days so the rolling window does not drop older rows.
- `spike-samples/` — Phase 0 probe payloads cited by `docs/data-source-report.md`.

Generated locally (gitignored):

- `quotsoft-history.sqlite` — daily CNEMC archive used by **监测总站历史归档**. Rebuild with `npm run history`.
- `haze.sqlite` — HTTP series cache. Created on first `npm run dev`.
- `cn-air/` — optional sparse clone of [GewisLab/CN-AIR](https://atomgit.com/GewisLab/CN-AIR) so history ingest can skip most remote downloads.
- `archive/` — timestamped copies of each `npm run recent` payload.
