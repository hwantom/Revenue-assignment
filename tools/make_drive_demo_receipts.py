"""Google Drive 자동 분석 시연용 소형 전표 PDF (R104–R105, POS_E 형식, 기본 글꼴만 사용).

커넥터로 올릴 수 있게 글꼴을 넣지 않은 2~3KB 크기로 만든다.
실행: python3 tools/make_drive_demo_receipts.py   (필요: reportlab)
"""
import pathlib

from reportlab.pdfgen import canvas

ROOT = pathlib.Path(__file__).resolve().parent.parent
W, H = 370, 765
SAMPLES = [
    {"id": "R104", "date": "30 Sep 2026", "time": "19:40:00", "tender": "CARD",
     "items": [("CAFE LATTE", "Coffee", "2", "KRW 5000", "KRW 0", "KRW 10000"),
               ("SALT BREAD", "Bakery", "2", "KRW 3500", "KRW 0", "KRW 7000")], "total": "KRW 17000"},
    {"id": "R105", "date": "30 Sep 2026", "time": "20:15:00", "tender": "CASH",
     "items": [("COLD BREW", "Coffee", "1", "KRW 5500", "KRW 500", "KRW 5000"),
               ("MACARON", "Dessert", "3", "KRW 2800", "KRW 0", "KRW 8400")], "total": "KRW 13400"},
]


def draw(c, s):
    c.setFont("Helvetica-Bold", 15); c.drawString(24, 728, "ONDAM CAFE")
    c.setFont("Helvetica", 10); c.drawString(24, 707, "ONDAM CAFE")
    c.setFont("Helvetica-Bold", 12); c.drawRightString(346, 729, s["id"])
    c.setFont("Helvetica", 8); c.drawRightString(346, 709, "POS_E")
    c.setFillGray(0.92); c.rect(24, 676, 322, 16, stroke=0, fill=1); c.setFillGray(0)
    c.drawString(34, 682, "Coursework sample receipt - not a real payment record")
    y = 654
    for k, v in (("Sale Date", s["date"]), ("Sale Time", s["time"]), ("Tender", s["tender"])):
        c.setFont("Helvetica", 9); c.drawString(24, y, k); c.drawRightString(346, y, v); y -= 19
    y -= 18
    c.setFont("Helvetica-Bold", 9); c.drawString(24, y, "Product"); c.drawRightString(346, y, "Net")
    y -= 20
    for i, (name, cat, qty, price, disc, amt) in enumerate(s["items"], 1):
        c.setFont("Helvetica-Bold", 9); c.drawString(24, y, f"{i:02d} {name}")
        c.setFont("Helvetica", 8); c.drawString(36, y - 19, f"Group: {cat}")
        c.drawString(36, y - 36, f"Count: {qty}"); c.drawRightString(346, y - 36, f"Unit Price: {price}")
        c.drawString(36, y - 53, f"Rebate: {disc}")
        c.setFont("Helvetica-Bold", 9); c.drawRightString(346, y - 70, amt)
        y -= 100
    y += 5
    c.setFont("Helvetica-Bold", 11); c.drawString(24, y, "Paid"); c.drawRightString(346, y, s["total"])
    c.setFont("Helvetica", 7.5); c.drawString(24, 21, "Author: Min Seunghwan (2021308) | Google Drive demo")


def main():
    out = ROOT / "samples" / "drive"; out.mkdir(parents=True, exist_ok=True)
    for s in SAMPLES:
        c = canvas.Canvas(str(out / f"{s['id']}.pdf"), pagesize=(W, H), pageCompression=1)
        c.setTitle(f"{s['id']} sample receipt"); draw(c, s); c.showPage(); c.save()
        print(out / f"{s['id']}.pdf")


if __name__ == "__main__":
    main()
