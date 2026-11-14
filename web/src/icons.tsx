import type { SVGProps } from "react";
const paths = {
  wind: "M2 8h13a3 3 0 1 0-3-3M2 12h18a2 2 0 1 1-2 2M2 16h9a3 3 0 1 1-3 3",
  search: "M21 21l-4.3-4.3M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0Z",
  moon: "M20.9 13.4A9 9 0 0 1 10.6 3.1 9 9 0 1 0 20.9 13.4Z",
  sun: "M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4m0-14.2-1.4 1.4M6.3 17.7l-1.4 1.4M17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  download: "M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4",
  location:
    "M20 10c0 5.5-8 11-8 11s-8-5.5-8-11a8 8 0 1 1 16 0Z M15 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  map: "m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3V6Zm6-3v15m6-12v15",
  chart: "M3 3v18h18M8 16v-4m5 4V8m5 8V5",
  sliders: "M4 7h16M4 17h16m-11-13v6m6 4v6",
  arrow: "M5 12h14m-6-6 6 6-6 6",
  chevron: "m6 9 6 6 6-6",
  info: "M12 11v5m0-8h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z",
  book: "M12 6v15m0-15c-3-3-6-4-10-3v15c4-1 7 0 10 3 3-3 6-4 10-3V3c-4-1-7 0-10 3Z",
  close: "m6 6 12 12M18 6 6 18",
};
export function Icon({
  name,
  ...props
}: SVGProps<SVGSVGElement> & { name: keyof typeof paths }) {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name]} />
    </svg>
  );
}
