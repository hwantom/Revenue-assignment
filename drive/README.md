# Google Drive 연동

1. Google Drive에 `매출전표` 폴더를 만들고 `receipts/` 의 PDF를 올립니다. (새 전표 시연: `samples/`)
2. [script.google.com](https://script.google.com) → 새 프로젝트 → `Code.gs` 내용 붙여넣기
3. 배포 → 새 배포 → **웹 앱** · 실행: 나 · 액세스: 모든 사용자 → 웹 앱 URL 복사
4. 대시보드 **AI 분석** → Google Drive 칸에 URL 붙여넣기 → **연결**

연결 후에는 60초마다 폴더를 확인하고, 새 전표만 읽어 정제·분석합니다. 이미 있는 전표번호는 건너뜁니다.
