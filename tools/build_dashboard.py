"""dashboard.html 빌드 스크립트.

data/*.json 과 정제규칙.xlsx 의 규칙 시트를 HTML 안에 포함하고,
Pretendard 가변 폰트를 화면에 쓰이는 글자만 남겨 base64로 넣는다.
receipts/*.pdf 첫 페이지는 previews/*.png 미리보기로 만든다.
전표 업로드·AI 분석용 pdf.js(tools/vendor, Apache-2.0)와 시연용 신규 전표(samples/*.pdf)도 함께 넣는다.

실행 (패키지 폴더에서):
    python3 tools/build_dashboard.py --font /path/to/PretendardVariable.ttf

필요: python3, fonttools, brotli, openpyxl, Pillow, poppler-utils(pdftoppm)
"""
import argparse
import base64
import io
import json
import pathlib
import subprocess
import tempfile

import openpyxl
from fontTools import subset
from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
TEMPLATE = ROOT / "tools" / "dashboard_template.html"
PDFJS = ROOT / "tools" / "vendor" / "pdfjs-3.11.174"


def load(name):
    return json.loads((ROOT / "data" / name).read_text(encoding="utf-8"))


def read_rules():
    ws = openpyxl.load_workbook(ROOT / "정제규칙.xlsx", read_only=True)["규칙"]
    rows = list(ws.iter_rows(values_only=True))
    head = next(i for i, r in enumerate(rows) if r and r[0] == "rule_id")
    out = []
    for r in rows[head + 1:]:
        if not r or not r[0]:
            continue
        out.append({"rule_id": r[0], "target": r[1], "rule": r[2], "result": r[3], "note": r[4]})
    return out


def build_data():
    return {
        "receipts": load("clean_receipts.json"),
        "lines": load("clean_lines.json"),
        "raw": load("raw_receipts.json"),
        "profiles": load("source_profiles.json"),
        "products": load("product_master.json"),
        "log": load("cleaning_log.json"),
        "summary": load("summary.json"),
        "value_mappings": load("value_mappings.json"),
        "rules": read_rules(),
    }


def font_b64(font_path, text):
    chars = set(text)
    chars |= {chr(c) for c in range(0x20, 0x7F)}
    chars |= set("–—·…‘’“”→←×÷₩％()[]①②③")
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.notdef_outline = True
    font = subset.load_font(str(font_path), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text="".join(sorted(chars)))
    sub.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def build_previews(receipts, dpi=110):
    out_dir = ROOT / "previews"
    out_dir.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory() as tmp:
        for r in receipts:
            pdf = ROOT / r["source_file"]
            stem = pathlib.Path(tmp) / r["receipt_id"]
            subprocess.run(["pdftoppm", "-r", str(dpi), "-png", "-f", "1", "-l", "1", "-singlefile", str(pdf), str(stem)], check=True)
            img = Image.open(f"{stem}.png").convert("RGB")
            img.quantize(colors=48, method=Image.Quantize.MEDIANCUT).save(out_dir / f"{r['receipt_id']}.png", optimize=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", required=True, help="PretendardVariable.ttf 경로")
    ap.add_argument("--fragment", help="문서 골격 없이 본문 조각만 따로 저장할 경로 (선택)")
    ap.add_argument("--skip-previews", action="store_true")
    args = ap.parse_args()

    data = build_data()
    template = TEMPLATE.read_text(encoding="utf-8")
    data_js = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    body = template.replace("/*__DATA__*/", data_js, 1)
    body = body.replace("/*__FONT__*/", font_b64(args.font, template + data_js), 1)
    samples = [{"name": f.name, "b64": base64.b64encode(f.read_bytes()).decode("ascii")} for f in sorted((ROOT / "samples").glob("*.pdf"))]
    body = body.replace("/*__SAMPLES__*/", json.dumps(samples), 1)
    for marker, name in (("/*__PDFJS__*/", "pdf.min.js"), ("/*__PDFJS_WORKER__*/", "pdf.worker.min.js")):
        code = (PDFJS / name).read_text(encoding="utf-8")
        assert "</script" not in code.lower()
        body = body.replace(marker, code, 1)

    if args.fragment:
        pathlib.Path(args.fragment).write_text(body, encoding="utf-8")

    doc = (
        "<!doctype html>\n<html lang=\"ko\">\n<head>\n<meta charset=\"utf-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, viewport-fit=cover\">\n"
        + body.replace("<div class=\"page-wrap\">", "</head>\n<body>\n<div class=\"page-wrap\">", 1)
        + "\n</body>\n</html>\n"
    )
    (ROOT / "dashboard.html").write_text(doc, encoding="utf-8")

    if not args.skip_previews:
        build_previews(data["receipts"])
    print("dashboard.html", round(len(doc.encode()) / 1024), "KB")


if __name__ == "__main__":
    main()
