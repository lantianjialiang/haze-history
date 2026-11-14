import { gunzipSync } from "node:zlib";

const ids = [21, 22, 23, 24, 25, 26, 27, 28, 30, 817, 818, 819, 820, 821];

async function sample(id: number) {
  const list = await fetch(
    "https://openaq-data-archive.s3.amazonaws.com/?list-type=2&prefix=records/csv.gz/locationid=" +
      id +
      "/year=2016/month=06/&max-keys=3",
  );
  const xml = await list.text();
  const key = xml.match(/<Key>([^<]+)<\/Key>/)?.[1];
  if (!key) {
    console.log(id, "no 2016-06");
    return;
  }
  const res = await fetch("https://openaq-data-archive.s3.amazonaws.com/" + key);
  if (!res.ok) {
    console.log(id, "http", res.status);
    return;
  }
  const text = gunzipSync(Buffer.from(await res.arrayBuffer())).toString();
  const lines = text.trim().split(/\r?\n/).slice(0, 4);
  console.log("---", id, key);
  console.log(lines.join("\n"));
}

for (const id of ids) await sample(id);
