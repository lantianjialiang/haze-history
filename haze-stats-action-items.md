# 城市雾霾天数统计网站 · Action Items（Agent 执行版 v3）

> 本文档面向执行 Agent。每个任务都包含：**依赖 / 输入 / 输出 / 验收标准**。
> Agent 领取任务前先读完「第 1–3 节」，所有代码必须遵守第 3 节的数据契约。
> 带 ⚠️ 的内容是「预期」，**必须实测后再确认**，不得当作事实写入代码或文档。

---

## 1. 已确认决策

| 项 | 结论 |
|---|---|
| 范围 | 仅中国大中城市（约 40 个，见 1.1），架构保留扩展到全国/全球的余地 |
| 时间跨度 | 2013-01-01 至今；没有数据的年份/日期显示"无数据"，**不补 0、不插值** |
| 判定口径 | PM2.5/AQI 口径 与 气象口径（能见度+湿度）**同时展示**，可并排对比 |
| 阈值 | 全部预设可修改；气象口径默认「能见度 < 10 km 且 相对湿度 < 90%」，用户可自改 |
| 统计地图 | 两种视图 Tab 一键切换：**A 单城市**（日历热力图 + 月度热力图）/ **B 多城市对比**（中国地图） |
| 部署 | 本地部署；仅用免费数据源，效果验证后再考虑付费 Key |
| 语言 | 中英双语（界面、图表、导出图均跟随当前语言） |
| 技术栈 | 前端 Vite + React + TypeScript；后端 Node.js（Fastify）；SQLite 缓存；ECharts（图表+地图）；i18next；Vitest；Playwright |

### 1.1 地图 B 预置城市清单（初版，Agent 可在 A0.5 后微调）

- **直辖市（4）**：北京、上海、天津、重庆
- **省会/首府（27）**：石家庄、太原、呼和浩特、沈阳、长春、哈尔滨、南京、杭州、合肥、福州、南昌、济南、郑州、武汉、长沙、广州、南宁、海口、成都、贵阳、昆明、拉萨、西安、兰州、西宁、银川、乌鲁木齐
- **其他大城市（约 9）**：深圳、青岛、大连、宁波、厦门、苏州、无锡、唐山、东莞

---

## 2. 项目结构与全局约定

```
haze-stats/
├─ web/                 # Vite + React + TS 前端
├─ server/              # Node.js (Fastify) 后端
├─ shared/              # 前后端共用：类型、规则引擎、i18n key、常量
├─ data/                # 静态数据：城市列表、GeoJSON、SQLite 文件(gitignore)
├─ docs/                # 数据源评估报告、设计说明
├─ .env.example
└─ README.md / README.zh.md
```

全局约定：

1. 语言：TypeScript strict 模式；包管理 pnpm（或 npm workspaces，二选一并写入 README）。
2. 日期一律使用 `YYYY-MM-DD`，时区按**城市本地时间（Asia/Shanghai）**聚合，不得混用 UTC。
3. 单位统一：PM2.5/PM10 `μg/m³`；能见度 `km`；相对湿度 `%`（0–100）。Provider 内部负责换算。
4. 缺测一律用 `null`，**禁止用 0 或 -999 等魔数**。
5. 规则引擎放 `shared/`，前后端共用同一份实现。
6. 所有用户可见文案走 i18n key，禁止硬编码中文或英文。
7. 外部请求必须有超时（默认 15s）、重试（指数退避，最多 3 次）、限流（每源可配置）。
8. 提交规范：每个任务一个 PR/分支，附带自测说明。

---

## 3. 核心数据契约（所有任务共同遵守）

### 3.1 指标与数据源元信息

```ts
type Metric = 'pm25' | 'pm10' | 'aqi' | 'visibility_km' | 'rh';
type SourceType = 'measured' | 'model';          // 实测 | 模型/再分析

interface ProviderMeta {
  id: string;                    // 如 'open-meteo-aq' | 'openaq' | 'noaa-isd'
  name: { zh: string; en: string };
  sourceType: SourceType;
  metrics: Metric[];             // 该源能提供的指标
  coverage: { from: string; to: string | 'now' };   // 理论覆盖区间
  requiresKey: boolean;
  license: string;               // 许可简述 + 链接
  notes?: { zh: string; en: string };
}
```

### 3.2 日级数据

```ts
interface DailyRecord {
  date: string;                  // YYYY-MM-DD
  pm25: number | null;
  pm10?: number | null;
  aqi: number | null;
  visibility_km: number | null;
  rh: number | null;
  validHours?: number;           // 由小时数据聚合时，当日有效小时数
}

interface SeriesResponse {
  city: CityRef;
  providerId: string;
  sourceType: SourceType;
  metricsReturned: Metric[];
  records: DailyRecord[];        // 按日期升序，区间内无数据的日期也要出现（值为 null）
  meta: {
    fetchedAt: string;           // ISO 时间
    cacheHit: boolean;
    stationInfo?: { id: string; name: string; distanceKm: number };  // 实测站点信息
    missingRateByYear: Record<string, number>;   // 0–1
  };
}

interface CityRef {
  id: string;                    // 稳定 ID，如 'CN-110100'
  name: { zh: string; en: string };
  province: { zh: string; en: string };
  lat: number;
  lon: number;
  adcode?: string;               // 行政区划代码
}
```

### 3.3 规则配置与判定结果

```ts
type Op = '>' | '>=' | '<' | '<=';

interface Condition { metric: Metric; op: Op; value: number; }

interface RuleConfig {
  id: string;                    // 预设用固定 id；自定义用 'custom'
  name: { zh: string; en: string };
  combine: 'AND' | 'OR';
  conditions: Condition[];       // 至少 1 条
  basis: 'pm' | 'meteo';         // 归属哪个口径（用于双口径对比展示）
  reference?: string;            // 出处说明
}

type DayStatus = 'haze' | 'clear' | 'nodata';
```

**缺测判定规则（必须严格实现）：**

- `AND`：任一条件为 `false` → `clear`；否则任一条件指标缺测 → `nodata`；全部为 `true` → `haze`。
- `OR`：任一条件为 `true` → `haze`；否则任一条件指标缺测 → `nodata`；全部为 `false` → `clear`。

### 3.4 聚合统计

```ts
interface PeriodStat {
  period: string;                // '2019' 或 '2019-03'
  hazeDays: number;
  clearDays: number;
  validDays: number;             // hazeDays + clearDays
  totalDays: number;             // 该期间自然日数（当年未结束则到今天为止）
  coverage: number;              // validDays / totalDays
  status: 'ok' | 'insufficient' | 'nodata';
  // coverage == 0 → nodata；0 < coverage < 0.8 → insufficient；否则 ok（0.8 可配置）
}

interface StatsResponse {
  city: CityRef;
  rule: RuleConfig;
  providerId: string;
  yearly: PeriodStat[];
  monthly: PeriodStat[];
  extras?: {
    longestStreak: { days: number; from: string; to: string } | null;
    yoy: Record<string, number | null>;     // 同比变化
    severity?: Record<string, number>;       // 严重程度分级天数
  };
}
```

### 3.5 API 契约

| 接口 | 方法 | 入参 | 出参 |
|---|---|---|---|
| `/api/geocode` | GET | `q`（中/英/拼音，必填）、`limit`（默认 8） | `CityRef[]` |
| `/api/sources` | GET | `metric?` | `ProviderMeta[]` |
| `/api/series` | GET | `cityId`、`providerId`、`from`、`to`、`metrics`（逗号分隔） | `SeriesResponse` |
| `/api/stats` | POST | `{ cityId, providerId(按口径分别指定), from, to, rule: RuleConfig }` | `StatsResponse` |
| `/api/map/overview` | GET | `year`、`ruleId`、`providerId` | `{ updatedAt, items: { cityId, hazeDays, status }[] }` |
| `/api/prefetch` | POST | `{ cityIds?, from, to }` | `{ jobId }`；`GET /api/prefetch/:jobId` 返回进度 |

统一错误体：

```ts
interface ApiError {
  code: 'GEOCODE_NOT_FOUND' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_RATE_LIMITED'
      | 'NO_DATA' | 'INVALID_RULE' | 'INVALID_PARAMS' | 'INTERNAL';
  message: { zh: string; en: string };
  suggestProviderIds?: string[];   // 源失败时建议切换的备选源
}
```

---

## 4. Phase 0：数据源 Spike（最高优先级，结论决定后续范围）

> Agent 角色：**Research**。产出物放 `docs/`，脚本放 `server/scripts/spike/`。

### A0.1 数据源实测
- **依赖**：无
- **输入**：
  - 候选源 ⚠️：Open-Meteo Geocoding / Open-Meteo Air Quality（CAMS）/ OpenAQ（免费 Key）/ NOAA ISD 或 GHCN-hourly / 美国驻华使领馆历史 PM2.5（北京、上海、广州、成都、沈阳）/ Meteostat
  - 测试城市：北京、上海、成都、石家庄、广州、乌鲁木齐
  - 测试区间：2013-01-01 至今；指标：PM2.5、能见度、相对湿度
- **输出**：
  - `docs/data-source-report.md`：每个源 × 每个城市 × 每年的覆盖率表（缺测率）、延迟、限流、Key 要求、许可
  - `server/scripts/spike/*.ts`：可重复运行的探测脚本
  - 原始样本：`data/spike-samples/{source}_{city}.json`（每个文件 ≤ 200 KB）
- **验收**：报告含「覆盖年份 × 城市」矩阵；所有数字来自脚本实测，不是推测。

### A0.2 实测与模型偏差对比
- **依赖**：A0.1
- **输入**：A0.1 的样本数据；有美领馆实测的城市作为基准
- **输出**：`docs/data-source-report.md` 追加章节：相关系数、平均偏差、对「PM2.5 > 75/35 天数」的影响；推荐默认 PM2.5 源与能见度源
- **验收**：给出「默认源 + 备选源」结论表，并写明每个源的适用与不适用场景。

### A0.3 NOAA ISD 站点匹配与聚合策略
- **依赖**：A0.1
- **输入**：6 个测试城市坐标；ISD 站点列表
- **输出**：
  - 站点匹配算法说明（距离阈值、多站点择优规则、站点名单）
  - 能见度单位/缺测编码处理说明（如 ISD 的 999999 等编码，⚠️ 需核实）
  - **小时 → 日聚合规则**：日均 vs 日间均值 vs 其他、每日最少有效小时数（⚠️ 建议值 ≥ 18 小时，需核实）
  - `docs/meteo-aggregation.md`
- **验收**：对 6 个城市输出「匹配站点 + 距离 + 各年有效天数」。

### A0.4 许可与地图合规
- **依赖**：A0.1
- **输入**：各数据源服务条款；候选中国地图 GeoJSON
- **输出**：
  - `docs/licenses.md`：各源是否允许公开展示、导出图片、缓存；要求的署名文字
  - `data/geo/china.json`：合规 GeoJSON（含南海诸岛、台湾，边界正确）及来源与许可说明
- **验收**：每个源有明确结论（允许/限制/不允许）；地图来源可追溯。

### A0.5 地图 B 批量预取可行性
- **依赖**：A0.1、A0.2
- **输入**：1.1 城市清单；选定的默认源
- **输出**：
  - 全量预取实测耗时与失败率
  - 最终城市清单 `data/cities-overview.json`（`CityRef[]`）
  - 预取策略（并发数、限流、增量更新频率）
- **验收**：给出「首次全量需 X 分钟，日常增量 Y 分钟」的实测数字。

### A0.6 阶段评审（人工）
- **输出**：`docs/mvp-data-decision.md`，明确 MVP 采用的数据源组合、不可用的指标/年份、需调整的范围
- **验收**：**由项目负责人确认后才开始 Phase 1 的 Provider 实现。**

---

## 5. Phase 1：后端与数据层

> Agent 角色：**Backend**

### A1.1 项目初始化
- **依赖**：无（可与 Phase 0 并行）
- **输入**：第 2 节目录结构与约定
- **输出**：monorepo（web / server / shared）、TypeScript strict、ESLint、Prettier、Vitest、npm scripts（`dev` 同时启动前后端）、`.env.example`
- **验收**：`pnpm install && pnpm dev` 后前端能访问、后端 `/api/health` 返回 200；`pnpm test` 可运行。

### A1.2 GeocodingService
- **依赖**：A1.1
- **输入**：查询字符串 `q`（中文、英文、拼音）；内置城市静态表 `data/cities-cn.json`
- **输出**：
  - `data/cities-cn.json`：中国地级及以上城市（`CityRef[]`，含拼音、英文名、adcode、坐标）
  - `GET /api/geocode`：返回 `CityRef[]`，同名城市靠省份消歧
- **验收**：
  - 「北京 / beijing / bj」「朝阳」能返回合理候选；
  - 静态表优先、外部服务仅兜底，断网仍可搜索；
  - 单测 ≥ 15 个用例（含同名、拼音、错别字、空输入）。

### A1.3 DataProvider 接口
- **依赖**：A1.1，第 3 节契约
- **输入**：第 3.1、3.2 节类型
- **输出**：
  ```ts
  interface DataProvider {
    meta: ProviderMeta;
    getDailySeries(city: CityRef, from: string, to: string, metrics: Metric[]): Promise<SeriesResponse>;
  }
  ```
  以及 Provider 注册表 `ProviderRegistry`、`MockProvider`（用于前端并行开发和测试）
- **验收**：新增 Provider 只需实现接口并注册，无需改动其他代码；`MockProvider` 可生成可复现的固定数据。

### A1.4 Provider 实现
- **依赖**：A0.6、A1.3
- **输入**：`docs/mvp-data-decision.md` 选定的源
- **输出**：
  - PM2.5 Provider ≥ 2 个
  - 能见度/湿度 Provider ≥ 1 个（⚠️ 预期为 NOAA ISD）
  - 每个 Provider 含：重试、限流、超时、错误映射到 `ApiError`、单位换算、缺测置 `null`、`stationInfo` 填充
- **验收**：
  - 用录制的 fixture 做单测（不依赖网络）；
  - 手动用 6 个测试城市跑通，结果与 A0 样本一致；
  - 某源故障时，`ApiError.suggestProviderIds` 返回备选源。

### A1.5 SQLite 缓存
- **依赖**：A1.3
- **输入**：`SeriesResponse`；缓存键 `cityId + providerId + year`
- **输出**：
  - 表结构与迁移脚本；
  - 读写封装：历史年份永久缓存，当年数据 TTL 可配（默认 12 小时）；
  - `POST /api/cache/invalidate`（本地调试用）
- **验收**：同一请求第二次 `meta.cacheHit = true` 且不触发外部请求（单测断言）。

### A1.6 批量预取任务
- **依赖**：A1.4、A1.5、A0.5
- **输入**：`data/cities-overview.json`；区间；并发/限流配置
- **输出**：
  - `POST /api/prefetch` 与 `GET /api/prefetch/:jobId`（进度：总数/完成/失败列表）
  - CLI：`pnpm prefetch --from 2013-01-01`
  - 断点续传（已缓存的年份跳过）
- **验收**：中断后重启不重复拉取；失败城市可单独重试。

### A1.7 REST 接口
- **依赖**：A1.2、A1.4、A1.5、A2.1–A2.4
- **输入**：第 3.5 节 API 契约
- **输出**：`/api/geocode`、`/api/sources`、`/api/series`、`/api/stats`、`/api/map/overview` 全部实现；入参用 JSON Schema/zod 校验；OpenAPI 文档 `docs/openapi.yaml`
- **验收**：契约测试覆盖正常、参数错误、无数据、源失败 4 类响应。

---

## 6. Phase 2：雾霾判定引擎（`shared/`）

> Agent 角色：**Backend（算法）**。纯函数，无 I/O。

### A2.1 判定函数
- **依赖**：A1.1，第 3.3 节
- **输入**：`DailyRecord[]`、`RuleConfig`
- **输出**：`classifyDays(records, rule): { date: string; status: DayStatus }[]`，严格按 3.3 节缺测规则
- **验收**：单测覆盖 AND/OR × 缺测组合的全部真值表。

### A2.2 内置预设
- **依赖**：A2.1，A0.3（气象口径出处）
- **输入**：下表（⚠️ 阈值出处由 Agent 核实并写入 `reference`）

| id | 口径 | 条件 |
|---|---|---|
| `cn-pm25-75` | pm | pm25 > 75 |
| `us-pm25-35` | pm | pm25 > 35 |
| `who-pm25-15` | pm | pm25 > 15（WHO 2021 日均指南值） |
| `aqi-100` / `aqi-150` / `aqi-200` | pm | aqi > 100 / 150 / 200 |
| `meteo-default` | meteo | visibility_km < 10 AND rh < 90 |

- **输出**：`shared/presets.ts`，每个预设含中英文名称和 `reference`
- **验收**：每个预设有单测；文档说明各预设与官方"霾"定义的差异。

### A2.3 自定义规则与校验
- **依赖**：A2.1
- **输入**：用户配置的 `RuleConfig`
- **输出**：
  - JSON Schema 与 `validateRule()`（指标合法、数值范围合法、条件数 1–5）
  - `serializeRule()/parseRule()`：用于 URL 参数与 localStorage
- **验收**：非法输入返回结构化错误（含 i18n key）；序列化往返一致。

### A2.4 聚合
- **依赖**：A2.1
- **输入**：判定结果；`minCoverage`（默认 0.8）
- **输出**：`aggregate(statuses, 'year'|'month', minCoverage): PeriodStat[]`
- **验收**：
  - 完全无数据 → `nodata`；0 < 覆盖 < 阈值 → `insufficient`；
  - 当年未结束时 `totalDays` 截止到今天；
  - 闰年、跨年边界单测。

### A2.5 扩展统计
- **依赖**：A2.4
- **输入**：判定结果、`DailyRecord[]`
- **输出**：最长连续雾霾天数、同比（任一年为 `nodata` 则同比为 `null`）、严重程度分级（⚠️ 基于 PM2.5 / 能见度的分级阈值由 Agent 核实后给出）
- **验收**：固定样本单测。

### A2.6 双口径对比
- **依赖**：A2.4
- **输入**：同一城市的 `pm` 口径与 `meteo` 口径 `StatsResponse`
- **输出**：
  ```ts
  compareBases(pm: StatsResponse, meteo: StatsResponse): {
    year: string; pmDays: number|null; meteoDays: number|null;
    bothDays: number; onlyPmDays: number; onlyMeteoDays: number;
  }[]
  ```
- **验收**：`bothDays + onlyPmDays = pmDays`（有效日交集内）等一致性单测。

---

## 7. Phase 3：前端核心

> Agent 角色：**Frontend**。后端未就绪时使用 `MockProvider` + MSW 模拟 API。

### A3.1 设计系统
- **依赖**：A1.1
- **输入**：产品调性：简洁、数据可视化为主、中英文排版均美观
- **输出**：
  - 设计 token（颜色、字号、间距、圆角、阴影）；
  - 雾霾强度色阶（含"无数据"专用灰色斑纹样式，需色盲友好）；
  - 深/浅主题；响应式断点（≥1200 / 768–1199 / <768）；
  - `docs/design-system.md` + Storybook 或展示页
- **验收**：浅/深主题各截图一套（桌面+手机）；文字对比度 ≥ WCAG AA。

### A3.2 首页
- **依赖**：A3.1、A1.2（或 Mock）
- **输入**：`GET /api/geocode`
- **输出**：搜索框（防抖、键盘上下选择、同名城市显示省份）、热门城市入口（来自 1.1 清单）、语言切换、主题切换
- **验收**：输入 → 选择 → 跳转到 `/city/:cityId`；无结果显示空态。

### A3.3 结果页布局
- **依赖**：A3.1、A1.7（或 Mock）
- **输入**：`StatsResponse`（可同时有 pm 与 meteo 两份）
- **输出**：
  - 概览卡片（最近完整年度天数、同比、最长连续、数据源标签）
  - 年度图（柱状/折线，**双口径可叠加或并排**）
  - 月度热力图（年 × 月）
  - 日历热力图（可选年份）
  - 每个图表右上角有「导出」入口（对接 A4.2）
- **验收**：`nodata` / `insufficient` 年份在图中有明确视觉区分与 tooltip 说明，不显示为 0。

### A3.4 控制面板
- **依赖**：A3.3、A2.3
- **输入**：`/api/sources`、预设列表
- **输出**：
  - PM2.5 源选择、能见度源选择（分别独立）
  - 标准选择（预设下拉 + 自定义规则编辑器：指标/比较符/阈值/AND-OR）
  - 年份范围选择（2013 起）
  - 变更后触发重算；有 loading 骨架屏；切换时保留上一次结果避免闪烁
- **验收**：切换任意控件 ≤ 300ms 内有视觉反馈；自定义规则非法时就地提示。

### A3.5 数据质量提示
- **依赖**：A3.3
- **输入**：`ProviderMeta`、`SeriesResponse.meta`
- **输出**：来源徽标（实测/模型）、站点信息（含距离）、缺测率提示、口径说明浮层、"无数据"含义说明
- **验收**：每张图表可看到当前使用的源、口径、数据更新时间。

### A3.6 国际化
- **依赖**：A3.1
- **输入**：`shared/` 中的 i18n key 约定
- **输出**：i18next 配置、`zh-CN.json`、`en.json`；日期/数字格式本地化；图表标题、轴、tooltip、导出图全部走 i18n；语言写入 URL（`?lang=`）和 localStorage
- **验收**：脚本检测两个语言包 key 一致；切换语言页面无残留中/英文硬编码。

### A3.7 URL 状态同步
- **依赖**：A3.4
- **输入**：当前城市、源、规则、年份范围、地图 Tab、语言
- **输出**：状态 ⇄ URL query 双向同步；复制链接打开后状态完全一致
- **验收**：刷新、前进/后退均正确；非法参数回退默认值并提示。

### A3.8 空态/错误态/无障碍
- **依赖**：A3.3
- **输入**：`ApiError` 各 code
- **输出**：各错误码对应 UI（含「切换到备选源」一键按钮）、骨架屏、键盘可操作（Tab 顺序、ESC 关闭浮层）、图表提供数据表替代视图
- **验收**：Lighthouse 无障碍 ≥ 90；仅用键盘可完成「搜索 → 切源 → 导出」。

---

## 8. Phase 4：地图与导出

### A4.1 地图 Tab（A/B 双视图）
- **依赖**：A3.3、A0.4（GeoJSON）、A1.6 + `/api/map/overview`（B 视图）
- **输入**：
  - 视图 A：`StatsResponse`（单城市）
  - 视图 B：`/api/map/overview` 的 `items`，`data/geo/china.json`
- **输出**：
  - Tab 组件，切换保留城市/规则/年份状态；
  - 视图 A：日历热力图 + 月度热力图（可复用 A3.3 组件）；
  - 视图 B：中国地图，城市标记按雾霾天数着色/大小映射，支持年份滑块、点击城市跳转详情、显示"数据更新时间"；`nodata` 城市灰色标记；
  - 地图合规：南海诸岛、台湾、边界使用 A0.4 确认的数据
- **验收**：视图切换无整页刷新；B 视图 40 个城市渲染流畅（交互 ≥ 30fps）。

### A4.2 导出引擎
- **依赖**：A3.3、A4.1
- **输入**：目标对象（单个图表 / 地图 / 整页海报）、导出选项
- **输出**：
  - `exportImage(target, options): Promise<Blob>`，PNG 必做，SVG 可选；
  - 整页「报告海报」模板（标题、关键数字、年度图、热力图、地图、来源与声明）
- **验收**：导出结果与屏幕所见一致；大图（4K）不崩溃；失败有可读错误提示。

### A4.3 导出选项面板
- **依赖**：A4.2
- **输入**：用户选择
- **输出**：
  ```ts
  interface ExportOptions {
    format: 'png' | 'svg';
    preset: 'social-square' | 'social-wide' | 'a4-portrait' | '4k';
    scale: 1 | 2 | 3;
    theme: 'light' | 'dark';
    includeWatermark: boolean;
    lang: 'zh-CN' | 'en';
  }
  ```
  含预览、下载按钮、文件名规则 `haze_{city}_{from}-{to}_{rule}_{yyyymmdd}.png`
- **验收**：改选项实时预览；各预设尺寸正确。

### A4.4 导出图必含信息
- **依赖**：A4.2
- **输入**：当前城市、年份范围、数据源及类型、判定标准（含阈值）、生成日期
- **输出**：导出图页脚/角标自动带上以上信息，并跟随导出语言；`nodata` 图例同步出现
- **验收**：中文字体正确嵌入、无乱码、无裁切；信息缺一项即测试失败（自动化断言）。

---

## 9. Phase 5：质量与交付

> Agent 角色：**QA / DevOps**

### A5.1 E2E 测试
- **依赖**：P0 全部完成
- **输入**：运行中的本地环境（使用录制 fixture，不依赖真实外网）
- **输出**：Playwright 用例：搜索 → 切源 → 改标准 → 切地图 Tab → 导出；中英文各一遍；失败截图归档
- **验收**：CI 中稳定通过（连续 3 次无 flaky）。

### A5.2 数据抽检
- **依赖**：A1.4、A2.x
- **输入**：3 个城市（建议北京、石家庄、成都）、生态环境部《中国生态环境状况公报》等公开年报
- **输出**：`docs/data-validation.md`：与官方"优良天数/重污染天数"等指标的对照表、差异原因
- **验收**：差异均有解释；无法解释的差异列为已知问题。

### A5.3 本地部署交付
- **依赖**：P0 完成
- **输入**：全部代码
- **输出**：`.env.example`（各 Key 说明）、`docker-compose.yml` 或一键脚本（二选一，README 说明）、`README.md` + `README.zh.md`（安装、启动、预取、常见问题）
- **验收**：全新机器按 README 5 步内跑起来；首次启动 SQLite 自动初始化。

### A5.4 数据源与免责声明页
- **依赖**：A0.4、A3.6
- **输入**：`docs/licenses.md`、`docs/data-source-report.md`
- **输出**：站内「数据说明」页（中英）：实测 vs 模型差异、口径差异、"无数据"含义、各源署名与链接
- **验收**：页面内容与 A0 报告一致；导出图水印文字与此页署名一致。

---

## 10. 优先级与执行顺序

| 级别 | 任务 |
|---|---|
| **P0（MVP）** | A0.1–A0.6、A1.1–A1.5、A1.7、A2.1–A2.4、A3.1–A3.6、A4.1（视图 A）、A4.2–A4.4、A5.3 |
| **P1** | 地图 B（A1.6 + A4.1 视图 B + A0.5）、A2.5–A2.6、A3.7–A3.8、A5.1、A5.2、A5.4 |
| **P2** | PDF 导出、收藏/账号、扩展到全国所有城市/全球、付费 Key 数据源 |

**推荐执行顺序：**

1. **第 1 步（并行）**：Phase 0（Research） ‖ A1.1、A1.3（含 MockProvider）、A2.1–A2.4（Backend）‖ A3.1（Frontend 设计系统）
2. **关卡**：A0.6 人工确认数据组合
3. **第 2 步（并行）**：A1.2、A1.4、A1.5、A1.7 ‖ A3.2–A3.6（使用 Mock）
4. **第 3 步**：A4.1–A4.4 → A5.3（到此 MVP 可用）
5. **第 4 步**：P1 全部

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| 免费源无 2013 年起的中国实测 PM2.5 | 早期年份大量"无数据" | 按决策显示"无数据"；UI 明确标注；P2 评估付费源 |
| 模型数据与实测偏差大 | 天数不准 | 强制标注"模型"；A0.2 给偏差说明；允许切换源 |
| NOAA 站点距离城市市区较远 | 能见度代表性不足 | A0.3 设距离阈值，超阈值标记 `insufficient`，并展示站点距离 |
| 免费源限流 | 地图 B 拉取慢/失败 | 预取 + SQLite 永久缓存，增量更新；展示更新时间 |
| 地图合规 | 法律/发布风险 | A0.4 确认来源；仅使用含完整边界的数据；不自行绘制边界 |
| 中文导出字体缺失 | 导出图乱码 | 导出时内嵌字体（A4.4 验收项） |

---

## 12. 已确认的默认值汇总（供 Agent 引用）

- 范围：中国大中城市（约 40 个，见 1.1）
- 起始日期：2013-01-01；无数据显示"无数据"
- 气象口径默认：能见度 < 10 km 且相对湿度 < 90%，用户可修改
- 缺测阈值：年度有效覆盖 < 80% 标记为"数据不足"（可配置）
- 地图 B 城市范围：大中城市；全部地级市不在本期范围
- 部署：本地；免费源优先；需要 Key 的服务走 `.env`
- 语言：中文 + 英文
