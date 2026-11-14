# 仍缺的历史数据与付费方案

免费归档已经覆盖：

- 北京 2013-12-06 起（quotsoft `beijing_all`）
- 全国 40 城 2014-05-13 至昨天（CN-AIR + quotsoft `china_cities`）

官方实时站 `air.cnemc.cn:18007` 只给近几小时，不能回放 2013 年。CAMS / IQAir 是模式或商业指数，不能当监测总站雾霾日计数。

## 缺口

全国城市 **2013-01-01 至 2014-05-12**（北京 2013-12-06 之前也没有）。当时国控网还在扩容：大约 2013-01-18 起约 76 城，2013-10 起约 114 城。源站本身就没有 quotsoft 那种全国城市 CSV。

下列渠道都要付钱或申请，没有可直接批量下载的开放副本。本仓库不会去爬付费站。

## 再搜一轮：看起来像能下、实际填不了 2013 缺口

| 来源 | 覆盖 | 结论 |
| --- | --- | --- |
| [quotsoft](https://quotsoft.net/air/) | 全国 2014-05-13 起；北京 2013-12-06 起 | 已经入库。 |
| [Zenodo 10836299](https://zenodo.org/records/10836299) | 国控站小时 2014-05-13～2022 | 与 quotsoft 同源，不能补 2013。 |
| [Figshare / Silver 等 2025](https://figshare.com/articles/dataset/Data_repository_for_A_decade_of_China_s_air_quality_monitoring_data_suggests_health_impacts_are_no_longer_declining_/25689477) | 论文写明从 2014-05-13 下到 2025-01 | 同样不覆盖 2013。 |
| [数研Lab 城市日度](https://www.sydatalab.cn/content/55321dee-72ca-4949-be52-07c5e2c06b9f/) | 声称 2013-12-01～2024-05-31 全国 370+ 城日均 | 页面只有「获取资源下载信息」，无公开 CSV。即使能拿到也是日度不是小时，且 2013-12 仍缺年初。 |
| [海天气象 htqx](https://htqx.cn/meteo/data/history_archive/) | 2014～2026 城市小时（自称 CNEMC） | 起点仍是 2014，和已有归档重叠。 |
| [Zenodo 县周均值](https://zenodo.org/records/10433250) | 2013～2018 县周 PM | 周均值，不能用来数雾霾日。 |
| 官方 `GetAQIHistoryByConditionHis` | 近 24 小时 | 已经用来做「监测总站近期实测」，不能回放 2013。 |

没有找到可合法批量下载的 2013 年全国城市小时 CSV。

## 付费选项（补 2013 年全国）

| 方案 | 覆盖 | 怎么买 | 备注 |
| --- | --- | --- | --- |
| [青悦 · 国控空气](https://data.epmap.org/product/nationair) | 2013-01 起城市/站点时报、日报 | [阿里云城市接口](https://market.aliyun.com/products/57096001/cmapi00047069.html)（店铺里可见约 ¥2/3600 次、城市批量约 ¥10/2000 次）；或青悦 MCP `sk_` 按调用计费 | 2013-01～2014-05 为青悦外部采购，城市日报缺 `O3_8h_24h`。这是补 2013 年全国最对口的来源。 |
| [数据网 shu-ju.net](http://www.shu-ju.net/) | 号称 2013-01-18 起站点小时 CSV（约 700 MB+） | QQ 47562772，页面写明有偿；仅有示例可点 | 适合一次性买包，不适合自动更新。 |
| [观天者数据站](https://docs.datastation.skyviewor.com/data-query/china-pollution/pollution-dataset/) | 约 2014 年起国控站/城 | 按导出记录扣资源点 | 与已有 quotsoft 重叠，补 2013 用处不大。 |
| IQAir AirVisual API | 商业站点/城市指数 | 企业订阅 | 口径不是国控城市均值，不要用来数雾霾日。 |

建议：若要做 2013 年全国 40 城，买青悦城市时报（或打包下载）2013-01-01～2014-05-12，再按本站同样的 ≥12 小时日均规则入库。不要把 CAMS 填进这段空窗。
