# 에쁠가속기 v0.8 — 원본 문서 추출·OCR 기술 설계 (2026-10-09)

> **상태: 설계, 아직 구현·배포 전.** ChatGPT Sites에서 별도의 OpenAI 모델 API 비용, Render, 외부 OCR SaaS를 사용하지 않는다. 실제 Sites 브라우저/CSP/워커/WASM 호환성, 저장 쓰기 및 기기 성능 확인이 필요하다.

## 목표와 사용자 경험

기출문제·강의 슬라이드의 PDF/이미지에서 **페이지별 텍스트를 추출해 검색 및 GPT 자료 선택**에 이용한다. 원본 문서는 R2에 보존하고, 인식된 텍스트·검토 상태는 D1에 저장한다.

1. 사용자가 **과목**, **자료 유형**, **직접 입력한 제목**, `주차(일반 자료)` 또는 `기출 연도(기출)`, 원본 파일을 지정한다.
2. 먼저 입력한 메타데이터와 원본 파일을 저장. 파일명/OCR은 절대로 사용자가 입력한 제목·유형·주차·연도를 자동 수정하지 않는다.
3. 백그라운드가 아닌 **클라이언트 브라우저의 Web Worker**에서 PDF를 분석해 페이지마다 원문 텍스트 추출 또는 OCR 처리. 별도 OpenAI API나 외부 OCR 서버로 파일을 전송하지 않는다.
4. 업로드 뒤 목록에는 `대기 / 추출 중 N/M / 텍스트 준비됨 / 검토 필요 / 실패` 등을 표시. 페이지별 검토·정정·재실행 가능.
5. 추출된 텍스트와 페이지 번호를 D1에 페이지/청크로 저장. 파일 원본은 R2에 그대로 남김.
6. GPT 제작실에서 사용자가 선택한 `source_id`의 **검색 가능한 페이지/청크만** 이용하고, 검토가 필요한 수식/도표는 PDF 원본 이미지/페이지를 명시해 근거를 확인하도록 한다.

## 인식 기술 결정: 페이지별 하이브리드

**A. 텍스트 기반 PDF** (먼저)
- Mozilla **PDF.js**로 파일을 열고 페이지마다 `getTextContent()`로 선택 가능한 텍스트를 가져온다. 페이지 레이아웃/읽기 순서, 위첨자·아래첨자, 한글 추출 무결성 확인.
- 텍스트가 충분하고 품질이 양호하면 OCR은 **실행하지 않는다**. 디지털 PDF에서 중복 OCR은 오인식 위험과 계산 비용을 늘린다.

**B. 스캔 PDF 또는 이미지로 렌더링된 강의 슬라이드**
- PDF.js로 PDF 한 페이지를 **적정 해상도의 canvas 이미지**로 렌더링한다 (성능 시험 뒤 해상도 결정, 첫 후보는 150~200dpi).
- **Tesseract.js + WebAssembly**를 클라이언트 `Web Worker`로 실행, `kor`+`eng` 언어 데이터를 사용해 인쇄 텍스트 인식.
- Tesseract.js 자체는 PDF 직접 입력을 지원하지 않으므로 PDF.js → 캔버스 이미지 → Tesseract.js 순서가 필요하다. 혼합 PDF는 페이지마다 A/B 분기, 텍스트가 있어도 그림 내 글자가 있는 페이지는 수동 `이 페이지 OCR` 실행 가능.
- 이미지(JPEG/PNG)는 그대로 이미지 OCR에 전달 가능. DOCX/PPTX의 본문/텍스트 프레임은 ZIP/XML 정규 추출 우선, 그림에 박힌 글자는 별도 OCR.

**C. 수식·화학식·그래프·표**
- `Tesseract.js` 인쇄 글자 인식은 **LaTeX/OMML 수식·복잡한 표·반응식·그래프의 완전한 구조 복원을 보장하지 않는다.**
- 지수/첨자/그리스 문자/적분·분수/단위 변환을 원본과 대조하지 않고 자동으로 고치지 않는다. `10^-3`, `k_a`, `ΔH`, 단위, 화학 반응식의 특수 기호를 우선 **검토 필요** 항목으로 표시하는 보수적 규칙을 둔다.
- OCR 결과를 과학적 사실로 바로 GPT에 확정하지 않는다. 검토 안 된 페이지는 `미검증 OCR 텍스트`로 명시하며 사용자가 클릭하면 원본 이미지와 OCR 텍스트를 나란히 열어 수동 정정할 수 있다.
- 이미지·그래프 자체가 필요한 경우 GPT 제작 요청에 출처 PDF 페이지 정보를 포함하고 원본 이미지에 대한 후속 검토 경로를 제공. 별도 GPT OCR 호출은 플러그인의 실제 이미지 접근 기능이 확인된 뒤 선택적 도입하며 유료 외부 API는 기본 구성에 포함하지 않는다.

## 브라우저·성능·보안 전략

- **iPhone/iPad/노트북:** OCR은 기기에서 실행하므로 배터리/메모리/시간 제한에 영향. 첫 릴리스에는 **1페이지씩** 처리, 다음 페이지 전 canvas 정리, 작업 진행률/중단/재개 제공. 모바일에서 큰 파일은 노트북에서 진행하도록 권고.
- Sites 정적 번들에 pdfjs-dist, tesseract.js 및 검증된 언어 데이터(또는 허용된 신뢰된 호스팅)를 고정 버전으로 공급. **사용자 자료의 외부 OCR 서비스 전송 없음**. CSP·Worker·WASM 호환성을 실제 Sites에서 검증.
- 브라우저가 닫혀도 다음 실행에 이어할 수 있도록 **원본 저장 성공 후 source_id와 파일 SHA-256으로 작업 식별**. 페이지별 완료/실패를 서버에 기록. OCR 결과 저장 시 source_id별 사용자/과목 인가 및 페이지 수·텍스트 크기 제한 필요.
- OCR 본문을 모델 명령으로 해석하지 않음(비신뢰 원문), 업로드 파일 검증(확장자·MIME·시그니처·크기), 권한 없는 R2 원본 접근 차단.
- 서버 요청은 페이지 묶음(소량)으로 수행, D1 row size·Workers CPU/메모리/요청 한도를 확인. 긴 PDF를 **한 요청에서 동기 OCR**하지 않는다.
- 대용량 페이지 텍스트와 원본은 선택적으로 R2에 저장, D1에는 주로 페이지·청크·검색 인덱스·상태 기록. 중복 처리 방지에 file hash + extraction engine/version 활용.
- 처리 실패 시 원본 및 입력 메타데이터 보존. 임시 오류가 발생해도 재시도 가능하며 검증된 기존 텍스트를 자동으로 덮어쓰지 않는다.

## DB/API 설계

기존의 학년도별 `offering_id`는 제거하고, 과목 직접 연결로 개편한다(별도 schema migration 후 적용).

`source_assets`: `id`, `course_id`, `source_type`, **`title`(사용자 입력)**, `original_file_name`, `exam_year`(past_exam에서만), `sha256`, `storage_key`, `extract_status`, `extract_method`, `extract_engine_version`, `created_at`.
`source_weeks(source_id,week_number)`: **비기출에서만** 0..N개, 주차 미지정은 row 없음.
`source_pages(source_id,page_num,raw_extracted_text,corrected_text,method,confidence,review_status,...) `: 원본 추출 문자열과 사용자가 확인·수정한 버전을 별도로 보존.
`source_chunks(source_id,page_num,chunk_index,text_content,...) `: 검색 및 GPT 모델 전달. 교정 시 해당 페이지 청크 재생성.
`extraction_jobs(source_id,sha256,engine_version,status,page_count,completed_pages,updated_at,...)`: 진행과 재개.

API(서버는 매번 인가 검증):
- `POST /api/assets`: `course_id`, `source_type`, `title`, `weeks[]` 또는 `exam_year`, 파일 원본. 서버가 검증 후 R2 저장, D1 메타 저장.
- `POST /api/sources/:id/extraction/pages`: 한 페이지/소량의 OCR 결과 저장 및 검증 상태 기록, 파일 해시·버전 확인.
- `GET /api/sources/:id/extraction`: 전체 처리 상태·페이지별 완료 표시, 이어할 페이지.
- `PATCH /api/sources/:id/pages/:number`: 사용자가 검토/교정한 텍스트 저장, 변경 이력 유지.
- `GET /api/sources?course_id=...&source_type=...&week=...&exam_year=...`: 필터, 원본 제목이 아닌 사용자 작성 제목 사용.
- GPT 작업 시작 시 사용자가 **명시 선택한 source_id**만 포함. OCR 상태·페이지별 검토 여부·출처를 함께 제공.

## UI/UX 배치

자료 등록 폼:
- 자료 유형이 `past_exam`이면 `기출 연도 (선택)` 숫자 필드만 보여주고 주차 다중 선택 숨김
- 나머지 유형에서는 `주차(선택)`만 표시
- `자료 제목`은 필수로 직접 입력; 원본 파일명은 보조 표시만
- `자료 저장`과 `텍스트 인식`을 별도 비동기 단계로 분리해 인식 실패가 등록 자체를 무효화하지 않게 함

자료 목록:
- 사용자 제목 · 유형 · 주차 또는 연도 · 파일 인식 상태 · 미리보기/다시 인식/수정
- 기출 선택 상태에서 연도 필터, 일반 자료에서 주차 필터
- `검토 필요` 상태를 숨기지 않고 GPT 자료 선택 패널에도 표시

원본 검수:
- PDF 페이지 미리보기 ↔ OCR 텍스트 비교
- 문제가 있는 문자/수식 직접 정정, `이 페이지 재인식`, `검토 완료`, 다음 페이지 이동
- 최종 선택한 사용자가 **교정한 텍스트가 검색 우선**

## 테스트 및 출시 기준

1. 원본 `scan_384.png`/ `doc(4).pdf`이더라도 사용자 제목이 저장/열람/검색/GPT 요청에 사용됨.
2. `past_exam`에서 year=2024 저장 시 `weeks=[]`. `lecture_slides`에서 weeks=[1,2] 저장 시 exam_year=null. 타입 변경해도 이전 필드가 누출되지 않음.
3. 글자를 드래그할 수 있는 PDF는 텍스트 직접 추출, 이미지 PDF만 OCR; 중복 인식 없음.
4. 한국어·영어 복합 강의 PDF, 스캔 기출, 혼합 PDF 각각 검색/페이지 인덱스 테스트.
5. 화학식·적분·지수·첨자·표/그래프는 원본과 비교·교정 가능하며 OCR을 원문과 동일하다고 주장하지 않음.
6. iPad Safari에서 1페이지씩 처리·진행률/일시정지·재개, 과목 전환 중 잘못된 파일에 기록되지 않음.
7. 실패·중단 시 원본과 사용자 메타데이터가 유지되며, 페이지 단위 재시도가 된다.
8. 실제 ChatGPT Sites의 D1/R2/CSP/Worker/WASM 및 인증 아래에서 업로드-추출-검색-GPT 선택 E2E 완료 전 'OCR 완료'로 표시하지 않는다.

## 근거 문서

- Mozilla PDF.js Examples: https://mozilla.github.io/pdf.js/examples/index.html
- Tesseract.js FAQ (PDF 직접 입력 미지원·PDF.js 렌더 권장): https://github.com/naptha/tesseract.js/blob/master/docs/faq.md
- Tesseract.js API (Web Workers, langs): https://github.com/naptha/tesseract.js/blob/master/docs/api.md
- Cloudflare Workers platform limits: https://developers.cloudflare.com/workers/platform/limits/
