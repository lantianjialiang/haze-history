# 数据源、署名与地图审查

下表区分候选服务的许可与项目内验证状态。生产启用以 A0.6 评审为准。

| 来源 | 缓存、展示与衍生图 | 署名及依据 |
|---|---|---|
| 中国环境监测总站（quotsoft / CN-AIR 归档） | 总站实时发布系统为公开数据。本站缓存日均、在页面和导出图中展示，并在页脚署名。 | 中国环境监测总站公开发布；小时 CSV 由 [quotsoft](https://quotsoft.net/air/) 整理，[CN-AIR](https://atomgit.com/GewisLab/CN-AIR) 镜像。 |
| Open-Meteo CAMS | 免费端点限非商业使用。数据遵守 CC BY 4.0，允许缓存、展示及衍生图，保留署名及加工说明。 | Open-Meteo / Copernicus CAMS。[服务条款](https://open-meteo.com/en/terms) · [CAMS 署名要求](https://open-meteo.com/en/docs/air-quality-api) |
| Open-Meteo Geocoding | 免费端点限非商业使用。保存和展示 GeoNames 数据时保留来源署名。 | Open-Meteo / GeoNames。[地理编码 API](https://open-meteo.com/en/docs/geocoding-api) |
| NOAA NCEI ISD | 可从开放档案做本地探测。国际贡献观测的公开展示、再分发及衍生图许可仍需核实数据集和上游站点条款。 | NOAA NCEI Global Hourly / Integrated Surface Database。[档案许可政策](https://www.ncei.noaa.gov/archive) |
| NOAA NCEI GHCNh | 可做本地探测。产品整合多来源，公开展示、再分发与衍生图须核实贡献方适用的条款。 | NOAA NCEI Global Historical Climatology Network Hourly。[数据集元信息](https://www.ncei.noaa.gov/metadata/geoportal/rest/metadata/item/gov.noaa.ncdc%3AC01688/html) |
| OpenAQ API / AWS | 复用范围随原提供方许可而定。启用监测站前需确认展示、缓存和衍生图许可及署名。API 测试需要账户密钥，AWS 样本无需密钥。 | OpenAQ + 原观测组织。[许可证接口](https://docs.openaq.org/resources/licenses) · [公开 AWS 档案](https://docs.openaq.org/aws/about) |
| StateAir / US Embassy | 已启用五城馆区 PM2.5（2013 起可展示）。2010–2015 为 UCI 五城；2016 起为 AirNow 使馆小时值（北京/上海/广州/沈阳至 2025-03，成都至 2020）。AQI 由 PM2.5 单指标折算。 | 原始观测为美国国务院驻华使领馆。2010–2015 使用 [UCI 五城数据集](https://archive.ics.uci.edu/dataset/394/pm2+5+data+of+five+chinese+cities)（Chen 2016，[DOI](https://doi.org/10.24432/C52K58)）；之后使用 EPA 提供的 [AirNow 历史快照](https://github.com/dolekhanhdang/Air-Quality-Data-from-U.S.-Embassies)。 |
| Meteostat 批量数据 | CC BY 4.0 允许缓存、展示和衍生图，注明变更及来源。 | Meteostat 和各原始气象数据提供方。[许可证](https://dev.meteostat.net/license.html) |

中国地图候选依据[自然资源部公开地图内容表示规范](https://www.fmprc.gov.cn/web/wjb_673085/zzjg_673183/bjhysws_674671/bhflfg/dtdmxgfl/202303/P020230313585504979937.pdf)及[标准地图服务系统](https://bzdt.tianditu.gov.cn/)。尚未取得可验证审图号、复用许可且符合边界要求的 GeoJSON。地图 B 保持待开放，界面与导出未使用未经验证的边界文件。
