# 에쁠가속기 · A+ Accelerator

2026-10-08 · v0.7.0-preview.1

개발 대상은 `Hagyurid/applespeedup`의 `develop/aplus-v2`입니다. `Hagyurid/study`는 수정하지 않습니다.

Sites 프로젝트를 등록하고 기존 v0.6 UI·서버 로직을 공식 Worker 구조에 연결했습니다. D1/R2의 **로컬 Worker 검증은 통과**했으며, 운영 배포·실제 ChatGPT 로그인·브라우저 사용 테스트는 미완료입니다.

- 별도 OpenAI 모델 API 키, Render, 기존 데이터 이관, 녹음 업로드/자동 전사 없음
- 실제 로그인 검증 전에는 운영 자료 변경을 기본 잠금
- PDF 원본 보관은 구현됨. 페이지별 추출은 미완료
- 기존 MCP/Skill 코어 보존. Site 플러그인은 미연결이며 `/mcp` 잠금
- Node 테스트 38개 및 Worker 통합 검사 10개 통과
- 실서비스 배포는 사용자 승인 후 진행

자세한 검토 범위와 다음 단계: [SITES_PREVIEW_REVIEW.md](docs/SITES_PREVIEW_REVIEW.md)
