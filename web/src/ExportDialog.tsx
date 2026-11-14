import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  exportFilename,
  exportImage,
  sizes,
  type ExportOptions,
  type ExportTarget,
} from "./export.ts";
import type { Theme } from "./charts.ts";
import type { Language } from "./i18n.ts";
import { Icon } from "./icons.tsx";
const presets = {
  "social-square": "square",
  "social-wide": "wide",
  "a4-portrait": "a4",
  "4k": "uhd",
} as const;
export function ExportDialog({
  target,
  theme,
  lang,
  onClose,
}: {
  target: ExportTarget;
  theme: Theme;
  lang: Language;
  onClose: () => void;
}) {
  const { t, i18n } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const [options, set] = useState<ExportOptions>({
    format: "png",
    preset: target.kind === "poster" ? "a4-portrait" : "social-wide",
    scale: 1,
    theme,
    includeWatermark: true,
    lang,
  });
  const [preview, setPreview] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    let url = "",
      cancelled = false;
    const timer = window.setTimeout(() => {
      exportImage(target, options, i18n.getFixedT(options.lang), true)
        .then((blob) => {
          if (!cancelled) {
            url = URL.createObjectURL(blob);
            setPreview(url);
            setFailed(false);
          }
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    }, 100);
    return () => {
      clearTimeout(timer);
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [target, options, i18n]);
  async function download() {
    setBusy(true);
    setFailed(false);
    try {
      const blob = await exportImage(
        target,
        options,
        i18n.getFixedT(options.lang),
      );
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = exportFilename(target, options.lang);
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} onClose={onClose} aria-labelledby="export-title">
      <div className="chart-header">
        <h2 id="export-title">
          {t(target.kind === "poster" ? "poster" : "export")}
        </h2>
        <button
          className="icon-button"
          onClick={() => dialog.current?.close()}
          aria-label={t("close")}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="export-grid">
        <div className="export-controls">
          <label>
            {t("preset")}
            <select
              aria-label={t("preset")}
              value={options.preset}
              onChange={(e) =>
                set({
                  ...options,
                  preset: e.target.value as ExportOptions["preset"],
                })
              }
            >
              {Object.entries(presets).map(([key, value]) => (
                <option key={key} value={key}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("scale")}
            <select
              value={options.scale}
              onChange={(e) =>
                set({
                  ...options,
                  scale: Number(e.target.value) as ExportOptions["scale"],
                })
              }
            >
              {[1, 2, 3].map((scale) => (
                <option key={scale} value={scale}>
                  {scale}×
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("theme")}
            <select
              value={options.theme}
              onChange={(e) =>
                set({ ...options, theme: e.target.value as Theme })
              }
            >
              <option value="light">{t("light")}</option>
              <option value="dark">{t("dark")}</option>
            </select>
          </label>
          <label>
            {t("language")}
            <select
              value={options.lang}
              onChange={(e) =>
                set({ ...options, lang: e.target.value as Language })
              }
            >
              <option value="zh-CN">中文</option>
              <option value="en">English</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={options.includeWatermark}
              onChange={(e) =>
                set({ ...options, includeWatermark: e.target.checked })
              }
            />
            {t("watermark")}
          </label>
          <small>
            {sizes[options.preset]
              .map((size) => size * options.scale)
              .join(" × ")}{" "}
            px
          </small>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => void download()}
          >
            <Icon name="download" />
            {t(busy ? "noPreview" : "download")}
          </button>
          {failed && (
            <p className="form-error" role="alert">
              {t("exportError")}
            </p>
          )}
        </div>
        <div className="export-preview">
          {preview ? (
            <img src={preview} alt={t("preview")} />
          ) : (
            <span role="status">{t("noPreview")}</span>
          )}
        </div>
      </div>
    </dialog>
  );
}
