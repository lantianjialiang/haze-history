import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import zh from "../../shared/locales/zh-CN.json";
import en from "../../shared/locales/en.json";
export type Language = "zh-CN" | "en";
export const validLanguage = (lang: string | null): lang is Language =>
  lang === "zh-CN" || lang === "en";
export function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* Storage may be disabled. */
  }
}
const urlLanguage = new URLSearchParams(location.search).get("lang");
const savedLanguage = stored("haze.lang");
const lng = validLanguage(urlLanguage)
  ? urlLanguage
  : validLanguage(savedLanguage)
    ? savedLanguage
    : "zh-CN";
void i18n.use(initReactI18next).init({
  resources: { "zh-CN": { translation: zh }, en: { translation: en } },
  lng,
  fallbackLng: "zh-CN",
  interpolation: { escapeValue: false },
});
export default i18n;
