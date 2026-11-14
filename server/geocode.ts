import cities from "../data/cities-cn.json";
import type { CityRef } from "../shared/types.ts";
export const staticCities = new Map<string, CityRef>(
  cities.map(({ id, name, province, lat, lon, adcode }) => [
    id,
    { id, name, province, lat, lon, adcode },
  ]),
);
const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[\s'’.-]/g, "");
export function geocode(q: string, limit = 8): CityRef[] {
  const query = normalize(q);
  if (!query) return [];
  return cities
    .map((city) => {
      const names = [
        city.name.zh,
        city.name.en,
        city.pinyin,
        city.name.zh + (city.name.zh.endsWith("区") ? "" : "市"),
        ...city.aliases,
      ].map(normalize);
      const priority = names.includes(query)
        ? 2
        : names.some((name) => name.startsWith(query))
          ? 1
          : 0;
      return { city, priority };
    })
    .filter((row) => row.priority)
    .sort((a, b) => b.priority - a.priority)
    .slice(0, limit)
    .map((row) => staticCities.get(row.city.id)!);
}
