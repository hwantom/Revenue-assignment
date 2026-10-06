// 한국은행 ECOS 실제 환율 받기 → data/fx_rates.json 교체
//
// 실행: ECOS_API_KEY=발급키 node tools/fetch_ecos_rates.mjs
//       node tools/clean_slips.mjs && node tools/build_dashboard.mjs
//
// 통계표 731Y001(주요국 통화의 대원화환율, 일별)에서 대시보드에 쓰는 8개 통화를 찾아
// 2025-12-26 ~ 2026-09-30 고시 값을 받는다. 항목 코드는 하드코딩하지 않고 항목명으로 찾으며,
// 이름에 "100" 이 들어간 항목(일본엔·베트남동 등)은 100단위 고시로 기록한다.
// 하나라도 찾지 못하면 파일을 바꾸지 않고 ECOS 항목명 목록을 출력한다.
// API 키 발급: https://ecos.bok.or.kr/api/ (회원가입 후 인증키 신청)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEY = process.env.ECOS_API_KEY;
const STAT = "731Y001";
const START = "20251226", END = "20260930";
const MATCH = { USD: ["미국달러"], JPY: ["일본엔"], EUR: ["유로"], CNY: ["위안"], SGD: ["싱가포르"], VND: ["베트남"], AED: ["디르함", "UAE"], BRL: ["헤알", "브라질"] };

if (!KEY) {
  console.error("ECOS_API_KEY 환경변수가 필요합니다. 예) ECOS_API_KEY=XXXX node tools/fetch_ecos_rates.mjs");
  process.exit(1);
}

async function ecos(pathPart) {
  const url = `https://ecos.bok.or.kr/api/${pathPart}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${url.replace(KEY, "***")}`);
  const body = await res.json();
  if (body.RESULT) throw new Error(`ECOS: ${body.RESULT.CODE} ${body.RESULT.MESSAGE}`);
  return body;
}

const items = (await ecos(`StatisticItemList/${KEY}/json/kr/1/500/${STAT}`)).StatisticItemList.row;
const picked = {};
for (const [ccy, words] of Object.entries(MATCH)) {
  const hit = items.find((it) => words.some((w) => it.ITEM_NAME.includes(w)));
  if (hit) picked[ccy] = { code: hit.ITEM_CODE, name: hit.ITEM_NAME, unit: /100/.test(hit.ITEM_NAME) ? 100 : 1 };
}
const missing = Object.keys(MATCH).filter((c) => !picked[c]);
if (missing.length) {
  console.error(`ECOS ${STAT} 에서 찾지 못한 통화: ${missing.join(", ")}`);
  console.error("항목명 목록:\n" + items.map((i) => `  ${i.ITEM_CODE}  ${i.ITEM_NAME}`).join("\n"));
  console.error("MATCH 의 검색어를 항목명에 맞게 고친 뒤 다시 실행하세요. fx_rates.json 은 바뀌지 않았습니다.");
  process.exit(1);
}

const rates = {};
for (const [ccy, it] of Object.entries(picked)) {
  const rows = (await ecos(`StatisticSearch/${KEY}/json/kr/1/1000/${STAT}/D/${START}/${END}/${it.code}`)).StatisticSearch.row;
  for (const r of rows) {
    const day = `${r.TIME.slice(0, 4)}-${r.TIME.slice(4, 6)}-${r.TIME.slice(6, 8)}`;
    (rates[day] ||= {})[ccy] = Number(r.DATA_VALUE);
  }
  console.log(`${ccy}  ${it.code}  ${it.name}  ${rows.length}일`);
}
const days = Object.keys(rates).sort();
const out = {
  meta: {
    source: "ECOS",
    source_label: `한국은행 ECOS ${STAT} 주요국 통화의 대원화환율`,
    note: `ECOS Open API 에서 ${new Date().toISOString().slice(0, 10)} 에 받은 일별 고시 값. 항목: ${Object.entries(picked).map(([c, i]) => `${c}=${i.code}`).join(", ")}`,
    quote_units: Object.fromEntries(Object.entries(picked).map(([c, i]) => [c, i.unit])),
    period: [days[0], days[days.length - 1]],
  },
  rates: Object.fromEntries(days.map((d) => [d, rates[d]])),
};
fs.writeFileSync(path.join(ROOT, "data", "fx_rates.json"), JSON.stringify(out) + "\n");
console.log(`data/fx_rates.json 교체 완료 (${days.length}일). 이제 clean_slips.mjs → build_dashboard.mjs 를 실행하세요.`);
