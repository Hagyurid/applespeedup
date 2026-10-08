# 에쁠가속기 · A+ Accelerator

2026-10-08 · v0.7.0-preview.2

개발 대상은 `Hagyurid/applespeedup`의 `develop/aplus-v2`입니다. `Hagyurid/study`는 수정하지 않습니다.

Sites 프로젝트를 소유자 전용으로 배포하고 기존 v0.6 UI·서버 로직을 공식 Worker 구조에 연결했습니다. 사용자가 실제 ChatGPT 로그인을 확인했고 운영 D1은 16개 테이블이 모두 빈 상태입니다. UI는 강의·자료·GPT 작업·정리본의 네 화면으로 분리했으며 휴대폰·iPad에서는 고정 하단 메뉴를 사용합니다.

- 별도 OpenAI 모델 API 키, Render, 기존 데이터 이관, 녹음 업로드/자동 전사 없음
- 실제 로그인은 확인했으며 운영 자료 변경은 쓰기 E2E 전까지 잠금
- PDF 원본 보관은 구현됨. 페이지별 추출은 미완료
- 기존 MCP/Skill 코어 보존. Site 플러그인은 미연결이며 `/mcp` 잠금
- Node 테스트 38개 및 Worker 통합 검사 10개 통과
- 운영 R2 및 쓰기 기능의 실제 사이트 검증, MCP 연결, 최종 릴리스는 미완료

자세한 검토 범위와 다음 단계: [SITES_PREVIEW_REVIEW.md](docs/SITES_PREVIEW_REVIEW.md)
