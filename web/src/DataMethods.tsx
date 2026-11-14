import { useTranslation } from "react-i18next";

type CityRow = {
  name: Record<"zh" | "en", string>;
  latest: {
    pm25: number | null;
    pm25_24h: number | null;
    aqi: number | null;
  } | null;
  cams24h: number | null;
  bias: number | null;
  overlapDays: number;
  measuredOver75: number;
  modelOver75: number;
};

export const comparisonColumns = {
  colCity: (row: CityRow, lang: "zh" | "en") => row.name[lang],
  colPm: (row: CityRow) => row.latest?.pm25,
  colPm24: (row: CityRow) => row.latest?.pm25_24h,
  colAqi: (row: CityRow) => row.latest?.aqi,
  colCams24: (row: CityRow) => row.cams24h,
  colBias: (row: CityRow) => row.bias,
  colOverlap: (row: CityRow) => row.overlapDays,
  colOver75: (row: CityRow) =>
    row.overlapDays ? row.measuredOver75 / row.overlapDays : null,
  colModelOver75: (row: CityRow) =>
    row.overlapDays ? row.modelOver75 / row.overlapDays : null,
};

export function DataMethods() {
  const { t } = useTranslation();
  return (
    <>
      <h2>{t("dataMethods")}</h2>
      <dl>
        {(
          [
            "sourceArchive",
            "sourceRecent",
            "sourceCams",
            "sourceWeather",
          ] as const
        ).map((key) => (
          <div key={key}>
            <dt>
              <strong>{t(key)}</strong>
            </dt>
            <dd>
              <p>{t(key + "Text")}</p>
            </dd>
          </div>
        ))}
      </dl>
      <h2>{t("aqiMethodTitle")}</h2>
      <p>{t("aqiOfficial")}</p>
      <p>
        <code>IAQI = Iₗ + (Iₕ − Iₗ) × (C − Cₗ) / (Cₕ − Cₗ)</code>
      </p>
      <p>{t("aqiScale")}</p>
      <p>{t("aqiVersions")}</p>
      <p>
        <a href="https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/jcffbz/202602/t20260225_1144441.shtml">
          HJ 633—2026
        </a>
        {" · "}
        <a href="https://www.mee.gov.cn/ywgz/fgbz/bz/bzwb/jcffbz/201203/t20120302_224166.shtml">
          HJ 633—2012
        </a>
      </p>
      <h2>{t("compareMethodsTitle")}</h2>
      <p>{t("compareMethodsText")}</p>
    </>
  );
}
