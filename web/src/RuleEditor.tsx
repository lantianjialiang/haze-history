import { useState } from "react";
import { useTranslation } from "react-i18next";
import { presets } from "../../shared/presets.ts";
import { maxima, validateRule } from "../../shared/rules.ts";
import {
  operators,
  type Metric,
  type Op,
  type RuleConfig,
} from "../../shared/types.ts";
import { Icon } from "./icons.tsx";
export function RuleEditor({
  rule,
  available,
  basis,
  onChange,
  lang,
}: {
  rule: RuleConfig;
  available: Metric[];
  basis: RuleConfig["basis"];
  onChange: (rule: RuleConfig) => void;
  lang: "zh" | "en";
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(rule);
  const [open, setOpen] = useState(false);
  const matching = presets.filter(
    (item) =>
      item.basis === basis &&
      item.conditions.every((condition) =>
        available.includes(condition.metric),
      ),
  );
  const preset = matching.find(
    (item) => JSON.stringify(item) === JSON.stringify(rule),
  );
  const result = validateRule(draft);
  function edit(next: RuleConfig) {
    const custom = {
      ...next,
      id: "custom",
      name: { zh: "自定义规则", en: "Custom rule" },
      reference: undefined,
    };
    setDraft(custom);
    const validation = validateRule(custom);
    if (validation.valid) onChange(validation.rule);
  }
  return (
    <>
      <label>
        {t("rule")}
        <select
          aria-label={t("rule")}
          value={preset?.id ?? "custom"}
          onChange={(event) => {
            const selected = matching.find(
              (item) => item.id === event.target.value,
            );
            if (selected) {
              onChange(selected);
              setOpen(false);
            } else {
              setOpen(true);
              edit(rule);
            }
          }}
        >
          {matching.map((item) => (
            <option value={item.id} key={item.id}>
              {item.name[lang]}
            </option>
          ))}
          <option value="custom">{t("custom")}</option>
        </select>
      </label>
      {(open || !preset) && (
        <div className="rule-editor">
          <label>
            {t("rule")}{" "}
            <select
              value={draft.combine}
              onChange={(event) =>
                edit({
                  ...draft,
                  combine: event.target.value as RuleConfig["combine"],
                })
              }
            >
              <option value="AND">{t("AND")}</option>
              <option value="OR">{t("OR")}</option>
            </select>
          </label>
          {draft.conditions.map((condition, index) => {
            function update(next: typeof condition) {
              edit({
                ...draft,
                conditions: draft.conditions.map((item, i) =>
                  i === index ? next : item,
                ),
              });
            }
            return (
              <fieldset key={index}>
                <legend>{t("condition", { n: index + 1 })}</legend>
                <select
                  aria-label={t("basis")}
                  value={condition.metric}
                  onChange={(event) =>
                    update({
                      ...condition,
                      metric: event.target.value as Metric,
                    })
                  }
                >
                  {[...new Set([...available, condition.metric])].map(
                    (metric) => (
                      <option key={metric} value={metric}>
                        {t(metric)}
                      </option>
                    ),
                  )}
                </select>
                <select
                  aria-label={t("rule")}
                  value={condition.op}
                  onChange={(event) =>
                    update({ ...condition, op: event.target.value as Op })
                  }
                >
                  {operators.map((op) => (
                    <option key={op}>{op}</option>
                  ))}
                </select>
                <input
                  aria-label={t("rule")}
                  type="number"
                  min={0}
                  max={maxima[condition.metric]}
                  step="any"
                  aria-invalid={result.errors?.some(
                    (error) => error.path[1] === index,
                  )}
                  value={
                    Number.isFinite(condition.value) ? condition.value : ""
                  }
                  onChange={(event) =>
                    update({ ...condition, value: event.target.valueAsNumber })
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  disabled={draft.conditions.length === 1}
                  aria-label={t("remove")}
                  onClick={() =>
                    edit({
                      ...draft,
                      conditions: draft.conditions.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <Icon name="close" />
                </button>
              </fieldset>
            );
          })}
          <button
            className="button"
            disabled={draft.conditions.length >= 5 || !available[0]}
            onClick={() =>
              edit({
                ...draft,
                conditions: [
                  ...draft.conditions,
                  { metric: available[0], op: ">", value: 0 },
                ],
              })
            }
          >
            {t("add")}
          </button>
          {!result.valid && (
            <p className="form-error" role="alert">
              {t("ruleInvalid")}
            </p>
          )}
        </div>
      )}
    </>
  );
}
