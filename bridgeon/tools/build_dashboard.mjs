// dashboard.html 빌드: 정제 데이터·원본 전표·지도·정책을 HTML 한 파일에 넣는다.
//
// 실행: node tools/build_dashboard.mjs
// - file:// 로 바로 열 수 있도록 JSON 을 fetch 하지 않고 HTML 안에 포함한다.
// - node_modules/pretendard 와 pyftsubset(fonttools)이 있으면 화면에 쓰이는 글자만
//   남긴 Pretendard 부분 글꼴을 base64 로 넣는다. 없으면 시스템 글꼴로 표시된다.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, "data", f), "utf8"));

const fx = load("fx_rates.json");
const fxMonthly = {};
for (const [day, rates] of Object.entries(fx.rates)) {
  const m = day.slice(0, 7);
  if (m < "2026-01") continue;
  fxMonthly[m] ||= {};
  for (const [c, q] of Object.entries(rates)) (fxMonthly[m][c] ||= []).push(q / (fx.meta.quote_units[c] || 1));
}
for (const m of Object.keys(fxMonthly))
  for (const c of Object.keys(fxMonthly[m])) {
    const a = fxMonthly[m][c];
    fxMonthly[m][c] = Math.round((a.reduce((s, v) => s + v, 0) / a.length) * 10000) / 10000;
  }

const data = {
  slips: load("clean_slips.json"),
  raw: load("raw_slips.json"),
  log: load("cleaning_log.json"),
  summary: load("summary.json"),
  validation: load("validation_report.json"),
  rules: load("rules.json"),
  dict: load("dictionaries.json"),
  policy: load("fee_policy.json"),
  map: load("world_map.json"),
  flags: load("flags.json").flags,
  fx_meta: fx.meta,
  fx_monthly: fxMonthly,
  // LED 전광판용: 마지막 고시일과 직전 고시일 환율 (고시 단위 그대로)
  fx_latest: (() => {
    const days = Object.keys(fx.rates).sort();
    const [prev, last] = days.slice(-2);
    return { date: last, prev_date: prev, rates: fx.rates[last], prev: fx.rates[prev] };
  })(),
};

const template = fs.readFileSync(path.join(ROOT, "tools", "dashboard_template.html"), "utf8");
const dataJs = JSON.stringify(data).replace(/<\//g, "<\\/");

function fontBase64(text) {
  const ttf = path.join(ROOT, "node_modules/pretendard/dist/public/variable/PretendardVariable.ttf");
  if (!fs.existsSync(ttf)) return null;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bo-font-"));
  const chars = new Set(text);
  for (let c = 0x20; c < 0x7f; c++) chars.add(String.fromCharCode(c));
  for (const c of "–—·…‘’“”→←↔×÷₩％▲▼①②③④⑤⑥⑦✓✕›◐") chars.add(c);
  const txt = path.join(tmp, "chars.txt");
  fs.writeFileSync(txt, [...chars].join(""));
  const out = path.join(tmp, "font.woff2");
  try {
    execFileSync("pyftsubset", [ttf, `--text-file=${txt}`, "--flavor=woff2", "--layout-features=*", `--output-file=${out}`], { stdio: "pipe" });
    return fs.readFileSync(out).toString("base64");
  } catch (e) {
    console.warn("글꼴 부분 추출 실패 → 시스템 글꼴 사용:", e.message.split("\n")[0]);
    return null;
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

let html = template.replace("/*__DATA__*/", () => dataJs);
const font = fontBase64(template + dataJs);
html = font ? html.replace("/*__FONT__*/", () => font) : html.replace(/@font-face\{[^}]*\/\*__FONT__\*\/[^}]*\}\n?/, "");
fs.writeFileSync(path.join(ROOT, "dashboard.html"), html);
console.log(`dashboard.html ${Math.round(Buffer.byteLength(html) / 1024)} KB (font ${font ? Math.round((font.length * 3) / 4 / 1024) + " KB" : "system"})`);
