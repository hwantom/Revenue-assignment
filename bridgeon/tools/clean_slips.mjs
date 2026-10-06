// BridgeOn Bank — Raw 전표 자동 정제·표준화·환율 결합·수익 계산
//
// 실행: node bridgeon/tools/clean_slips.mjs
//
// 입력  raw_slips/{branch,digital,corporate}/*  (형식이 서로 다른 원본 파일)
//       data/fx_rates.json                       (기준환율: 시뮬레이션 또는 ECOS)
//       data/fee_policy.json                     (BridgeOn 가상 수수료 정책)
// 출력  data/clean_slips.json / .csv, data/cleaning_log.json, data/summary.json,
//       data/validation_report.json (truth.json 과 비교한 검증 결과)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA = path.join(ROOT, "data");
const RAW = path.join(ROOT, "raw_slips");
const load = (f) => JSON.parse(fs.readFileSync(path.join(DATA, f), "utf8"));

const DICT = load("dictionaries.json");
const POLICY = load("fee_policy.json");
const FX = load("fx_rates.json");

// ---------- 원본 파서 (시스템별 형식 감지) ----------
function parseBranch(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([^:\[]+):(.*)$/);
    if (m) out[m[1].trim()] = m[2].replace(/^ /, ""); // "항목: 값" 구분자 뒤 한 칸만 제거, 나머지 공백은 원문 그대로 보존
  }
  return out;
}
function parseCsv(text) {
  const rows = text.trim().split(/\r?\n/).map((line) => {
    const cells = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) {
        if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
        else if (c === '"') q = false;
        else cur += c;
      } else if (c === '"') q = true;
      else if (c === ",") { cells.push(cur); cur = ""; }
      else cur += c;
    }
    cells.push(cur);
    return cells;
  });
  return Object.fromEntries(rows[0].map((h, i) => [h, rows[1][i] ?? ""]));
}

// 시스템별 항목명 → 표준 필드
const FIELD_MAP = {
  BRANCH: { ref: "전표번호", date: "거래일자", service: "업무구분", customer: "고객구분", country: "상대국가", currency: "통화", amount: "거래금액", channel: "거래채널", tenor: "여신기간" },
  DIGITAL: { ref: "txn_ref", date: "ts", service: "svc", customer: "cust", country: "dest", currency: "ccy", amount: "amt", channel: "chnl" },
  CORP: { ref: "TRX_NO", date: "VALUE_DATE", service: "PRODUCT", customer: "CLIENT_TYPE", country: "CTRY", currency: "CCY", amount: "AMOUNT", channel: "CHANNEL", tenor: "TENOR" },
};

function readRawFiles() {
  const out = [];
  for (const [dir, sys, fmt] of [["branch", "BRANCH", "TXT"], ["digital", "DIGITAL", "JSON"], ["corporate", "CORP", "CSV"]]) {
    for (const f of fs.readdirSync(path.join(RAW, dir)).sort()) {
      const text = fs.readFileSync(path.join(RAW, dir, f), "utf8");
      const payload = fmt === "TXT" ? parseBranch(text) : fmt === "JSON" ? JSON.parse(text) : parseCsv(text);
      out.push({ file: `raw_slips/${dir}/${f}`, system: sys, format: fmt, text, payload });
    }
  }
  return out;
}

// ---------- 정규화 도구 ----------
const norm = (s) => String(s ?? "").normalize("NFKC").trim().replace(/\s+/g, " ");
const key = (s) => norm(s).toLowerCase().replace(/[\s.]/g, "");

// 편집거리(인접 글자 뒤바뀜을 1회로 계산하는 Damerau-Levenshtein OSA)
function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}

// 사전 조회: 정확 일치 → (공백/대소문자/마침표 무시) 일치 → 오탈자 교정(4자 이상, 편집거리 ≤1, 7자 이상이면 ≤2)
function lookup(dimension, raw) {
  const table = DICT[dimension];
  const n = norm(raw);
  for (const [code, entry] of Object.entries(table)) if (entry.aliases.includes(n)) return { code, rule: n === raw ? "DICT" : "TRIM+DICT" };
  const k = key(raw);
  for (const [code, entry] of Object.entries(table)) if (entry.aliases.some((a) => key(a) === k)) return { code, rule: "CASE+DICT" };
  let best = null;
  if (k.length >= 4)
    for (const [code, entry] of Object.entries(table))
      for (const a of entry.aliases) {
        const ka = key(a);
        if (ka.length < 4) continue;
        const d = editDistance(k, ka);
        if (d <= (Math.min(k.length, ka.length) >= 7 ? 2 : 1) && (!best || d < best.d)) best = { code, d, alias: a };
      }
  if (best) return { code: best.code, rule: "TYPO", note: `'${norm(raw)}' ≈ '${best.alias}' (편집거리 ${best.d})` };
  return null;
}

const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad = (n) => String(n).padStart(2, "0");
function parseDate(raw, system) {
  const s = norm(raw);
  let m;
  if ((m = s.match(/^(\d{4})[.\-](\d{1,2})[.\-](\d{1,2})$/))) return { value: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, pattern: "YYYY.MM.DD" };
  if ((m = s.match(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일$/))) return { value: `${m[1]}-${pad(m[2])}-${pad(m[3])}`, pattern: "YYYY년 M월 D일" };
  // 디지털 시스템은 미국식 MM/DD/YY (+시각). 다른 시스템의 슬래시 날짜는 DD/MM/YY 로 본다.
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?$/))) {
    const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
    const [mo, d] = system === "DIGITAL" ? [m[1], m[2]] : [m[2], m[1]];
    return { value: `${yy}-${pad(mo)}-${pad(d)}`, time: m[4] ? `${pad(m[4])}:${m[5]}` : null, pattern: system === "DIGITAL" ? "MM/DD/YY hh:mm" : "DD/MM/YY" };
  }
  if ((m = s.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/))) return { value: `${m[3]}-${pad(MON[m[2].toUpperCase()])}-${pad(m[1])}`, pattern: "DD-MON-YYYY" };
  return null;
}

const SYMBOL_CCY = [["S$", "SGD"], ["R$", "BRL"], ["$", "USD"], ["¥", "JPY"], ["€", "EUR"]];
function parseAmount(raw) {
  let s = norm(raw);
  let ccy = null;
  for (const [sym, c] of SYMBOL_CCY) if (s.startsWith(sym)) { ccy = c; s = s.slice(sym.length); break; }
  const tail = s.match(/\s*([A-Za-z]{3})$/);
  if (tail && !/^[KM]$/i.test(tail[1])) { ccy = tail[1].toUpperCase(); s = s.slice(0, tail.index); }
  s = s.replace(/,/g, "").trim();
  const m = s.match(/^(\d+(?:\.\d+)?)([KkMm])?$/);
  if (!m) return null;
  const mult = { k: 1e3, m: 1e6 }[(m[2] || "").toLowerCase()] || 1;
  return { value: Math.round(parseFloat(m[1]) * mult * 100) / 100, unit: m[2] ? m[2].toUpperCase() : null, ccy };
}

// ---------- 환율 결합: 거래일 당일 또는 직전 고시일 ----------
const FX_DAYS = Object.keys(FX.rates).sort();
function fxFor(date, ccy) {
  let lo = 0, hi = FX_DAYS.length - 1, best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (FX_DAYS[mid] <= date) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  for (let i = best; i >= 0; i--) {
    const q = FX.rates[FX_DAYS[i]][ccy];
    if (q != null) {
      const unit = FX.meta.quote_units[ccy] || 1;
      return { quote: q, unit, perUnit: q / unit, rateDate: FX_DAYS[i] };
    }
  }
  throw new Error(`환율 없음: ${ccy} ${date}`);
}

// ---------- 수익 계산 (BridgeOn 가상 정책) ----------
function revenue(t) {
  const P = POLICY.services[t.Service];
  const krw = t.KRW_Amount;
  const usdEq = krw / fxFor(t.Date, "USD").perUnit;
  let fee = 0, fxRev = 0, fin = 0;
  const steps = [];
  if (t.Service === "Retail FX") {
    const spread = P.cash_spread[t.Currency];
    const pref = P.preferential_rate[t.Channel];
    fxRev = krw * spread * (1 - pref);
    steps.push(`환전 스프레드 ${(spread * 100).toFixed(2)}% × (1 − 우대율 ${(pref * 100).toFixed(0)}%)`);
  } else if (t.Service === "Overseas Remittance") {
    const tier = P.fee_tiers_usd.find((x) => usdEq <= x.max_usd) || P.fee_tiers_usd[P.fee_tiers_usd.length - 1];
    const branch = t.Channel === "Branch";
    const sendFee = branch ? tier.branch_krw : tier.digital_krw;
    const cable = branch ? P.cable_charge.branch_krw : P.cable_charge.digital_krw;
    fee = sendFee + cable;
    const pref = P.preferential_rate[t.Channel];
    fxRev = krw * P.fx_spread * (1 - pref);
    steps.push(`송금수수료 ${sendFee.toLocaleString()}원 (USD ${Math.round(usdEq).toLocaleString()} 구간) + 전신료 ${cable.toLocaleString()}원`);
    steps.push(`송금 환율 스프레드 ${(P.fx_spread * 100).toFixed(2)}% × (1 − 우대율 ${(pref * 100).toFixed(0)}%)`);
  } else if (t.Service === "Corporate FX") {
    const sp = P.spread[t.Channel];
    fxRev = krw * sp;
    steps.push(`기업 외환 스프레드 ${(sp * 100).toFixed(2)}% (${t.Channel})`);
  } else {
    fee = Math.max(P.fee_rate * krw, P.min_fee_krw);
    fin = krw * P.annual_margin * (t.Tenor_Days / 365);
    steps.push(`L/C·매입 수수료 ${(P.fee_rate * 100).toFixed(2)}% (최저 ${P.min_fee_krw.toLocaleString()}원)`);
    steps.push(`금융수익 연 ${(P.annual_margin * 100).toFixed(2)}% × ${t.Tenor_Days}일/365`);
  }
  const r = (v) => Math.round(v);
  return { USD_Equivalent: Math.round(usdEq * 100) / 100, Fee: r(fee), FX_Revenue: r(fxRev), Finance_Revenue: r(fin), Total_Revenue: r(fee) + r(fxRev) + r(fin), Revenue_Steps: steps };
}

// ---------- 메인 파이프라인 ----------
function main() {
  const raws = readRawFiles();
  const log = [];
  const issues = [];
  const stages = { collected: raws.length };

  // 2. 형식 감지
  const detected = {};
  for (const r of raws) detected[`${r.system}/${r.format}`] = (detected[`${r.system}/${r.format}`] || 0) + 1;

  // 3. 중복 제거: 같은 시스템·같은 원천 참조번호·같은 내용이면 재전송으로 판단
  const seen = new Map();
  const unique = [];
  const duplicates = [];
  for (const r of raws) {
    const ref = norm(r.payload[FIELD_MAP[r.system].ref]);
    const sig = `${r.system}|${ref}|${JSON.stringify(r.payload)}`;
    if (seen.has(sig)) { duplicates.push({ file: r.file, duplicate_of: seen.get(sig).file, ref }); continue; }
    seen.set(sig, r);
    unique.push(r);
  }
  stages.deduplicated = unique.length;

  const rows = [];
  for (const r of unique) {
    const F = FIELD_MAP[r.system];
    const get = (f) => (F[f] ? r.payload[F[f]] : undefined);
    const raw = {};
    for (const f of Object.keys(F)) if (get(f) !== undefined) raw[f] = get(f);
    const change = (field, from, to, rule, note) => {
      if (String(from) !== String(to)) log.push({ file: r.file, system: r.system, field, raw: from, clean: to, rule, note: note || "" });
    };

    const d = parseDate(get("date"), r.system);
    if (!d) { issues.push({ file: r.file, field: "date", raw: get("date") }); continue; }
    change("Date", get("date"), d.value, "R01_DATE", d.pattern);

    const dims = {};
    for (const [field, dim, rule, std] of [["service", "service", "R02_SERVICE", "Service"], ["customer", "customer_type", "R03_CUSTOMER", "Customer_Type"], ["country", "country", "R04_COUNTRY", "Country"], ["channel", "channel", "R05_CHANNEL", "Channel"]]) {
      const hit = lookup(dim, get(field));
      if (!hit) { issues.push({ file: r.file, field, raw: get(field) }); continue; }
      dims[field] = hit.code;
      const label = DICT[dim][hit.code].label;
      change(std, get(field), label, hit.rule === "TYPO" ? "R08_TYPO" : rule, hit.note || (hit.rule !== "DICT" ? "공백·대소문자 정규화 후 사전 매칭" : ""));
    }
    const amt = parseAmount(get("amount"));
    if (!amt) { issues.push({ file: r.file, field: "amount", raw: get("amount") }); continue; }
    // 통화: 통화 칸 우선, 금액 칸 기호/코드와 충돌하면 오류로 기록
    const ccyHit = lookup("currency", get("currency"));
    if (!ccyHit) { issues.push({ file: r.file, field: "currency", raw: get("currency") }); continue; }
    if (amt.ccy && amt.ccy !== ccyHit.code) issues.push({ file: r.file, field: "currency", raw: `${get("currency")} vs ${get("amount")}`, note: "통화 칸과 금액 기호 불일치" });
    change("Currency", get("currency"), ccyHit.code, ccyHit.rule === "TYPO" ? "R08_TYPO" : "R06_CURRENCY", ccyHit.rule !== "DICT" ? "공백·대소문자 정규화 후 사전 매칭" : "");
    change("Foreign_Amount", get("amount"), amt.value, "R07_AMOUNT", [amt.unit && `${amt.unit} 단위 전개`, amt.ccy && "통화기호/코드 분리", /,/.test(get("amount")) && "천단위 쉼표 제거"].filter(Boolean).join(", "));
    const tenorRaw = get("tenor");
    const tenor = tenorRaw && norm(tenorRaw) ? parseInt(norm(tenorRaw), 10) : null;
    if (tenorRaw && norm(tenorRaw)) change("Tenor_Days", tenorRaw, tenor, "R07_AMOUNT", "기간 단위(일/D) 제거");
    if (Object.keys(dims).length < 4) continue;

    const fx = fxFor(d.value, ccyHit.code);
    const t = {
      Date: d.value,
      Service: DICT.service[dims.service].label,
      Customer_Type: DICT.customer_type[dims.customer].label,
      Country: DICT.country[dims.country].label,
      Country_Code: dims.country,
      Currency: ccyHit.code,
      Channel: DICT.channel[dims.channel].label,
      Foreign_Amount: amt.value,
      FX_Rate: Math.round(fx.perUnit * 10000) / 10000,
      FX_Quote: fx.quote,
      FX_Quote_Unit: fx.unit,
      FX_Rate_Date: fx.rateDate,
      KRW_Amount: Math.round(amt.value * fx.perUnit),
      Tenor_Days: tenor,
      Source_System: r.system,
      Source_Format: r.format,
      Source_File: r.file,
      Source_Ref: norm(get("ref")),
      Raw: raw,
    };
    if (fx.rateDate !== d.value) log.push({ file: r.file, system: r.system, field: "FX_Rate_Date", raw: d.value, clean: fx.rateDate, rule: "R09_FX_JOIN", note: "비영업일 거래 → 직전 고시일 환율 적용" });
    rows.push(Object.assign(t, revenue(t)));
  }
  stages.standardized = rows.length;
  stages.fx_joined = rows.filter((r) => r.FX_Rate > 0).length;

  // 표준 거래번호: 거래일 순 일련번호
  rows.sort((a, b) => a.Date.localeCompare(b.Date) || a.Source_File.localeCompare(b.Source_File));
  rows.forEach((r, i) => {
    const [y, m, d] = r.Date.split("-");
    r.Transaction_ID = `FX-${y.slice(2)}${m}${d}-${String(i + 1).padStart(3, "0")}`;
    r.Month = r.Date.slice(0, 7);
    r.Revenue_Rate = Math.round((r.Total_Revenue / r.KRW_Amount) * 1e6) / 1e4;
  });
  const idByFile = Object.fromEntries(rows.map((r) => [r.Source_File, r.Transaction_ID]));
  for (const l of log) l.Transaction_ID = idByFile[l.file] || null;

  const ORDER = ["Transaction_ID", "Date", "Month", "Service", "Customer_Type", "Country", "Country_Code", "Currency", "Channel", "Foreign_Amount", "FX_Rate", "FX_Quote", "FX_Quote_Unit", "FX_Rate_Date", "KRW_Amount", "USD_Equivalent", "Fee", "FX_Revenue", "Finance_Revenue", "Total_Revenue", "Revenue_Rate", "Tenor_Days", "Source_System", "Source_Format", "Source_File", "Source_Ref", "Revenue_Steps", "Raw"];
  const clean = rows.map((r) => Object.fromEntries(ORDER.map((k) => [k, r[k]])));

  // ---------- 검증: truth.json 과 대조 (정제 로직은 truth 를 보지 않음) ----------
  const truth = fs.existsSync(path.join(DATA, "truth.json")) ? load("truth.json") : [];
  const SVC = { RFX: "Retail FX", REM: "Overseas Remittance", CFX: "Corporate FX", TF: "Trade Finance" };
  const mismatches = [];
  for (const t of truth) {
    const c = clean.find((x) => x.Source_File === t.source_file);
    if (!c) { mismatches.push({ source_file: t.source_file, field: "*", note: "정제 결과 없음" }); continue; }
    const expect = { Date: t.date, Service: SVC[t.service], Customer_Type: DICT.customer_type[t.customer_type].label, Country_Code: t.country, Currency: t.currency, Channel: DICT.channel[t.channel].label, Foreign_Amount: t.foreign_amount, Tenor_Days: t.tenor_days };
    for (const [k, v] of Object.entries(expect)) if (c[k] !== v) mismatches.push({ source_file: t.source_file, field: k, expected: v, got: c[k] });
  }
  const sum = (f) => clean.reduce((s, r) => s + r[f], 0);
  const validation = {
    raw_files: raws.length,
    duplicates_removed: duplicates.length,
    clean_rows: clean.length,
    parse_issues: issues,
    truth_rows: truth.length,
    truth_mismatches: mismatches,
    revenue_identity_ok: clean.every((r) => r.Total_Revenue === r.Fee + r.FX_Revenue + r.Finance_Revenue),
    krw_identity_ok: clean.every((r) => Math.abs(r.KRW_Amount - r.Foreign_Amount * r.FX_Rate) <= Math.max(1, r.KRW_Amount * 1e-6)),
    passed: clean.length === 100 && mismatches.length === 0 && issues.length === 0,
  };

  const summary = {
    transactions: clean.length,
    total_krw: sum("KRW_Amount"),
    total_revenue: sum("Total_Revenue"),
    fee: sum("Fee"),
    fx_revenue: sum("FX_Revenue"),
    finance_revenue: sum("Finance_Revenue"),
    avg_krw: Math.round(sum("KRW_Amount") / clean.length),
    fx_source: FX.meta.source,
    fx_source_label: FX.meta.source_label,
    period: [clean[0].Date, clean[clean.length - 1].Date],
    pipeline: { ...stages, detected_formats: detected, changes_logged: log.length, duplicates },
  };

  fs.writeFileSync(path.join(DATA, "clean_slips.json"), JSON.stringify(clean, null, 1) + "\n");
  const CSV_COLS = ORDER.filter((k) => !["Raw", "Revenue_Steps"].includes(k));
  const csv = [CSV_COLS.join(","), ...clean.map((r) => CSV_COLS.map((k) => (r[k] == null ? "" : /[",]/.test(String(r[k])) ? `"${String(r[k]).replace(/"/g, '""')}"` : r[k])).join(","))].join("\r\n");
  fs.writeFileSync(path.join(DATA, "clean_slips.csv"), "﻿" + csv + "\r\n");
  fs.writeFileSync(path.join(DATA, "cleaning_log.json"), JSON.stringify(log, null, 1) + "\n");
  fs.writeFileSync(path.join(DATA, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
  fs.writeFileSync(path.join(DATA, "validation_report.json"), JSON.stringify(validation, null, 2) + "\n");
  // 대시보드용 원본 텍스트 묶음
  fs.writeFileSync(path.join(DATA, "raw_slips.json"), JSON.stringify(raws.map(({ file, system, format, text }) => ({ file, system, format, text, transaction_id: idByFile[file] || null, duplicate: !idByFile[file] }))) + "\n");

  console.log(`raw ${raws.length} → dedup ${unique.length} → clean ${clean.length}; changes ${log.length}; issues ${issues.length}; truth mismatches ${mismatches.length}`);
  console.log(`거래액 ${summary.total_krw.toLocaleString()}원, 수익 ${summary.total_revenue.toLocaleString()}원 (${((summary.total_revenue / summary.total_krw) * 100).toFixed(3)}%)`);
  if (!validation.passed) { console.error(JSON.stringify({ issues, mismatches: mismatches.slice(0, 10) }, null, 1)); process.exitCode = 1; }
}

main();
