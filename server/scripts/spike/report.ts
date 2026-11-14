import { readdir, readFile, writeFile } from "node:fs/promises";
import overview from "../../../data/cities-overview.json";
import { yearsBetween, today } from "../../../shared/dates.ts";
import type { CityRef } from "../../../shared/types.ts";

type Metrics = Record<string, number | null>;
type Sample = {
  city: string;
  source: string;
  station?: { id: string; distanceKm: number };
  annual: Record<
    string,
    { total: number; status: string; valid: Metrics; paired?: Metrics }
  >;
  requests: { status: string; ms: number; year: string }[];
};
const folder = "data/spike-samples/";
const names = await readdir(folder);
const years = yearsBetween("2013-01-01", today());
const selected = [
  "110100",
  "310100",
  "510100",
  "130100",
  "440100",
  "650100",
].map((code) => overview.find((city) => city.adcode === code)!);
async function samples(source: string) {
  const result: [CityRef, Sample][] = [];
  for (const city of selected) {
    const file = source + "_" + city.id + ".json";
    if (names.includes(file))
      result.push([
        city,
        JSON.parse(await readFile(folder + file, "utf8")) as Sample,
      ]);
  }
  return result;
}
function table(head: string[], rows: (string | number)[][]) {
  return [head, head.map(() => "---"), ...rows]
    .map((row) => "| " + row.join(" | ") + " |")
    .join("\n");
}
const output = [
  "# 数据源实测报告",
  "探测范围为 2013-01-01 至 " +
    today() +
    "，六城及逐年数据见下表。原始响应片段、各请求耗时及日级 PM2.5 样本见 data/spike-samples。每个样本 ≤ 200 KB。运行 npm run spike 后用 node_modules/.bin/tsx server/scripts/spike/report.ts 重新生成报告。每个源的 HTTP 超时为 15 秒，最多重试三次。",
  "百分比为缺测率，小数保留一位。— 表示请求未成功、未采集或超出文档范围。404 指探测路径没有该年档案。该结果只适用于对应端点与候选站点。日有效门槛为每指标至少 18 个可用本地小时。2026 年分母截止到探测日。",
  table(
    ["来源", "免费 Key", "限制与许可"],
    [
      ["Open-Meteo Geocoding", "否", "免费接口限非商业使用。GeoNames 署名。"],
      [
        "Open-Meteo CAMS Global",
        "否",
        "免费接口限非商业使用。本地按 1.8 秒间隔限流。Open-Meteo 及 CAMS 署名，见 licenses.md。",
      ],
      [
        "NOAA ISD",
        "否",
        "使用固定宽度 gzip 档案。本地默认 500 ms 间隔。国际贡献记录许可待核实。",
      ],
      ["Meteostat", "否", "公开 gzip 文件。本地默认 500 ms 间隔。CC BY 4.0。"],
      ["OpenAQ API v3", "是", "无 Key 返回 401。许可按上游来源。"],
      [
        "StateAir / OpenAQ AWS",
        "否",
        "北京使馆单站公开分区样本。许可按上游来源。",
      ],
    ],
  ),
];
for (const [source, fields] of [
  ["cams", ["pm25"]],
  ["noaa-isd", ["vis", "rh"]],
  ["meteostat", ["vis", "rh"]],
  ["geocoding", []],
  ["openaq", ["pm25"]],
] as const) {
  const data = await samples(source);
  output.push("## " + source);
  if (fields.length) {
    for (const field of fields) {
      output.push("### " + field);
      output.push(
        table(
          ["城市", ...years],
          data.map(([city, sample]) => [
            city.name.zh,
            ...years.map((year) => {
              const row = sample.annual[year];
              const value = row?.valid[field];
              return value == null
                ? "—"
                : ((1 - value / row.total) * 100).toFixed(1) + "%";
            }),
          ]),
        ),
      );
    }
  }
  output.push(
    table(
      ["城市", "HTTP 200", "404", "其他请求结果", "成功耗时中位数 ms"],
      data.map(([city, sample]) => {
        const ok = sample.requests
          .filter((request) => request.status === "200")
          .map((request) => request.ms)
          .sort((a, b) => a - b);
        const missing = sample.requests.filter(
          (request) => request.status === "404",
        ).length;
        const errors = sample.requests.filter(
          (request) => request.status !== "200" && request.status !== "404",
        );
        return [
          city.name.zh,
          ok.length,
          missing,
          errors
            .map(
              (error) => error.year + " " + error.status.replaceAll("|", "/"),
            )
            .join("；") || "—",
          ok[Math.floor(ok.length / 2)] ?? "—",
        ];
      }),
    ),
  );
  if (source === "noaa-isd") {
    output.push("### 气象配对有效日");
    output.push(
      "每格依次为同时有至少 1 / 8 / 18 个有效小时的日数。跨年小时来自相邻 UTC 年文件。距离采用候选站点坐标。",
    );
    output.push(
      table(
        ["城市", "站号", "距离 km", ...years],
        data.map(([city, sample]) => [
          city.name.zh,
          sample.station?.id ?? "—",
          sample.station?.distanceKm ?? "—",
          ...years.map((year) =>
            sample.annual[year]?.paired?.[1] == null
              ? "—"
              : [1, 8, 18]
                  .map((min) => sample.annual[year].paired![min])
                  .join("/"),
          ),
        ]),
      ),
    );
  }
}
output.push("## GHCNh 替代源初探");
const ghcnh = await Promise.all(
  selected.map(async (city) => {
    const file = "ghcnh_" + city.id + ".json";
    if (!names.includes(file)) return [city.name.zh, "—", "—", "—"];
    const sample = JSON.parse(await readFile(folder + file, "utf8")) as {
      station: string;
      status: number;
      elapsedMs: number;
    };
    return [city.name.zh, sample.station, sample.status, sample.elapsedMs];
  }),
);
output.push(
  "NOAA 已用 GHCNh 替代 ISD。此轮用旧 WMO 编号推导对应的 GHCN 候选号，探测当年档案的限量字节范围。206 表示返回部分文件，404 表示该候选路径无文件。重新匹配站点和逐年统计尚待完成。",
  table(["城市", "候选编号", "HTTP", "耗时 ms"], ghcnh),
  "[NOAA GHCNh 数据集说明](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly)",
);
output.push("## CAMS 与北京使馆 PM2.5 偏差");
if (names.includes("stateair_CN-110100.json")) {
  const { from, to, annual, overlap, coverage } = JSON.parse(
    await readFile(folder + "stateair_CN-110100.json", "utf8"),
  ) as {
    from: string;
    to: string;
    annual: Record<string, number>;
    overlap: {
      days: number;
      from?: string;
      to?: string;
      correlation: number | null;
      meanBias: number | null;
      counts: { value: number; model: number; measured: number }[];
    };
    coverage: {
      month: string;
      keys?: number;
      failures?: number;
      error?: string;
    }[];
  };
  output.push(
    "北京使馆 OpenAQ location 21。比较同一 Asia/Shanghai 日期，实测和模型各需 18 个小时。",
  );
  output.push(
    table(
      [
        "采样起止",
        "重叠有效日",
        "重叠区间",
        "Pearson r",
        "平均偏差 μg/m³（模型减实测）",
      ],
      [
        [
          from + " – " + to,
          overlap.days,
          (overlap.from ?? "—") + " – " + (overlap.to ?? "—"),
          overlap.correlation?.toFixed(3) ?? "—",
          overlap.meanBias?.toFixed(2) ?? "—",
        ],
      ],
    ),
  );
  output.push(
    table(
      ["阈值（严格大于）", "CAMS 天数", "使馆天数", "差值"],
      overlap.counts.map((row) => [
        row.value,
        row.model,
        row.measured,
        row.model - row.measured,
      ]),
    ),
  );
  output.push(
    "测试窗口年度有效日为 " +
      Object.entries(annual)
        .map(([year, days]) => year + " 年 " + days + " 天")
        .join("，") +
      "。下载失败的月份或文件数见下表。该站点结果限样本日期，其他城市的领馆档案待验证。",
  );
  output.push(
    table(
      ["月份", "文件数", "下载失败或错误"],
      coverage.map((row) => [
        row.month,
        row.keys ?? "—",
        row.error ?? row.failures ?? "—",
      ]),
    ),
  );
} else
  output.push(
    "北京归档探测尚无结果。逐站比较需取得公开小时文件或免费 API Key。",
  );
output.push("## 40 城 CAMS 预取计时");
if (names.includes("overview-timing.json")) {
  const timing = JSON.parse(
    await readFile(folder + "overview-timing.json", "utf8"),
  ) as Record<
    string,
    {
      ms: number;
      cities: number;
      requests: number;
      failedRequests: number;
      failedCities: number;
    }
  >;
  output.push(
    table(
      ["模拟作业", "耗时 min", "城市数", "请求数", "失败请求率", "失败城市数"],
      Object.entries(timing).map(([label, row]) => [
        label,
        (row.ms / 60_000).toFixed(2),
        row.cities,
        row.requests,
        ((row.failedRequests / row.requests) * 100).toFixed(1) + "%",
        row.failedCities,
      ]),
    ),
  );
  output.push(
    "full 覆盖 CAMS 文档历史区间，incremental 仅请求当天。计时包括限流及重试。此轮只测 CAMS 请求，生产预取还需评估气象源、SQLite 写入和失败恢复。",
  );
} else output.push("CAMS 在六城完成可用性探测。全量及增量计时尚无文件。");
output.push(
  "## 候选结论",
  "见 [MVP 阶段评审](mvp-data-decision.md)。CAMS 适用于城市尺度趋势比较。北京单站适用于短期重叠对照。NOAA 候选站点展示应附距离和有效日数。Meteostat 样本的 RH 字段可分析，抽查文件缺少能见度字段。",
);
await writeFile("docs/data-source-report.md", output.join("\n\n") + "\n");
