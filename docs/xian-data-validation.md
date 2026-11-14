# 西安历史数据核验与后续采集

## 空气质量与官方统计

从本地 `data/quotsoft-history.sqlite` 的 `daily` 表按西安和自然年聚合。官方年度数据保存在 `data/reference/xian-official-annual.csv`，2024 原始统计公报 PDF 同目录存档。这些年度统计仅用于对比，不能恢复日期，不输入日历热力图。

| 年 | 本地有效日 | 本地日均 PM2.5 的平均值 | 官方 PM2.5 年均 | 本地 AQI ≤ 100 天数 | 官方优良天数 |
|---|---:|---:|---:|---:|---:|
| 2023 | 365 | 49.85 | 48 | 275 | 228 |
| 2024 | 366 | 44.67 | 43 | 291 | 241 |

本地 AQI 取可用小时指数的均值，小时数不足时取最后可用值。官方日 AQI 按各项污染物规定的时段和分指数计算。两者差 47 和 50 天，覆盖完整仍不能消除口径差。PM2.5 也有 1.85 和 1.67 μg/m³ 的差异，应核对站点、有效小时数以及沙尘剔除规则再归因。[西安环境统计年报](https://xaepb.xa.gov.cn/xxgk/hjzkgb/hjtjnb/1996392472522579969.html) · [2023 优良天数出处](https://www.xa.gov.cn/gk/ghjh/zfgzbg/1759409582330392578.html) · [2024 统计公报](https://tjj.shaanxi.gov.cn/tjsj/ndsj/tjgb/gs/202506/P020250616389699615236.pdf)

## 能见度实测

下载并接入西安机场站 WMO 57036 的 2024 年 ISD 原始档案，站点距城市中心约 21 km。8,393 条观测取得 8,381 个有效配对小时及 350 个有效日（18 小时门槛）。按当前默认气象阈值得 326 个候选日。4,044 条 FM-15 记录恰为 9.9 km，另有 874 条报 9.999 km；后者按 METAR 9999 表示至少 10 km 处理，前者保留原值并标记局限。站点代表性、编码及截断使这个数字只适合探索，无法据此确认实际霾日数。当前档案仅含 2024 UTC 年文件，西安本地年初边界的上一年小时未纳入。运行 `npx tsx server/scripts/import-xian-visibility.ts` 可从下载文件复现。[NOAA 原始档案](https://www.ncei.noaa.gov/pub/data/noaa/2024/570360-99999-2024.gz) · [ICAO 能见度编码说明](https://www.icao.int/airnavigation/METP/14th%20Meeting%20WAFS/METPWGMOG14%20IP09%20Att1-%20Doc.8896.update%20Amd%2081.pdf)

## 后续数据采集

1. 优先申请国家气象信息中心的国际交换站定时记录，先取西安城区与机场同一月份做重叠对照。另可评估业务内网的小时能见度产品。公开目录已核实，逐小时文件和授权尚未取得。[定时值数据目录](https://k.data.cma.cn/mekb/?dataCode=A.0012.0001.S011&r=data%2Fdetail) · [小时能见度产品](https://k.data.cma.cn/mekb/?id=42721&r=site%2Farticle)
2. 用 NOAA GHCNh 补近期记录。按站号、坐标、仪器和日期重新匹配，保留两个相邻 UTC 年、质控码和上限标记。GitHub 的 ISD 解析项目可复核解析，来源相同的数据不计作独立观测。[NOAA GHCNh](https://www.ncei.noaa.gov/products/global-historical-climatology-network-hourly) · [GitHub ISD 解析器](https://github.com/ropensci/isdparser)
3. 每日增量采集，定期重拉最近数日以吸收迟到修订。原始数据保存来源、版本、站号、单位、时区及校验和。季度抽样比较双源的共同有效日，分别报告偏差、覆盖及阈值两侧的分歧。
4. 仅有统计数的来源继续归档原文件和结构化指标。记录统计周期、口径、样本数和出处。国家气象信息中心的「能见度＜10 km 出现频率」可作为对照，须确认分母和采样频率后再比较。[地面气象历史年值](https://k.data.cma.cn/mekb/?datacode=A.0019.0001.S002&r=dataService%2Fcdcindex)
