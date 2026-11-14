# 雾霾历史

本地运行的中英双语城市雾霾统计网站。默认 PM 源是 **监测总站全国城市小时归档**（[quotsoft](https://quotsoft.net/air/) 整理，[CN-AIR](https://atomgit.com/GewisLab/CN-AIR) 镜像）：全国城市自 2014-05-13，北京自 2013-12-06，到昨天。

页面并排比较 PM2.5 / AQI 口径与能见度 / 湿度口径，阈值可改。缺测保留 `null`，不补 0、不插值。默认展示北京，可搜索 40 个预置城市。

[English](README.md)

## 本地启动

1. 安装 [Node.js](https://nodejs.org/) 22.11 或更新的 LTS。
2. 在项目根目录执行 `npm ci`。
3. 执行 `npm run dev`，打开终端里 `Local:` 后的地址（一般为 [http://127.0.0.1:5173/](http://127.0.0.1:5173/)）。
4. 访问 `http://127.0.0.1:5173/api/health` 检查接口。SQLite 在首次启动时自动创建。

Windows 可运行 `start-local.cmd`。若 PowerShell 限制 `npm.ps1`，把命令改成 `npm.cmd`。默认不必复制 `.env`；需要改端口、缓存时长或覆盖率时再从 `.env.example` 复制。

历史图表依赖 `data/quotsoft-history.sqlite`。若本地没有该文件：

```bash
npm run history
```

有 `data/cn-air` 时会先吃本地 CSV，再从 quotsoft 补缺日。可选环境变量：`HISTORY_SKIP_REMOTE=1`、`HISTORY_CONCURRENCY=4`、`HISTORY_DELAY_MS=200`。

刷新近几小时实测 / 模型对照：`npm run recent`。

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
| 监测总站近几小时 | 近期实测 | 大约最近一天 |
| Open-Meteo CAMS | 仅模型对照 | 近几小时 |
| Open-Meteo 再分析 | 气象口径 | 湿度有部分近期值，能见度仍空 |

一天满 12 个 `Asia/Shanghai` 小时用算术日均，否则用当日最后一次 24 小时均值。源站本身没有的日期（如 2014-07-15–23、2015-01-01、2018-12-22–26、2019-08-24）保持无数据。2014-05-13 之前除北京外没有免费的全国城市序列。

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
