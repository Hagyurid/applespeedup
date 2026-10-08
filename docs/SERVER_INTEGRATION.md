# 에쁠가속기 v0.6: Sites 서버 및 MCP 연결 인계

## 운영 전제
- **AI는 ChatGPT 플러그인에서만 실행**하고 모델 API 키는 사용하지 않습니다.
- `sites/http.mjs`는 서버리스 **Request -> Response 처리기**이므로 사이트 호스트의 실제 진입점에 연결해야 합니다. **현재 사이트에 배포하거나 인증 시스템을 설치한 것은 아닙니다.**
- 브라우저용 `web/connected.html`은 **서버 DB 기반 화면**이며, 기존 `web/index.html`은 **독립 로컬 IndexedDB 데모**입니다. 한쪽 데이터가 자동으로 다른 쪽에 동기화된다고 가정하지 마세요.
- 녹음/음성 인식 기능 없음. 사용자는 전사본을 텍스트로 입력하거나 TXT·MD 업로드합니다.

## 호스트가 반드시 제공할 것
1. Sites 프로젝트의 **D1 호환 DB 바인딩** (`db.prepare().bind().first/all/run`, `db.batch`). `sites/schema.sql` 마이그레이션 적용.
2. **R2 호환 스토리지 바인딩** (`bucket.put/get/delete`). R2 키를 공개 URL에 연결하지 않음.
3. 호스트 인증 미들웨어에서 검증한 **사용자별 고유 ID**. `authenticate(request)`는 서버가 검증한 세션이나 OAuth 토큰으로 사용자 ID를 결정해야 하며, HTTP `x-user-id`, 요청 JSON 본문, 임의 이메일 헤더로 결정하면 안 됩니다.
4. DB `users`에 호스트의 **검증된 사용자 ID와 이메일** 등록. 3명 이내 초대제일 경우, 사이트 접근 허용 명단과 DB `course_members` 권한을 별도로 검증합니다.
5. 브라우저가 같은 오리진에서 `/api/*`를 호출하도록 라우팅하고, 사이트 호스트가 안전한 세션 쿠키(Secure/HttpOnly/SameSite)와 CSRF 방어 또는 인증된 토큰 처리.
6. `/mcp`에서 OAuth 2.1 / 사이트 플러그인 인증이 실제 지원되는지, ChatGPT 플러그인이 사용자별 인증으로 접근할 수 있는지 검증. 단순 고정 API 키/공개 엔드포인트로 운영 금지.
7. 요청 크기·실행시간·R2 사용량·D1 쓰기 한도는 실제 사이트 배포 환경에서 측정하고 조정.

### 서버리스 진입점 예시 (의사코드: 실제 인증 어댑터 필요)

```js
import {createHttpHandler} from './sites/http.mjs';

export default {
  async fetch(request, env, context) {
    const handle = createHttpHandler({
      db: env.D1, bucket: env.R2,
      authenticate: (req) => env.authProvider.verifyUser(req), // 예시 인터페이스; 실제로 존재한다고 가정하지 않음
      allowedOrigin: new URL(request.url).origin,
    });
    return handle(request);
  }
};
```

**주의:** 예시의 `env.authProvider`는 Site에서 자동 제공되는 객체가 아닙니다. Sites 실제 인증 API의 지원 여부를 확인해 연결해야 합니다. 이 부분이 검증되기 전에는 배포가 끝난 것이 아닙니다.

## HTTP 경로
| 경로 | 방법 | 역할 |
|---|---|---|
| `/health` | GET | 진입점 응답만 확인 (배포 완료/실제 MCP 연결 의미 아님) |
| `/api/courses` | GET/POST | 과목 조회/생성 |
| `/api/offerings?course_id=...` | GET | 특정 과목의 강의 연도 목록 |
| `/api/offerings` | POST | 학년도별 강의 추가 |
| `/api/course-context?offering_id=...` | GET | 과목 특징·현재 강의 정보·이전 개설 강의 |
| `/api/facts` | POST | 과목 개설 강의별 특징 및 출처·신뢰도 저장 |
| `/api/sources?offering_id=...` | GET | 자료 목록 |
| `/api/transcripts` | POST JSON | 전사본 텍스트 청크 저장 |
| `/api/assets` | POST 바이너리 | R2 원본 업로드, D1 메타데이터 등록 |
| `/api/files/:source_id` | GET | 권한 검사 후 R2 파일 다운로드 |
| `/api/notes-list?offering_id=...` | GET | 학년도별 정리본 목록 |
| `/api/notes?note_id=...` | GET | 정리본 버전과 본문 조회 |
| `/api/notes` | POST | 신규/기존 정리본 저장. 기존 수정은 `note_id`/`expected_revision` 필수 |
| `/api/jobs`, `/api/checkpoints` | POST | GPT 작업 등록 및 체크포인트 |
| `/mcp` | POST JSON-RPC | 인증된 9개 MCP 작업 도구. GET은 405 |

업로드: `Content-Type: application/octet-stream`, `X-Offering-Id`, `X-Source-Type`, `X-Source-Title`, `X-File-Name` 등 헤더로 메타데이터 전달. 파일명/제목 등 비 ASCII 문자는 **각 헤더 값을 `encodeURIComponent`로 인코딩**합니다. 파일 상한은 8MiB.

TXT/MD는 UTF-8 유효성을 검사하고 DB 청크로 나누어 즉시 검색 가능합니다. **PDF/DOCX/PPTX는 원본 저장만 지원하며 실제 본문 추출을 구현하지 않았으므로 `pending`으로 표시합니다.** 확장자·간단한 파일 시그니처 검사가 보안 검사나 전체 문서 파서 검증을 대체하지 않습니다.

## MCP 요청 확인
- `POST /mcp`에 `Accept: application/json, text/event-stream`, `Content-Type: application/json`을 포함.
- 한 요청 당 JSON-RPC 메시지 하나. 허용된 도구에 대한 사용자 인증·인가 필수.
- 성공은 JSON 객체, 알림은 `202 Accepted` 본문 없음.
- `initialize`/`tools/list`/`tools/call` 응답 및 출처 데이터 범위 검사.
- ChatGPT 플러그인 등록 후 **실제** `get_course_context → list_sources → search_source_content → save_note → get_note` E2E 확인.
- ChatGPT 플러그인의 인증 요구사항·제공 플랜에 맞게 프로토콜 버전·OAuth 메타데이터를 구성해야 함. 현재 모듈은 그 전체 제공자가 아님.

## 인증/배포 차단 조건
- 호스트에서 검증된 사용자 ID를 얻는 방법이 없다면 DB 쓰기·MCP 쓰기를 게시하지 않는다.
- 인증이 되더라도 타인의 `offering_id`, `source_id`, `note_id` 읽기·쓰기 차단 테스트가 통과해야 함.
- 사이트 호스팅에 `/mcp` 연결이 지원되지 않는다면 **Sites의 공식 플러그인 생성 기능으로 MCP를 다시 생성**하고 공통 저장소 인터페이스를 맞춘다.
- 2025/2026 개설 강의, 출제 특성, GPT 결과물이 실제 사이트 계정에서 동일하게 보이는지 E2E 테스트.

## 남은 기술 과제
- 실제 Sites 계정에서 D1/R2 바인딩과 사용자 인증·MCP 연결
- PDF/DOCX/PPTX 텍스트/페이지 처리 및 원본 출처 링크
- 친구 초대, 권한 정책, 서버 백업·복구
- 기존 Render 서버 실데이터를 안전하게 백업/이전
- 웹 UI 전체 기능을 서버 연동으로 통합 (로컬 데모는 보존)
