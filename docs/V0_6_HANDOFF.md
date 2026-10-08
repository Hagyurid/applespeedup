# 에쁠가속기 v0.6 개발 인계

작업 대상: Hagyurid/applespeedup / develop/aplus-v2. 기존 study 저장소 수정 금지.

## 로컬 구현 완료 (새 ZIP 개발 스냅샷)
- sites/http.mjs: 인증 주입형 HTTP API 및 /mcp POST 진입점
- sites/assets.mjs: R2 원본 저장 및 접근 권한 확인 후 다운로드
- sites/repository.mjs: D1 과목/학년도/교수 특성·연도별 기출 근거·전사본 검색·정리본 버전 관리
- web/connected.html, connected.js, connected.css: 서버 D1 연동형 웹 화면
- tests/http.test.mjs: 종단간 모의 HTTP·MCP·파일 업로드·권한 테스트

## 현재 판정
로컬 정적 검사와 모의 D1/R2 자동 테스트 28개 통과. 실제 Sites 호스트의 인증 미들웨어, D1/R2 binding, MCP OAuth, 파일 추출, ChatGPT 설치·E2E 테스트는 미완료. 녹음 업로드 기능 없이 사용자가 직접 전사본 TXT/MD 또는 텍스트를 입력한다. PDF/DOCX/PPTX는 원본 저장 후 pending 상태이며 내용 추출 기능은 미완료.

## 다음 구현 작업
1. v0.6 ZIP 전체 소스를 이 개발 브랜치에 동기화
2. 실제 Sites 런타임에 서버 Request 핸들러와 DB/R2 인증 바인딩 연결
3. 과목 등록 → 전사본 등록 → ChatGPT MCP 검색 → 정리본 저장 E2E 통과
4. 권한·기출·이전 학년도·백업 검증 후 기존 Render 이전

주의: 이 인계 문서만 GitHub에 반영됐더라도 v0.6 전체 소스가 반영됐음을 의미하지 않습니다.
