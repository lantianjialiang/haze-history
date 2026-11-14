import { gunzipSync } from "node:zlib";

async function firstKey(id: number) {
  for (const year of [2016, 2017, 2015, 2018]) {
    const list = await fetch(
      "https://openaq-data-archive.s3.amazonaws.com/?list-type=2&prefix=records/csv.gz/locationid=" +
        id +
        "/year=" +
        year +
        "/&max-keys=1",
    );
    const xml = await list.text();
    const key = xml.match(/<Key>([^<]+)<\/Key>/)?.[1];
    if (key) return key;
  }
}

async function nameOf(id: number) {
  const key = await firstKey(id);
  if (!key) return;
  const res = await fetch("https://openaq-data-archive.s3.amazonaws.com/" + key);
  if (!res.ok) return;
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString();
  const row = text.trim().split(/\r?\n/)[1] ?? "";
  if (
    /embassy|consulate|beijing|shanghai|guangzhou|chengdu|shenyang|stateair|diplomatic/i.test(
      row,
    )
  )
    console.log("HIT", id, row);
}

const ids = [
  ...Array.from({ length: 80 }, (_, i) => i + 1),
  ...Array.from({ length: 50 }, (_, i) => 180 + i),
  ...Array.from({ length: 40 }, (_, i) => 800 + i),
  2178, 8118, 8881, 4252, 4253, 4254, 4255, 4256,
];
for (const id of ids) await nameOf(id);
console.log("scan done");
