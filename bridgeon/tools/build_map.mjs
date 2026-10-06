// 세계지도 SVG 경로 사전 계산 (빌드 시 1회)
//
// 실행: npm install && node tools/build_map.mjs
// world-atlas(Natural Earth 1:110m) → Natural Earth 투영 → data/world_map.json
// 대시보드는 이 결과를 HTML 안에 넣어 쓰므로 실행 시 인터넷·라이브러리가 필요 없다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const topo = JSON.parse(fs.readFileSync(path.join(ROOT, "node_modules/world-atlas/countries-110m.json"), "utf8"));
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "data/dictionaries.json"), "utf8"));

const W = 960, H = 440;
const countries = feature(topo, topo.objects.countries).features.filter((f) => f.id !== "010"); // 남극 제외
const projection = geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], { type: "FeatureCollection", features: countries });
const toPath = geoPath(projection).digits(1);

const points = {};
for (const [code, c] of Object.entries(dict.country)) points[code] = projection(c.lonlat).map((v) => Math.round(v * 10) / 10);
points.KR = projection([127.8, 36.4]).map((v) => Math.round(v * 10) / 10);

const out = {
  width: W,
  height: H,
  source: "Natural Earth 1:110m via world-atlas@2 (public domain)",
  countries: countries.map((f) => ({ id: f.id, name: f.properties.name, d: toPath(f) })).filter((c) => c.d),
  points,
};
fs.writeFileSync(path.join(ROOT, "data/world_map.json"), JSON.stringify(out) + "\n");
console.log("world_map.json", Math.round(fs.statSync(path.join(ROOT, "data/world_map.json")).size / 1024), "KB", out.points);
