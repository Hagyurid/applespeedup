# 에쁠가속기 ChatGPT 플러그인 작업 절차

사이트 `/mcp`는 Sites의 OAuth와 확인된 로그인 정보를 사용합니다. 웹사이트에는 별도 모델 키가 없고, 사용자 대화에서 요청했을 때 ChatGPT가 플러그인 도구를 호출합니다. 사이트가 자료의 등록·수정·저장을, ChatGPT가 OCR·교정·생성 판단을 담당합니다.

## 도구와 저장 위치

| 용도 | 플러그인 도구 | 저장·확인 |
|---|---|---|
| 자료 목록 | `list_course_materials` | 선택한 과목의 자료 ID와 상태 |
| PDF 준비 확인과 원본 판독 | `get_course_page_status`, `get_course_page_image`, `get_course_original_text` | 실제 R2 이미지와 D1의 문자 추출본 |
| 원문 교정 | `save_course_review_page`, `finalize_course_review` | D1의 원문·교정본·근거·미확인 항목 |
| 생성 근거 | `get_course_verified_text` | 검토 완료한 교정본만 반환 |
| 목차와 본문 | `start_course_generation`, `save_course_outline`, `save_course_part` | D1 작업·정리본·버전 이력 |
| 진행 상태 | `list_course_jobs`, `get_course_generation_progress` | 목차, 이미 저장한 절 번호, 정리본 ID |
| 학습 결과물 | `save_course_problem_pack`, `save_course_casio_project` | 과목별 문제팩·CASIO 텍스트 |

## OCR·전사본 교정

1. 사이트에서 과목과 자료를 등록합니다. 녹음 파일은 받지 않으며 사용자가 TXT/MD 전사본을 입력 또는 업로드합니다.
2. PDF는 사이트의 PDF.js가 페이지 수·이미지·가능한 문자 추출본을 준비합니다. `get_course_page_status`의 준비 페이지와 페이지 수가 일치하지 않으면 검토 완료로 처리하지 않습니다.
3. 각 PDF/이미지 페이지의 `get_course_page_image` 이미지 자체를 보고, `get_course_original_text`의 추출 문자를 보조 자료로 대조합니다. 긴 원문은 `next_offset`이 없을 때까지 읽고 PDF는 `page_num`을 순서대로 확인합니다.
4. 전사본은 원문과 같은 과목의 첨부 자료를 대조합니다. 외부에서 확인한 사실은 별도 근거로 구분합니다. 확실하지 않은 수식·수치·기호는 `unresolved`에 남깁니다.
5. `save_course_review_page`로 각 페이지의 `raw_text`, `corrected_text`, `evidence_ids`, `unresolved`를 저장하고, 모든 페이지 검토와 미확인 항목 해소 후 `finalize_course_review`를 호출합니다. 교정 완료는 AI가 무오류를 보증한다는 뜻이 아닙니다.

## 생성과 이어하기

1. GPT 작업 화면에서 사용자가 선택한 **검토 완료** 자료 ID만 `start_course_generation`의 `source_ids`에 넣습니다. 현재 강의 범위를 우선하며 과거 기출은 유형 참고로 구분합니다.
2. `get_course_verified_text`로 `page_count`와 `next_offset`을 따라 교정본 전체를 읽습니다. 원본이나 미검토 OCR을 본문 근거로 사용하지 않습니다.
3. `save_course_outline`에 `sections: [{"title":"1장 ..."}, ...]` 형식으로 먼저 목차를 저장합니다. 이후 `save_course_part`로 절을 저장할 때마다 같은 정리본의 새 버전이 만들어집니다.
4. 중단되면 `list_course_jobs`와 `get_course_generation_progress`로 저장된 절 번호와 문서 ID를 확인하고 빠진 절부터 이어갑니다. 사용자가 정리본을 직접 수정해 버전이 바뀌면 자동 덮어쓰기가 충돌로 거부됩니다.
5. 반환된 정리본·문제팩·CASIO ID를 확인한 후에만 저장 완료를 보고합니다.

## 검증 범위

자동 테스트는 인증 없는 요청, 다른 사용자 자료 접근, D1/R2 저장, PDF 이미지 전달, 교정, 목차 선저장, 절별 자동 저장, 버전 충돌, 이어하기를 검사합니다. 실제 사용자 PDF가 없는 동안 운영 플러그인의 이미지 판독과 쓰기 결과는 별도 실사용 검증이 필요합니다.
