# 雾霾历史

本地运行的中英双语城市雾霾统计网站。默认 PM 源是 **监测总站全国城市小时归档**（[quotsoft](https://quotsoft.net/air/) 整理，[CN-AIR](https://atomgit.com/GewisLab/CN-AIR) 镜像）。全国城市归档从 2014-05-13 开始，北京另有 2013-12-06 起的档案。各城市的覆盖时间以本地入库结果为准。

页面并排比较 PM2.5 / AQI 口径与能见度 / 湿度口径，阈值可改。缺测保留 `null`，不补 0、不插值。默认展示西安，可搜索 40 个预置城市。

西安 2024 年 NOAA 机场观测可在气象数据源中选择。官方年度统计、历史库核验结果及后续采集建议见[西安数据核验](docs/xian-data-validation.md)。项目代码使用 [MIT 许可证](LICENSE)，第三方数据遵循各自条款。

[English](README.md)

## 本地启动

1. 安装 [Node.js](https://nodejs.org/) 22.11 或更新的 LTS。
2. 在项目根目录执行 `npm ci`。
3. 执行 `npm run dev`，打开终端里 `Local:` 后的地址（一般为 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)）。
4. 访问 `http://127.0.0.1:5173/api/health` 检查接口。SQLite 在首次启动时自动创建。

Windows 可运行 `start-local.cmd`。若 PowerShell 限制 `npm.ps1`，把命令改成 `npm.cmd`。默认不必复制 `.env`；需要改端口、缓存时长或覆盖率时再从 `.env.example` 复制。

历史图表依赖 `data/quotsoft-history.sqlite`。若本地没有该文件：

```bash
npm run history -- --national
```

有 `data/cn-air` 时会先吃本地 CSV，再从 quotsoft 补缺日。可选环境变量：`HISTORY_SKIP_REMOTE=1`、`HISTORY_CONCURRENCY=4`、`HISTORY_DELAY_MS=200`。

## 全国历史与后续更新

- `/api/history-coverage` 列出已入库的原始城市标识、首末日期和有效日数。图表支持 40 个已核对城市，其他城市原始列可通过 `/api/history-archive?cityId=CNEMC%3A珠海&from=2024-01-01&to=2024-12-31` 查询。历史名称按原字段保存，行政区沿革确认后再合并。
- 每日运行 `npm run data:update`（`npm run update` 相同）。它先重抓截至昨天的七天全国 CSV 写入历史库，再更新实测 / CAMS / 气象快照；`fetch-recent` 也会把尚未入库的完整城市日补进 `quotsoft-history.sqlite`，并把已结束的 CAMS、气象日值合并进 `data/recent/`，避免滚动窗口冲掉旧日。当天未结束的小时只留在「近期」源。网络错误会返回非零退出码。超过七天的空档可手动运行全国历史命令修复，其中已成功的旧日期会跳过。补 2013 年全国见 [docs/paid-sources.md](docs/paid-sources.md)。
- 如需按日期补全国数据，可运行 `npm run history -- --national --from=2026-04-24`。本机镜像中的全国列截至 2026-04-23；旧数据库里的部分预置城市更新到了更晚日期。
- Windows 任务计划程序可每天上午运行 `scripts/update-data.cmd`，并设置任务已运行时跳过新实例。日志写入 `data/update-logs`。任务需要电脑开机和联网。
- 近期快照写入后重启网站以载入。历史数据在现有缓存到期后可见，也可在本机 POST `/api/cache/invalidate` 清除旧缓存。启动后检查 `/api/history-status` 与 `/api/history-coverage`。
- 气象更新会把截至昨天的有效模式日值按城市和日期追加到本地档案，重叠日期用新的有效数据修订。
- 全国历史能见度仍待补齐。西安 NOAA 样本限已验证站点和年份。全国实测候选是[国家气象信息中心国际交换站定时观测](https://k.data.cma.cn/mekb/?dataCode=A.0012.0001.S011&r=data%2Fdetail)及 [NOAA GHCNh](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly)。取得数据后须逐站匹配并核验能见度质量码、有效小时和覆盖范围。近期模式数据继续独立标注来源。

## 目录

```
web/        Vite + React 前端
server/     Fastify 接口、数据源、入库脚本
shared/     类型、判定规则、文案
data/       城市清单与本地库（说明见 data/README.md）
docs/       数据源记录、许可、OpenAPI
scripts/    同时拉起 API 与 Vite 的开发入口
```

规划清单在 [docs/action-items.md](docs/action-items.md)。

## 数据

| 来源 | 用途 | 本仓库覆盖 |
| --- | --- | --- |
| 监测总站城市小时值（quotsoft / CN-AIR） | 默认历史 PM / AQI | 全国城市 2014-05-13 → 昨天；北京 2013-12-06 → 昨天 |
| 美国大使馆馆区 PM2.5 | 可选实测对照 | 北京、上海、广州、成都、沈阳 2013 起（`npm run data:embassy`）。2015 年底以前为 UCI，之后为 AirNow/EPA 快照（成都到 2020，其余到 2025-03） |
| 监测总站近几小时 | 近期实测 | 大约最近一天 |
| Open-Meteo CAMS | 仅模型对照 | 近几小时 |
| Open-Meteo 再分析 | 气象口径 | 湿度有部分近期值，能见度仍空 |

一天满 12 个 `Asia/Shanghai` 小时用算术日均，否则用当日最后一次 24 小时均值。源站本身没有的日期（如 2014-07-15–23、2015-01-01、2018-12-22–26、2019-08-24）保持无数据。2014-05-13 之前除北京外没有免费的全国城市序列。补 2013 年全国见 [docs/paid-sources.md](docs/paid-sources.md)。多城市视图目前是表格；中国地图缺带审图号的底图，见页内说明。

署名与转载见 [docs/licenses.md](docs/licenses.md)。早期 CAMS / NOAA / OpenAQ 探测见 [docs/data-source-report.md](docs/data-source-report.md)。

## 约定

日期按 Asia/Shanghai。完全缺测显示「无数据」，覆盖率低于 `MIN_COVERAGE`（默认 80%）显示「数据不足」。规定阈值可编辑，预设出处见 `shared/presets.ts`。站内「数据说明」页记录口径差异。

## 测试

```bash
npm run build
npm test
npx playwright install chromium
npm run test:e2e -- --repeat-each=3
```

可设置 `PLAYWRIGHT_CHANNEL=msedge` 使用已安装的 Edge。

## 代码许可

本仓库源码供本地研究使用。空气质量原始文件仍遵循监测总站 / quotsoft / CAMS 各自条款。
### 更新归档位置

全国空气质量增量写入 `data/quotsoft-history.sqlite`。近期实测、CAMS、气象和对比结果分别更新 `data/recent/` 的对应 JSON。自本次变更起，每次近期采集完成后会先在 `data/archive/` 写入带 UTC 时间戳的独立快照，再发布网站读取的文件。快照含实测、CAMS、截止昨天的气象日值和对比元信息。气象有效日同时累积在 `data/recent/meteo.json`。快照目录默认由 Git 忽略，需单独备份。

