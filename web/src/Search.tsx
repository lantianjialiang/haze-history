import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import type { CityRef } from "../../shared/types.ts";
import { api } from "./api.ts";
import { Icon } from "./icons.tsx";

export function Search({
  onSelect,
  lang,
}: {
  onSelect: (city: CityRef) => void;
  lang: "zh" | "en";
}) {
  const { t } = useTranslation();
  const [q, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [results, setResults] = useState<{
    query: string;
    cities: CityRef[];
    failed?: boolean;
  }>();
  const listId = useId();
  const matching = results?.query === q.trim() ? results : undefined;
  const visible = open && !!q.trim();
  useEffect(() => {
    const query = q.trim();
    if (!query || !open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      api<CityRef[]>(
        "/geocode?q=" + encodeURIComponent(query),
        controller.signal,
      )
        .then((cities) => setResults({ query, cities }))
        .catch(() => {
          if (!controller.signal.aborted)
            setResults({ query, cities: [], failed: true });
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [q, open]);
  function choose(city: CityRef) {
    onSelect(city);
    setQuery("");
    setOpen(false);
    setActive(-1);
  }
  return (
    <div
      className="search"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <Icon name="search" />
      <input
        role="combobox"
        aria-label={t("searchLabel")}
        aria-expanded={visible}
        aria-autocomplete="list"
        aria-controls={listId}
        aria-activedescendant={
          visible && active >= 0 ? listId + "-" + active : undefined
        }
        placeholder={t("search")}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(-1);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            return;
          }
          const cities = matching?.cities ?? [];
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            if (cities.length)
              setActive((index) =>
                index < 0
                  ? event.key === "ArrowDown"
                    ? 0
                    : cities.length - 1
                  : (index +
                      (event.key === "ArrowDown" ? 1 : -1) +
                      cities.length) %
                    cities.length,
              );
          }
          if (
            event.key === "Enter" &&
            visible &&
            cities[active < 0 ? 0 : active]
          )
            choose(cities[active < 0 ? 0 : active]);
        }}
      />
      {visible && (
        <div className="search-menu">
          <div role="listbox" id={listId} aria-label={t("searchLabel")}>
            {matching?.cities.map((city, index) => (
              <div
                role="option"
                aria-selected={index === active}
                id={listId + "-" + index}
                key={city.id}
                onPointerDown={(event) => event.preventDefault()}
                onClick={() => choose(city)}
              >
                <strong>{city.name[lang]}</strong>
                <span>{city.province[lang]}</span>
              </div>
            ))}
          </div>
          {!matching?.cities.length && (
            <div role="status">
              {matching
                ? t(matching.failed ? "searchError" : "noResults")
                : t("loading")}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
