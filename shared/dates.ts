export const FIRST_DAY = "2013-01-01";
export const SHANGHAI = "Asia/Shanghai";
const localDate = new Intl.DateTimeFormat("sv-SE", {
  timeZone: SHANGHAI,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});
export const today = () => localDate.format(new Date());
export const shiftDate = (date: string, days: number) =>
  new Date(Date.parse(date + "T00:00:00Z") + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
export function validDate(date: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number.isFinite(Date.parse(date)) &&
    shiftDate(date, 0) === date
  );
}
export function* dateRange(from: string, to: string) {
  for (let date = from; date <= to; date = shiftDate(date, 1)) yield date;
}
export const yearsBetween = (from: string, to: string) =>
  Array.from(
    { length: Number(to.slice(0, 4)) - Number(from.slice(0, 4)) + 1 },
    (_, i) => String(Number(from.slice(0, 4)) + i),
  );
