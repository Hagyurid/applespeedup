# 에쁠가속기 ChatGPT 플러그인 작업 절차

사이트 `/mcp`는 Sites의 OAuth와 확인된 로그인 정보를 사용합니다. 웹사이트에는 별도 모델 키가 없고, 사용자 대화에서 요청했을 때 ChatGPT가 플러그인 도구를 호출합니다. 사이트가 자료의 등록·수정·저장을, ChatGPT가 OCR·교정·생성 판단을 담당합니다.

## 도구와 저장 위치

| 용도 | 플러그인 도구 | 저장·확인 |
|---|---|---|
| 자료 목록 | `list_course_materials` | 선택한 과목의 자료 ID와 상태 |
| PDF 준비 확인과 원본 판독 | `get_course_page_status`, `get_course_page_images` (최대 8페이지), `get_course_page_image`, `get_course_original_text` | 실제 R2 이미지와 D1의 문자 추출본 |
| 원문 교정 | `save_course_review_page` | D1의 원문·교정본·근거·미확인 항목 |
| 생성 근거 | `get_course_verified_text` | 검토 저장한 교정본·근거·불명확 항목 반환 |
| 목차와 본문 | `start_course_generation`, `save_course_outline`, `save_course_part` | D1 작업·정리본·버전 이력 |
| 진행 상태 | `list_course_jobs`, `get_course_generation_progress` | 목차, 이미 저장한 절 번호, 정리본 ID |
| 학습 결과물 | `save_course_problem_pack`, `save_course_casio_project` | 과목별 문제팩·CASIO 텍스트 |

## OCR·전사본 교정

1. 사이트에서 과목과 자료를 등록합니다. 녹음 파일은 받지 않으며 사용자가 TXT/MD 전사본을 입력 또는 업로드합니다.
2. PDF는 사이트의 PDF.js가 페이지 수·이미지·가능한 문자 추출본을 준비합니다. `get_course_page_status`의 준비 페이지와 페이지 수가 일치하지 않으면 검토 완료로 처리하지 않습니다.
3. PDF는 `get_course_page_images`로 최대 8페이지씩 한 번에 이미지 묶음을 받아 각 페이지를 빠짐없이 실제로 판독합니다. 읽기 실패한 페이지는 `get_course_page_image`로 개별 재요청합니다. 각 페이지의 원본 이미지를 보고, `get_course_original_text`의 추출 문자를 보조 자료로 대조합니다. 긴 원문은 `next_offset`이 없을 때까지 읽고 PDF는 `page_num`을 순서대로 확인합니다.
4. 전사본은 원문과 같은 과목의 첨부 자료를 대조합니다. 외부에서 확인한 사실은 별도 근거로 구분합니다. 확실하지 않은 수식·수치·기호는 `unresolved`에 남깁니다.
5. `save_course_review_page`로 원문·교정본·근거·불명확 항목을 한 번에 저장합니다. 모든 페이지가 저장되면 별도 완료 도구 없이 제작에 사용할 수 있습니다. 불명확한 항목이 남으면 `reviewed_with_issues`로 표시하며 완전히 검증됐다고 주장하지 않습니다. 이전에 저장한 검토도 자동으로 인식합니다.

## 생성과 이어하기

1. GPT 작업 화면에서 사용자가 선택한 **검토 저장** 자료 ID만 `start_course_generation`의 `source_ids`에 넣습니다. 현재 강의 범위를 우선하며 과거 기출은 유형 참고로 구분합니다.
2. `get_course_verified_text`로 `page_count`와 `next_offset`을 따라 교정본 전체와 `unresolved`, `evidence_ids`를 읽습니다. 작업 생성·이어하기의 `review_concerns`도 읽습니다. 불명확한 내용은 확정하지 않고 해당 절에 확인 필요를 표시하며 확인된 내용으로 제작합니다. 서버는 생성한 정리본·버전에 자료 제목과 페이지별 주의사항을 함께 저장합니다. 원본이나 미검토 OCR을 본문 근거로 사용하지 않습니다.
3. `save_course_outline`에 `sections: [{"title":"1장 ..."}, ...]` 형식으로 먼저 목차를 저장합니다. 이후 `save_course_part`로 절을 저장할 때마다 같은 정리본의 새 버전이 만들어집니다.
4. 중단되면 `list_course_jobs`와 `get_course_generation_progress`로 저장된 절 번호와 문서 ID를 확인하고 빠진 절부터 이어갑니다. 사용자가 정리본을 직접 수정해 버전이 바뀌면 자동 덮어쓰기가 충돌로 거부됩니다.
5. 반환된 정리본·문제팩·CASIO ID를 확인한 후에만 저장 완료를 보고합니다.

## 검증 범위

자동 테스트는 인증 없는 요청, 다른 사용자 자료 접근, D1/R2 저장, PDF 이미지 전달, 교정, 목차 선저장, 절별 자동 저장, 버전 충돌, 이어하기를 검사합니다. 실제 사용자 PDF가 없는 동안 운영 플러그인의 이미지 판독과 쓰기 결과는 별도 실사용 검증이 필요합니다.

## 처리 최적화 (개발 브랜치)

- PDF 페이지 준비는 최대 3개 작업을 동시에 실행합니다. 이미 준비된 페이지는 재렌더링·재추출하지 않고 건너뜁니다.
- GPT는 `get_course_page_images({material_id,start_page,count})`로 연속 1~8페이지의 이미지 블록과 번호를 함께 받습니다. 각 페이지의 실제 이미지 판독, 교정본과 근거 기록은 개별 페이지 단위로 유지합니다.
- 이미지 누락, 읽기 실패, 모호한 수식은 정상 처리로 간주하지 않으며 해당 페이지를 다시 확인합니다.
- 여러 장을 한 번에 받아도 GPT 모델의 OCR 정확성은 보장되지 않습니다. 지나치게 복잡한 페이지는 1~3페이지씩 나누어 검토합니다.

## 파일 정책과 선택 요청사항

- PDF·PPTX·이미지: 원본 저장 → 검수 저장 → 검수본 사용. PPTX는 원문 및 삽입 그림을 제공한다. 전체 슬라이드 렌더링·구형 PPT 변환은 지원하지 않으며 배치·미지원 개체는 PDF 변환본으로 확인한다.
- DOCX·HWP·HWPX·일반 TXT/MD: 모델 교정 없이 원문 본문 사용. 암호화·배포용·손상 문서는 원문 읽기 실패로 차단하고 변환을 안내한다. 복잡한 그림·수식 개체는 텍스트 추출만으로 검증됐다고 주장하지 않는다.
- 전사본: 검수 저장본만 사용하며 원문 우회를 허용하지 않는다.
- `get_course_generation_source`는 위 정책으로 읽는다. `additional_requests`는 최대 4,000자 선택 입력이며 생성 작업에 저장하고 이어하기에도 반환한다.

파일 등록 이름은 파일명으로 자동 설정하며 붙여넣은 전사본에는 자동 이름을 붙입니다. 자료 목록과 선택 목록은 자료 유형·파일 형식 순으로 분류합니다. 저장된 절이 있는 GPT 생성 문서는 `generated:` ID로 선택·읽기 가능하며, 작업 생성 시 문서 버전을 고정해 변경 충돌을 검사합니다.
