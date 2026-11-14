import { SHANGHAI } from "../../../shared/dates.ts";
const formatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: SHANGHAI,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
});
export const hourInShanghai = (utc: string) =>
  formatter.format(new Date(utc)).replace(" ", "T");
export const csvRows = (body: string) =>
  body
    .trim()
    .split(/\r?\n/)
    .map((line) =>
      [...line.matchAll(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g)].map((field) =>
        (field[1] ?? field[2]).replaceAll('""', '"'),
      ),
    );
export function checked(field = "", sentinel: number, factor: number) {
  const [number, quality] = field.split(",");
  const value = Number(number);
  return number &&
    Number.isFinite(value) &&
    value !== sentinel &&
    ["0", "1", "4", "5", "9"].includes(quality)
    ? value / factor
    : null;
}
export function relativeHumidity(temperature: number, dewpoint: number) {
  return Math.min(
    100,
    100 *
      Math.exp(
        (17.625 * dewpoint) / (243.04 + dewpoint) -
          (17.625 * temperature) / (243.04 + temperature),
      ),
  );
}
export function distance(lat: number, lon: number, a: number, b: number) {
  const rad = Math.PI / 180;
  const x =
    Math.sin(((a - lat) * rad) / 2) ** 2 +
    Math.cos(lat * rad) *
      Math.cos(a * rad) *
      Math.sin(((b - lon) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(x)));
}
