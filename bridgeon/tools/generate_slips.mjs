// BridgeOn Bank — 시뮬레이션 거래전표 100건 + 기준환율 생성기
//
// 실행: node bridgeon/tools/generate_slips.mjs
//
// 1) 분석 스토리(일본 7~8월 급증, USD 편중, 모바일 성장, 기업 고액화)에 맞춰
//    정답(truth) 거래 100건을 고정 시드로 만든다.
// 2) 같은 거래를 세 원천 시스템(영업점 / 디지털 / 기업뱅킹)의 서로 다른
//    표기·파일 형식으로 내보낸다. 공백·대소문자·오탈자·재전송 중복을 일부 주입한다.
// 3) 실제 ECOS 환율을 받기 전까지 쓸 시뮬레이션 기준환율(fx_rates.json)을 만든다.
//    fetch_ecos_rates.mjs 로 실제 환율을 받으면 이 파일이 교체된다.
//
// truth.json 은 정제 결과 검증용이며, clean_slips.mjs 는 이 파일을 읽지 않는다.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const RAW = path.join(ROOT, "raw_slips");

// ---------- 결정적 난수 ----------
let seed = 20261006;
function rnd() {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
function weighted(obj) {
  const entries = Object.entries(obj);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [k, w] of entries) if ((r -= w) < 0) return k;
  return entries[entries.length - 1][0];
}
const logUniform = (lo, hi) => Math.exp(Math.log(lo) + rnd() * (Math.log(hi) - Math.log(lo)));
function shuffle(a) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ---------- 시뮬레이션 기준환율 ----------
// 원화 / 외화 1단위. JPY·VND 는 ECOS 표기와 같이 100단위로 고시한다.
const FX_ANCHOR = { USD: 1452, JPY: 935, EUR: 1688, CNY: 204.5, SGD: 1118, VND: 5.52, AED: 395.3, BRL: 266 };
const FX_UNIT = { USD: 1, JPY: 100, EUR: 1, CNY: 1, SGD: 1, VND: 100, AED: 1, BRL: 1 };
const FX_DRIFT = { USD: -0.00012, JPY: 0.0002, EUR: 0.00005, CNY: -0.00005, SGD: 0, VND: -0.0001, AED: -0.00012, BRL: 0.0001 };

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
function buildFx() {
  const days = [];
  for (let d = new Date(Date.UTC(2025, 11, 26)); d <= new Date(Date.UTC(2026, 8, 30)); d.setUTCDate(d.getUTCDate() + 1)) {
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) days.push(isoDate(d));
  }
  const level = { ...FX_ANCHOR };
  const rates = {};
  for (const day of days) {
    rates[day] = {};
    for (const c of Object.keys(level)) {
      const shock = (rnd() - 0.5) * 0.0085;
      level[c] = level[c] * (1 + FX_DRIFT[c] + shock);
      // AED 는 USD 고정환율(3.6725)에 묶여 있으므로 USD에서 파생
      const v = c === "AED" ? level.USD / 3.6725 : level[c];
      rates[day][c] = Math.round(v * 100) / 100;
    }
  }
  return {
    meta: {
      source: "SIMULATED",
      source_label: "시뮬레이션 기준환율 (ECOS 연결 전 임시값)",
      note: "실제 환율이 아닙니다. tools/fetch_ecos_rates.mjs 에 ECOS API 키를 넣어 실행하면 한국은행 ECOS 731Y001(주요국 통화의 대원화환율) 실제 값으로 교체됩니다.",
      quote_units: FX_UNIT,
      period: [days[0], days[days.length - 1]],
    },
    rates,
  };
}

// ---------- 거래 설계 ----------
const MONTH_WEIGHTS = [8, 9, 10, 10, 11, 11, 14, 15, 12]; // 1~9월, 합 100
const SERVICES = { RFX: 25, REM: 30, CFX: 25, TF: 20 };

const COUNTRY_W = {
  RFX: { JP: 30, US: 25, VN: 10, CN: 10, FR: 10, SG: 7, AE: 4, BR: 4 },
  REM: { US: 22, VN: 20, CN: 16, JP: 14, FR: 8, BR: 7, SG: 7, AE: 6 },
  CFX: { US: 30, CN: 15, JP: 12, BR: 12, SG: 10, AE: 9, FR: 8, VN: 4 },
  TF: { US: 25, CN: 20, VN: 15, BR: 12, AE: 10, JP: 8, FR: 5, SG: 5 },
};
// 국가별 통화 선택 가중치(서비스별). 브라질·UAE·베트남 기업거래는 USD 결제가 많다.
function currencyFor(svc, ctry, cust) {
  const local = { US: "USD", JP: "JPY", CN: "CNY", VN: "VND", BR: "BRL", SG: "SGD", FR: "EUR", AE: "AED" }[ctry];
  if (svc === "RFX") return ctry === "BR" ? "USD" : local;
  if (svc === "REM") {
    if (ctry === "VN") return weighted({ USD: 55, VND: 45 });
    if (ctry === "BR") return weighted({ USD: 70, BRL: 30 });
    if (ctry === "AE") return weighted({ USD: 60, AED: 40 });
    if (ctry === "SG") return weighted({ SGD: 60, USD: 40 });
    return local;
  }
  // CFX, TF
  if (["US", "BR", "AE", "VN"].includes(ctry)) return ctry === "US" ? "USD" : weighted({ USD: 80, [local]: 20 });
  if (ctry === "CN") return weighted({ USD: 50, CNY: 50 });
  if (ctry === "SG") return weighted({ USD: 60, SGD: 40 });
  if (ctry === "JP") return weighted({ JPY: 75, USD: 25 });
  return weighted({ EUR: 80, USD: 20 });
}
function customerFor(svc) {
  if (svc === "RFX") return weighted({ Individual: 62, Foreigner: 38 });
  if (svc === "REM") return weighted({ Individual: 44, Foreigner: 36, Corporate: 20 });
  return "Corporate";
}
function channelFor(cust, month) {
  if (cust === "Corporate") return weighted({ "Corporate Banking": 74, Branch: 26 });
  const mobile = 0.3 + 0.055 * (month - 1); // 1월 30% → 9월 74%
  const r = rnd();
  if (r < mobile) return "Mobile";
  return rnd() < 0.4 ? "Internet Banking" : "Branch";
}
function usdRange(svc, cust) {
  if (svc === "RFX") return [200, 4000];
  if (svc === "REM") return cust === "Corporate" ? [8000, 60000] : [300, 8000];
  if (svc === "CFX") return [50000, 1200000];
  return [150000, 2500000];
}
function roundAmount(v, ccy, svc) {
  const step = {
    JPY: svc === "RFX" || svc === "REM" ? 1000 : 100000,
    VND: 100000,
  }[ccy] ?? (svc === "RFX" ? 10 : svc === "REM" ? 50 : 1000);
  return Math.max(step, Math.round(v / step) * step);
}
function randomDay(year, month, weekdaysOnly) {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  for (;;) {
    const d = 1 + Math.floor(rnd() * last);
    const date = new Date(Date.UTC(year, month - 1, d));
    const wd = date.getUTCDay();
    if (weekdaysOnly && (wd === 0 || wd === 6)) continue;
    return isoDate(date);
  }
}

function buildTruth(fx) {
  const months = shuffle(MONTH_WEIGHTS.flatMap((n, i) => Array(n).fill(i + 1)));
  const services = shuffle(Object.entries(SERVICES).flatMap(([k, n]) => Array(n).fill(k)));
  const rows = [];
  for (let i = 0; i < 100; i++) {
    const svc = services[i];
    const month = months[i];
    const weights = { ...COUNTRY_W[svc] };
    // 일본 거래 급증: 7~8월 개인 환전·송금에서 일본 비중 확대
    if ((month === 7 || month === 8) && (svc === "RFX" || svc === "REM")) weights.JP *= 6;
    if ((month === 7 || month === 8) && svc === "CFX") weights.JP *= 2.5;
    const ctry = weighted(weights);
    const cust = customerFor(svc);
    const ccy = currencyFor(svc, ctry, cust);
    const channel = channelFor(cust, month);
    const date = randomDay(2026, month, channel === "Branch" || cust === "Corporate");
    const [lo, hi] = usdRange(svc, cust);
    const usd = logUniform(lo, hi);
    const usdKrw = FX_ANCHOR.USD;
    const perUnit = FX_ANCHOR[ccy] / FX_UNIT[ccy];
    const amount = roundAmount((usd * usdKrw) / perUnit, ccy, svc);
    rows.push({
      date, service: svc, customer_type: cust, country: ctry, currency: ccy, channel, foreign_amount: amount,
      tenor_days: svc === "TF" ? pick([30, 60, 90, 90, 120, 180]) : null,
    });
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.service.localeCompare(b.service));
  rows.forEach((r, i) => (r.seq = i + 1));
  return rows;
}

// ---------- 원천 시스템별 원본 표기 ----------
const SYS_OF = (r) => (r.channel === "Branch" ? "BRANCH" : r.channel === "Corporate Banking" ? "CORP" : "DIGITAL");

const KR = {
  country: { US: ["미국", "미국", "미 국"], JP: ["일본", "일본", "日本"], CN: ["중국", "중국"], VN: ["베트남", "월남"], BR: ["브라질"], SG: ["싱가포르", "싱가폴"], FR: ["프랑스", "불란서"], AE: ["아랍에미리트", "UAE"] },
  ccy: { USD: ["USD", "미달러", "USD"], JPY: ["JPY", "엔화", "JPY"], CNY: ["CNY", "위안화"], VND: ["VND", "동"], BRL: ["BRL", "헤알"], SGD: ["SGD", "싱가포르달러"], EUR: ["EUR", "유로"], AED: ["AED", "디르함"] },
  service: { RFX: ["환전", "외화환전"], REM: ["해외송금", "당발송금"], CFX: ["외환매매", "기업외환"], TF: ["무역금융", "수입L/C"] },
  cust: { Individual: ["개인"], Foreigner: ["외국인", "개인(외국인)"], Corporate: ["법인", "기업"] },
};
const DIG = {
  country: { US: ["USA", "United States", "U.S."], JP: ["Japan", "JP", "japan"], CN: ["China", "CN"], VN: ["Vietnam", "Viet Nam", "VN"], BR: ["Brazil", "Brasil"], SG: ["Singapore", "SG"], FR: ["France", "FR"], AE: ["UAE", "U.A.E.", "United Arab Emirates"] },
  ccy: { USD: ["US Dollar", "$", "usd"], JPY: ["Yen", "¥", "JPY"], CNY: ["Yuan", "RMB", "CNY"], VND: ["Dong", "VND"], BRL: ["Real", "R$"], SGD: ["S$", "SGD"], EUR: ["Euro", "€"], AED: ["Dirham", "AED"] },
  service: { RFX: ["FX_EXCHANGE", "Currency Exchange", "exchange"], REM: ["REMIT", "Remittance", "Overseas Transfer"] },
  cust: { Individual: ["Personal", "personal", "INDIV"], Foreigner: ["Foreigner", "Non-resident", "FRGN"], Corporate: ["Biz", "Business"] },
  channel: { Mobile: ["APP", "Mobile Banking", "app"], "Internet Banking": ["WEB", "Internet Banking", "IB-Retail"] },
  // 사용자 입력 오탈자: 일부 전표에만 낮은 확률로 섞인다.
  typo: { US: "Untied States", JP: "Japn", SG: "Singapur", VN: "Vietnma", FR: "Frnace", CN: "Chian" },
};
const CORP = {
  country: { US: ["US", "United States", "USA"], JP: ["JP", "JAPAN"], CN: ["CN", "PRC", "CHINA"], VN: ["VN", "VIETNAM"], BR: ["BR", "BRAZIL"], SG: ["SG", "SINGAPORE"], FR: ["FR", "FRANCE"], AE: ["AE", "UAE"] },
  ccy: { USD: ["USD"], JPY: ["JPY"], CNY: ["RMB", "CNH", "CNY"], VND: ["VND"], BRL: ["BRL"], SGD: ["SGD"], EUR: ["EUR"], AED: ["AED"] },
  service: { REM: ["REMIT", "OUTWARD TT"], CFX: ["FX", "FX SPOT", "FX FWD"], TF: ["TRADE FIN", "L/C", "IMPORT LC"] },
  cust: { Corporate: ["CORP", "Corp.", "CORPORATE"] },
  channel: ["CMS", "IB", "CMS"],
};
const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const SYMBOL = { USD: "$", JPY: "¥", EUR: "€", SGD: "S$", BRL: "R$" };
const BRANCHES = ["강남지점", "명동지점", "여의도지점", "안산외국인센터", "부산중앙지점", "구로디지털지점"];

function compact(n) {
  if (n >= 1e6 && (n / 1e6) * 100 === Math.round((n / 1e6) * 100)) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3 && (n / 1e3) * 10 === Math.round((n / 1e3) * 10)) return `${+(n / 1e3).toFixed(1)}K`;
  return String(n);
}
const commas = (n) => n.toLocaleString("en-US");

function renderBranch(r) {
  const [y, m, d] = r.date.split("-");
  const dateStr = pick([`${y}.${m}.${d}`, `${y}.${+m}.${+d}`, `${y}년 ${+m}월 ${+d}일`]);
  const amount = pick([commas(r.foreign_amount), `${commas(r.foreign_amount)}.00`, String(r.foreign_amount)]);
  const branch = pick(BRANCHES);
  const lines = {
    전표번호: `${branch.slice(0, 2)}-${m}${d}-${String(r.seq).padStart(2, "0")}`,
    거래일자: dateStr,
    취급점: branch,
    업무구분: pick(KR.service[r.service]),
    고객구분: pick(KR.cust[r.customer_type]),
    상대국가: pick(KR.country[r.country]),
    통화: pick(KR.ccy[r.currency]),
    거래금액: rnd() < 0.15 ? ` ${amount} ` : amount,
    거래채널: "창구",
  };
  if (r.tenor_days) lines["여신기간"] = `${r.tenor_days}일`;
  return lines;
}
function renderDigital(r) {
  const [y, m, d] = r.date.split("-");
  const hh = String(8 + Math.floor(rnd() * 14)).padStart(2, "0");
  const mm = String(Math.floor(rnd() * 60)).padStart(2, "0");
  const sym = SYMBOL[r.currency];
  const style = rnd();
  let amt;
  if (sym && style < 0.4) amt = `${sym}${compact(r.foreign_amount)}`;
  else if (style < 0.75) amt = `${commas(r.foreign_amount)} ${r.currency}`;
  else amt = compact(r.foreign_amount);
  return {
    txn_ref: `${r.channel === "Mobile" ? "APP" : "WEB"}${y.slice(2)}${m}${d}${String(1000 + r.seq * 7).slice(-4)}`,
    ts: `${m}/${d}/${y.slice(2)} ${hh}:${mm}`,
    svc: pick(DIG.service[r.service]),
    cust: pick(DIG.cust[r.customer_type]),
    dest: DIG.typo[r.country] && rnd() < 0.2 ? DIG.typo[r.country] : rnd() < 0.12 ? `  ${pick(DIG.country[r.country])}` : pick(DIG.country[r.country]),
    ccy: pick(DIG.ccy[r.currency]),
    amt,
    chnl: pick(DIG.channel[r.channel]),
  };
}
function renderCorp(r) {
  const [y, m, d] = r.date.split("-");
  const n = r.foreign_amount;
  return {
    TRX_NO: `CMS/${y.slice(2)}/${String(100000 + r.seq * 37).slice(-6)}`,
    VALUE_DATE: `${d}-${MON[+m - 1]}-${y}`,
    PRODUCT: pick(CORP.service[r.service]),
    CLIENT_TYPE: pick(CORP.cust.Corporate),
    CTRY: pick(CORP.country[r.country]),
    CCY: pick(CORP.ccy[r.currency]),
    AMOUNT: rnd() < 0.55 ? compact(n) : String(n),
    CHANNEL: pick(CORP.channel),
    TENOR: r.tenor_days ? `${r.tenor_days}D` : "",
  };
}

// 영업점 고객이 법인일 때(기업 고객 창구거래)도 영업점 시스템 형식으로 기록된다.
function csvRow(values) {
  return values.map((v) => (/[",\n]/.test(v) ? `"${String(v).replace(/"/g, '""')}"` : v)).join(",");
}

function main() {
  const fx = buildFx();
  const truth = buildTruth(fx);

  fs.rmSync(RAW, { recursive: true, force: true });
  for (const s of ["branch", "digital", "corporate"]) fs.mkdirSync(path.join(RAW, s), { recursive: true });

  const counters = { BRANCH: 0, DIGITAL: 0, CORP: 0 };
  const files = [];
  for (const r of truth) {
    const sys = SYS_OF(r);
    const no = String(++counters[sys]).padStart(3, "0");
    let rel;
    if (sys === "BRANCH") {
      const lines = renderBranch(r);
      rel = `branch/BR_${no}.txt`;
      const body = ["[BridgeOn Bank 영업점 외환거래 전표]", ...Object.entries(lines).map(([k, v]) => `${k}: ${v}`), ""].join("\n");
      fs.writeFileSync(path.join(RAW, rel), body);
    } else if (sys === "DIGITAL") {
      rel = `digital/DG_${no}.json`;
      fs.writeFileSync(path.join(RAW, rel), JSON.stringify(renderDigital(r), null, 2) + "\n");
    } else {
      rel = `corporate/CB_${no}.csv`;
      const row = renderCorp(r);
      fs.writeFileSync(path.join(RAW, rel), csvRow(Object.keys(row)) + "\n" + csvRow(Object.values(row)) + "\n");
    }
    r.source_file = `raw_slips/${rel}`;
    files.push(rel);
  }

  // 재전송 중복 3건: 디지털 시스템이 같은 거래를 다른 파일명으로 한 번 더 보낸 경우
  const digital = truth.filter((r) => SYS_OF(r) === "DIGITAL");
  const dupTargets = [digital[5], digital[19], digital[33]].filter(Boolean);
  for (const r of dupTargets) {
    const src = path.join(ROOT, r.source_file);
    const no = String(++counters.DIGITAL).padStart(3, "0");
    const rel = `digital/DG_${no}_resend.json`;
    fs.copyFileSync(src, path.join(RAW, rel));
  }

  const truthOut = truth.map(({ seq, ...r }) => ({ seq, ...r }));
  fs.writeFileSync(path.join(DATA, "truth.json"), JSON.stringify(truthOut, null, 1) + "\n");
  // ECOS 실제 환율로 교체된 파일은 덮어쓰지 않는다.
  const fxPath = path.join(DATA, "fx_rates.json");
  const existing = fs.existsSync(fxPath) ? JSON.parse(fs.readFileSync(fxPath, "utf8")) : null;
  if (!existing || existing.meta?.source === "SIMULATED") fs.writeFileSync(fxPath, JSON.stringify(fx) + "\n");

  console.log(`slips: ${truth.length}, raw files: ${files.length + dupTargets.length}`, counters);
}

main();
