# 0~4단계 작업 현황 (2026-10-08)

| 단계 | 현재 완료한 결과 | 아직 필요한 실서비스 작업 |
|---|---|---|
| 0. 기존 시스템 분석·백업 | GitHub README/db/CustomGPT Instructions/render.yaml 확인, 현재 구조·자료 경로 조사, 백업 체크리스트 작성 | Render 실제 SQLite 및 `/var/data/uploads` 백업은 원격 서버 접근 필요. SolvePad/CASIO 브라우저 데이터 내보내기도 필요 |
| 1. 기술 검증 | 브라우저 IndexedDB 동작, 도메인 규칙·MCP JSON-RPC 코어 자동 테스트, Sites 공식 지원 문서 확인 | 실제 Sites 런타임의 D1/R2 binding, MCP HTTPS·인증, PDF 원문 추출 검증 미실시 |
| 2. UX/UI 기반 | 에쁠가속기 반응형 대시보드·과목·자료함·제작실·정리본·작업 기록 개발 | 실제 모바일/태블릿 사용자 테스트, Sites 게시 후 브라우저 테스트 |
| 3. 데이터 기반 | 과목↔학년도 강의 분리, 자료 유형·전사본 입력, D1 정규화 스키마 초안, 로컬 저장 및 검색 | D1 테이블 생성·이관, R2 업로드 연동, 3인 인증/접근권한 실제 구현 |
| 4. 제작 엔진 | GPT 모드 9개, 과목·강의·기출 분리한 요청 생성기, Skill 초안, 6개 MCP 도구 코어, 작업 단계 모델 테스트 | 플러그인 공개·설치, 실제 모델이 MCP 호출하는 E2E 테스트, 정리본 생성 자동 저장 실제 연동 |

**릴리스 판정:** 로컬 UI 시연 가능 / Sites 서비스 준비 전 / Render 해지 불가.


## v0.5 추가 진행
- `sites/repository.mjs`: D1 호환 쿼리와 강의별·사용자별 권한, 전사본 수집, 자료 검색, 정리본 저장·버전 충돌, 작업 체크포인트 구현
- MCP 9개 도구 지원. D1 호환 테스트에는 Node 22의 `node:sqlite` 모의 실행 사용
- CI: `npm run check` + `npm test`
- 브라우저 E2E는 현재 실행 환경에서 localhost/file:// 탐색이 `ERR_BLOCKED_BY_ADMINISTRATOR`로 차단되어 미실행
- 실제 Sites D1/R2, MCP HTTPS, 친구 권한, 실서비스 백업/이전 미완료

## v0.6 추가 진행
- 서버 측 요청 처리 `sites/http.mjs`, R2 업로드/다운로드 `sites/assets.mjs` 추가. D1 기존 과목·학년도 API 및 정리본 수정 버전 검사 연결.
- `web/connected.html` 서버 연결 UI 추가: 과목·학년도, 출처별 교수/시험 특성, TXT/MD·원본 파일, GPT 요청문, 정리본. **실제 Sites에서는 미실행**.
- PDF/DOCX/PPTX는 원본 보관만 가능하며 내용 추출은 `pending`. TXT/MD는 UTF-8 텍스트 청크화.
- 실제 인증 제공자·사이트 사용자 맵핑·배포·친구 권한 테스트·Render 운영 데이터 백업은 여전히 미완료.
- 프로젝트 브랜치: `Hagyurid/applespeedup` → `develop/aplus-v2`.
