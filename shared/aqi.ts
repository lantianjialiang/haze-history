const pmBreaks: [number, number, number, number][] = [
  [0, 35, 0, 50],
  [35, 75, 50, 100],
  [75, 115, 100, 150],
  [115, 150, 150, 200],
  [150, 250, 200, 300],
  [250, 350, 300, 400],
  [350, 500, 400, 500],
];

export function pm25ToAqi(value: number) {
  const sample = Math.min(Math.max(value, 0), 500);
  const band =
    pmBreaks.find(([, high]) => sample <= high) ??
    pmBreaks[pmBreaks.length - 1];
  const [low, high, indexLow, indexHigh] = band;
  return Math.round(
    ((indexHigh - indexLow) / (high - low)) * (sample - low) + indexLow,
  );
}
