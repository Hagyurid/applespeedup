# GPT → 에쁠가속기: 구현된 데이터 호출 흐름

## 목표
별도 OpenAI 모델 API, Render 호출 없이 ChatGPT 플러그인에서 자료 검색과 정리본 저장.

> **주의:** 현재 HTTP 처리기는 존재하지만 실제 Sites 인증 바인딩·D1/R2 배포·플러그인 게시가 아직 완료되지 않았습니다. 여기는 JSON-RPC 코어 + D1 형식 데이터 접근 계층과 테스트의 기준 계약입니다.

## 실제 MCP 9개 도구
| 도구 | 동작 | 권한 |
|---|---|---|
| get_course_context | 과목·학년도·교수·과목 특성·근거 정보 | 읽기 |
| list_sources | 해당 학기 원본 메타데이터 나열 | 읽기 |
| search_source_content | 해당 학기의 준비된 전사본/강의자료 청크 검색 | 읽기 |
| get_source_content | 선택한 원본 파일의 청크 페이지별 읽기 | 읽기 |
| get_note | 정리본 및 현재 버전 조회 | 읽기 |
| save_note | 정리본 생성, 수정, 버전 기록 | 쓰기 |
| create_job | 작업 등록 | 쓰기 |
| get_job | 본인 작업 체크포인트 조회 | 읽기 |
| save_checkpoint | 본인 작업 상태 저장 | 쓰기 |

## 첫 실행 절차
1. 웹사이트에서 과목과 개설 강의 등록: 예) 촉매반응공학 / 2026-2 / 교수.
2. 웹사이트에서 전사본 TXT/MD 등록. **음성 인식 기능 없음**.
3. 서버의 `ingestTranscript`를 통해 청크 저장(지원하는 Sites 백엔드 전송 연결 필요).
4. 사용자가 ChatGPT에서 "2026-2 5주차 정리" 요청.
5. GPT가 `get_course_context`, `list_sources`, `search_source_content` 또는 `get_source_content`를 호출.
6. 실제 원문을 확인하고 해당 학기에 적합한 정리본 생성.
7. `create_job` → `save_note` → `save_checkpoint`를 호출해 저장하고 결과물 ID/버전 보고.
8. 사이트는 실제 저장된 결과물을 동일한 D1 데이터에서 읽어 사용자에게 보여줌.

## 필수 안전장치
- 인증된 사용자 ID는 사이트 서버가 검증해 MCP 핸들러에 제공. GPT 요청 인자로 사용자 ID 수신 금지.
- `get_source_content`는 다른 과목/사용자의 source_id를 조회할 수 없어야 함.
- `save_note`는 업데이트 시 `note_id`와 `expected_revision`을 받아 충돌 시 덮어쓰지 않음.
- 올해 강의 내용과 지난 학년도 출제 경향은 별도 과목 이력에 기록.
- ChatGPT가 실제 도구를 호출하지 못하는 환경이면 작업 완료/자동 저장 성공이라고 답하지 않음.
- 단위 작업마다 `save_checkpoint` 호출, 작업 종료 후 백그라운드 AI 실행을 가정하지 않음.

## 테스트 근거
`npm test`: SQLite `node:sqlite`를 사용하는 D1 인터페이스 모의 테스트에서 과목·학년도 분리, 전사본 업로드, 조회, 정리본 저장/버전, 권한·작업 이어하기를 검증. **실제 Cloudflare D1 연결 또는 ChatGPT 플러그인 E2E 검증과 동일하지 않음.**

## v0.6 웹 서버 연결 메모
- `web/connected.html`: 실서비스 D1 연결을 위한 웹 프런트 초기 화면이며, `/api/courses`→`/api/offerings`→`/api/transcripts`/`/api/assets`→`/api/notes`를 사용.
- `sites/http.mjs`: 요청 처리 및 인증 주입 지점. 호스트 세션/OAuth 검증 구현은 미포함.
- 과거 학년도 개설 강의 목록은 `get_course_context.previous_offerings`에 포함됩니다. 전년도 파일 원문을 사용할 경우 해당 `offering_id`로 별도 조회하고, 올해 강의 근거로 간주하지 않습니다.
- PDF/Word/PPT 원문은 아직 모델에게 제공되는 검색 텍스트가 아닙니다. 추출 완료 전 GPT가 읽었다고 말하면 안 됩니다.
