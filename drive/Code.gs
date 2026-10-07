/**
 * 카페 온담 매출전표 · Google Drive 연동 (Apps Script 웹 앱)
 *
 * Drive의 '매출전표' 폴더에 있는 PDF/JSON 전표를 대시보드가 읽어 갈 수 있게 내보냅니다.
 * 대시보드는 60초마다 이 웹 앱을 호출해 새로 올라온 파일만 받아 자동 분석합니다.
 *
 * 설정
 *  1) script.google.com → 새 프로젝트 → 이 코드를 붙여넣기
 *  2) 배포 → 새 배포 → 유형 '웹 앱' · 실행: 나 · 액세스: 모든 사용자 → 배포
 *  3) 웹 앱 URL을 대시보드 'AI 분석' 화면의 Google Drive 칸에 붙여넣기
 *
 * 폴더 ID를 직접 지정하려면 FOLDER_ID에 넣으세요(비워 두면 이름으로 찾음).
 */
const FOLDER_NAME = '매출전표';
const FOLDER_ID = '';
const MAX_FILES = 40;          // 한 번에 보내는 최대 파일 수
const MAX_BYTES = 2 * 1024 * 1024; // 파일당 최대 크기

function getFolder_() {
  if (FOLDER_ID) return DriveApp.getFolderById(FOLDER_ID);
  const it = DriveApp.getFoldersByName(FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(FOLDER_NAME);
}

function doGet(e) {
  const since = Number((e && e.parameter && e.parameter.since) || 0);
  const folder = getFolder_();
  const fresh = [];
  let total = 0;
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const type = f.getMimeType();
    if (type !== MimeType.PDF && type !== 'application/json') continue;
    total++;
    const updated = f.getLastUpdated().getTime();
    // 같은 시각(ms)의 파일을 놓치지 않도록 '<' 로 비교하고, 중복은 대시보드가 파일 ID로 거른다
    if (updated < since || f.getSize() > MAX_BYTES) continue;
    fresh.push({ f: f, updated: updated });
  }
  // 오래된 것부터 MAX_FILES 개씩 보낸다 → 대시보드가 since 를 올리며 다음 묶음을 받는다
  fresh.sort((a, b) => a.updated - b.updated);
  const files = fresh.slice(0, MAX_FILES).map(x => ({
    id: x.f.getId(),
    name: x.f.getName(),
    mimeType: x.f.getMimeType(),
    updated: x.updated,
    data: Utilities.base64Encode(x.f.getBlob().getBytes()),
  }));
  const body = { ok: true, folder: folder.getName(), folderUrl: folder.getUrl(), total: total, pending: Math.max(0, fresh.length - files.length), files: files, now: Date.now() };
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
