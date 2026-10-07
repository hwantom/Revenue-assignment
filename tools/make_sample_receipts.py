"""AI 업로드 시연용 신규 전표 PDF 3장 생성 (R101–R103, 2026-09-30 마감 후 추가분).

원본 전표(receipts/)와 같은 레이아웃·형식(POS_B/C/E)으로 만들며, 대시보드의
'전표 올리기' 또는 Google Drive 폴더에 넣어 자동 분석을 확인하는 데 씁니다.

실행: python3 tools/make_sample_receipts.py --font-dir /경로/Pretendard(ttf)
필요: reportlab
"""
import argparse
import pathlib

from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

ROOT = pathlib.Path(__file__).resolve().parent.parent
W, H = 370, 765

SAMPLES = [
    {"id": "R101", "profile": "POS_B", "store": "ONDAM CAFE",
     "head": [("Date", "09/30/2026"), ("Time", "06:12 PM"), ("Payment", "CARD")],
     "item_head": ("Item", "Amount"), "labels": ("Category", "Qty", "Price", "Discount"),
     "items": [("ICE AMERICANO", "Coffee", "2", "₩4,500", "₩0", "₩9,000"),
               ("CROISSANT", "Bakery", "1", "₩4,000", "₩0", "₩4,000")],
     "total": ("Total", "₩13,000")},
    {"id": "R102", "profile": "POS_C", "store": "온담 카페",
     "head": [("판매일자", "2026.09.30"), ("판매시각", "18시 40분"), ("지불방식", "카카오페이")],
     "item_head": ("품목", "실결제액"), "labels": ("분류", "개수", "판매단가", "품목할인"),
     "items": [("카페라떼", "음료-커피", "1개", "5,000원", "0원", "5,000원"),
               ("치즈케이크", "디저트", "1개", "6,500원", "500원", "6,000원"),
               ("얼그레이티", "차", "1개", "4,500원", "0원", "4,500원")],
     "total": ("최종금액", "15,500원")},
    {"id": "R103", "profile": "POS_E", "store": "ONDAM CAFE",
     "head": [("Sale Date", "30 Sep 2026"), ("Sale Time", "19:05:00"), ("Tender", "현금")],
     "item_head": ("Product", "Net"), "labels": ("Group", "Count", "Unit Price", "Rebate"),
     "items": [("VANILLA LATTE", "Beverage", "2", "KRW 5500", "KRW 0", "KRW 11000")],
     "total": ("Paid", "KRW 11000")},
]


def draw(c, s):
    R, B = "Pretendard", "Pretendard-Bold"
    c.setFont(B, 15); c.drawString(24, 728, "ONDAM CAFE")
    c.setFont(R, 10); c.drawString(24, 707, s["store"])
    c.setFont(B, 12); c.drawRightString(346, 729, s["id"])
    c.setFont(R, 8); c.drawRightString(346, 709, s["profile"])
    c.setFillGray(0.92); c.rect(24, 676, 322, 16, stroke=0, fill=1); c.setFillGray(0)
    c.setFont(R, 8); c.drawString(34, 682, "교육용 가상 매출전표 · 실제 결제 증빙 아님")
    y = 654
    for k, v in s["head"]:
        c.setFont(R, 9); c.drawString(24, y, k); c.drawRightString(346, y, v); y -= 19
    y -= 18
    c.setFont(B, 9); c.drawString(24, y, s["item_head"][0]); c.drawRightString(346, y, s["item_head"][1])
    y -= 20
    lc, lq, lp, ld = s["labels"]
    for i, (name, cat, qty, price, disc, amt) in enumerate(s["items"], 1):
        c.setFont(B, 9); c.drawString(24, y, f"{i:02d} {name}")
        c.setFont(R, 8); c.drawString(36, y - 19, f"{lc}: {cat}")
        c.drawString(36, y - 36, f"{lq}: {qty}"); c.drawRightString(346, y - 36, f"{lp}: {price}")
        c.drawString(36, y - 53, f"{ld}: {disc}")
        c.setFont(B, 9); c.drawRightString(346, y - 70, amt)
        y -= 100
    y += 5
    c.setFont(B, 11); c.drawString(24, y, s["total"][0]); c.drawRightString(346, y, s["total"][1])
    c.setFont(R, 7.5)
    c.drawString(24, y - 26, "모든 금액은 KRW · 부가세 포함 설정")
    c.drawString(24, y - 41, "할인은 품목별 금액에 반영되어 있습니다.")
    c.drawString(24, 35, "매장·거래·상품 구성은 과제용으로 생성했습니다.")
    c.drawString(24, 21, "작성자 민승환 | 생성 기준: 2026년 9월 (추가 전표)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--font-dir", required=True, help="Pretendard-Regular.ttf / Pretendard-Bold.ttf 폴더")
    args = ap.parse_args()
    fd = pathlib.Path(args.font_dir)
    pdfmetrics.registerFont(TTFont("Pretendard", str(fd / "Pretendard-Regular.ttf")))
    pdfmetrics.registerFont(TTFont("Pretendard-Bold", str(fd / "Pretendard-Bold.ttf")))
    out = ROOT / "samples"
    out.mkdir(exist_ok=True)
    for s in SAMPLES:
        c = canvas.Canvas(str(out / f"{s['id']}.pdf"), pagesize=(W, H))
        c.setTitle(f"{s['id']} 추가 매출전표"); c.setAuthor("민승환")
        draw(c, s); c.showPage(); c.save()
        print(out / f"{s['id']}.pdf")


if __name__ == "__main__":
    main()
