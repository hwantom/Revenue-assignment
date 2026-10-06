// 국기 SVG 사전 준비 (빌드 시 1회)
//
// 실행: npm install && node tools/build_flags.mjs
// flag-icons(MIT, 4:3 비율) 에서 대시보드에 쓰는 국가의 국기만 골라 data/flags.json 에 담는다.
// 이모지 국기는 Windows 에서 글자(US, JP…)로 보이므로 SVG 를 HTML 안에 넣어 쓴다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dict = JSON.parse(fs.readFileSync(path.join(ROOT, "data/dictionaries.json"), "utf8"));
const codes = [...Object.keys(dict.country), "KR"];
const flags = {};
for (const c of codes) {
  const svg = fs.readFileSync(path.join(ROOT, "node_modules/flag-icons/flags/4x3", `${c.toLowerCase()}.svg`), "utf8").trim();
  flags[c] = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
}
const out = { source: "flag-icons (MIT License, https://github.com/lipis/flag-icons), 4x3", flags };
fs.writeFileSync(path.join(ROOT, "data/flags.json"), JSON.stringify(out) + "\n");
console.log("flags.json", Math.round(fs.statSync(path.join(ROOT, "data/flags.json")).size / 1024), "KB", codes.join(" "));
