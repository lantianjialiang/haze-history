import { mkdir, writeFile } from "node:fs/promises";
import { upstream } from "../../upstream.ts";
import { today } from "../../../shared/dates.ts";

const candidates = {
  "CN-110100": "CHM00054511",
  "CN-310100": "CHM00058367",
  "CN-510100": "CHM00056294",
  "CN-130100": "CHM00053698",
  "CN-440100": "CHM00059287",
  "CN-650100": "CHM00051463",
};
const directory = "data/spike-samples";
const download = upstream(1000);
const year = today().slice(0, 4);
const root =
  "https://www.ncei.noaa.gov/oa/global-historical-climatology-network/hourly/access/by-year/";
await mkdir(directory, { recursive: true });
for (const [city, id] of Object.entries(candidates)) {
  const url = root + year + "/psv/GHCNh_" + id + "_" + year + ".psv";
  const start = performance.now();
  const response = await download(url, { Range: "bytes=0-23999" });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let sample = "";
  if (reader) {
    while (sample.length < 24000) {
      const chunk = await reader.read();
      if (chunk.done) break;
      sample += decoder.decode(chunk.value, { stream: true });
    }
    await reader.cancel();
  }
  const data = {
    city,
    station: id,
    year,
    status: response.status,
    elapsedMs: Math.round(performance.now() - start),
    raw: sample.slice(0, 24000),
  };
  await writeFile(
    directory + "/ghcnh_" + city + ".json",
    JSON.stringify(data, null, 2),
  );
  console.log(city, id, response.status);
}
