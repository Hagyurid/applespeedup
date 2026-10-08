# 에쁠가속기 / A+ Accelerator

> **새 개발 저장소:** [Hagyurid/applespeedup](https://github.com/Hagyurid/applespeedup). 기존 [Hagyurid/study](https://github.com/Hagyurid/study)는 읽기 전용 참고 자료이며, 여기서 추가 개발하거나 수정하지 않습니다.

**v0.7.0-preview.2 — 소유자 전용 Sites 검토 배포, 운영 D1 초기화, 로그인 확인, 반응형 다중 화면 UI. 자료 변경은 잠금 상태.**

최신 검증·완료 범위는 [Sites 검토 보고서](docs/SITES_PREVIEW_REVIEW.md)를 확인하세요. Node 테스트 38개와 빌드된 Worker 통합 검사 10개를 통과했습니다. 소유자 전용 URL에서 사용자가 실제 ChatGPT 로그인을 확인했고 운영 D1의 16개 테이블이 빈 상태임을 확인했습니다. 아직 자료 변경 잠금 상태이므로 운영 R2 업로드와 쓰기 기능의 실제 사이트 검증은 남아 있습니다. 아래 v0.6 설명은 이전 스냅샷 기록입니다.

기존 `Hagyurid/study`의 LectureNote Suite를 재설계하는 프로젝트. 사용자는 **음성이 아닌 전사본 텍스트**를 업로드하며, **Render와 OpenAI 모델 API 키를 사용하지 않는 것**을 목표로 한다.

## 현재 구현된 범위
- `web/connected.html`: 강의·자료·GPT 작업·정리본을 나눈 D1 연결 화면. 노트북 사이드 메뉴와 iPad·휴대폰 하단 메뉴 제공.
- `sites/http.mjs`: Sites 로그인 헤더와 서버측 소유권을 검사하는 HTTP 처리기. MCP 공개 경로는 별도 연결 전까지 잠금.
- `sites/assets.mjs`: R2 기반 TXT/MD·원본 문서 저장. PDF/DOCX/PPTX는 원문 추출 대기.
- `docs/SERVER_INTEGRATION.md`: 실제 Sites 연결·인증을 위한 보완 및 배포 체크리스트.

## 지금 실행해 볼 수 있는 부분
- 과목 프로필과 **학년도·교수별 강의 개설 정보**를 분리해 등록
- TXT/MD 전사본 또는 직접 입력한 텍스트 등록 및 브라우저 내 검색
- 과거 기출·전사본·올해 슬라이드의 자료 유형 분리
- 9종 학습자료 제작 모드와 시험형 규칙이 적용된 **GPT 요청문** 생성·복사
- 브라우저 내 Study Note 작성·수정·Markdown 다운로드 (로컬은 버전 복원이 아닌 버전 번호 추적)
- 단위 작업 체크포인트 메타데이터 및 복사 가능한 재개 요청
- JSON 로컬 백업 (IndexedDB 값만)
- D1 스키마, MCP 9개 도구의 JSON-RPC 코어, D1 저장소 인터페이스, Skill 초안, 통합 테스트

## 즉시 사용
프로젝트 폴더에서:

```sh
python3 -m http.server 8765
```

브라우저에서 **http://localhost:8765/web/** 로 이동. 서버는 로컬 개발용 정적 HTTP 파일 서버이며 Render나 AI API를 사용하지 않는다. 데이터는 **현재 브라우저 IndexedDB**에 저장된다. 공개 배포·친구와 실시간 동기화에 적합하지 않다.

```sh
node --check web/app.js
node --test tests/*.test.mjs
```

## 중요한 제한 / 아직 완료되지 않은 부분
1. **운영 사이트는 현재 읽기 전용입니다.** 실제 로그인과 운영 D1 초기화는 확인했지만, 잠금 해제 전이라 과목·자료·정리본 쓰기 및 R2 업로드의 실제 사이트 검증은 미완료입니다.
2. **MCP 및 HTTP 코어는 테스트 가능한 인터페이스**이며 Site 플러그인 설치와 실제 ChatGPT 도구 호출은 미완료입니다. 현재 `/mcp`는 의도적으로 잠겨 있습니다.
3. 로컬 프로토타입은 TXT, MD, CSV 파일 텍스트 또는 직접 붙여 넣은 전사본을 처리한다. PDF/DOCX/PPTX는 파일명·메타데이터만 등록하며 원문 추출은 추후 구현·검증 사항이다. 브라우저 프로토타입에서 PDF 원본 바이너리를 영구 저장하지 않는다.
4. Word OMML, PDF 출력, SolvePad 및 CASIO 정식 화면은 이번 단계 범위 밖이다.
5. 서버측 사용자 분리 자동 테스트는 통과했지만, 두 번째 실제 계정을 초대한 교차 사용자 검증은 아직 수행하지 않았습니다.
6. 기존 Render 운영 데이터 백업·이전은 사용자 요청으로 **범위 제외**. 새 서비스는 빈 데이터로 시작한다.
7. GPT 요청을 복사하는 것과 실제 ChatGPT가 플러그인을 실행하는 것은 별개다. 요청문만으로 서버에 자동 저장되지 않는다.

## 주요 폴더
- `web/`: 실행 가능한 로컬 UI 프로토타입
- `domain/`: 과목 선택, 과거 자료 분리, 작업 요청, 검증 공통 로직
- `sites/`: D1 SQL, 보안 검증 D1 리포지토리, MCP JSON-RPC 코어 + HTTP 전송·R2 어댑터 (실제 인증/배포 전 연결 필요)
- `plugin/skills/`: ChatGPT 용 Skill 지침
- `tests/`: 도메인 로직, MCP 코어, SQLite 기반 D1 리포지토리 통합 테스트
- `docs/`: 아키텍처, QA, 신규 설치 및 Sites 인계 계획
- `backups/`: 과거 백업 항목의 제외 안내

## 참고 출처
- 기존 시스템: https://github.com/Hagyurid/study
- ChatGPT Sites: https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites
- Sites에 MCP 플러그인 호스팅: https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites

## v0.5 변경 내용
- 과목/학년도 인증 검사, 서버측 전사본 텍스트 청크 저장, 검색·조회, GPT 정리본 생성/수정/버전 및 작업 체크포인트를 D1 호환 리포지토리로 구현했습니다.
- MCP 도구 6개 → 9개: `get_source_content`, `create_job`, `get_job` 추가.
- `docs/GPT_WORKFLOW.md`에 대상 흐름과 실제 호스팅 이전의 한계를 기록했습니다.
- 실제 Sites 연결·HTTP MCP 엔드포인트·웹 서버 데이터 연동은 여전히 미완료입니다.

## v0.6 변경 내용
- HTTP `/mcp` + 웹 API 구현, 요청 크기 제한·타인 파일 접근 차단·동일 오리진 요청 검사.
- TXT·MD·PDF·DOCX·PPTX 원본 R2 저장 인터페이스, TXT·MD 즉시 검색 및 PDF 계열 `pending` 표기.
- 연도별 강의 이력, 시험 정보 출처/신뢰도, 정리본 조회·수정, 원본 다운로드용 서버 연결 페이지.
- 통합 테스트는 별도의 Node SQLite/R2 모의 저장소에서 실행하며, 실제 Sites 배포 완료를 의미하지 않습니다.
