# 저장소 작업 정책

- **작업 저장소:** `Hagyurid/applespeedup`
- **과거 참고 저장소:** `Hagyurid/study` (수정 금지)
- Render의 실사용 DB와 업로드 원본은 이 공개 GitHub 저장소에 절대 커밋하지 않습니다.
- 전사본을 TXT/MD로 처리하는 것을 기본으로 합니다. 녹음 파일 업로드와 자동 음성 전사 기능은 범위 밖입니다.
- OpenAI 모델 API 키를 사용하지 않습니다. AI 생성은 ChatGPT 대화에서 전용 플러그인 도구를 통해 요청합니다.
- 브라우저 프로토타입에서 저장된 IndexedDB는 기기·브라우저별 데모 데이터입니다. Sites D1/R2 배포, 계정 간 공유, Live MCP 도구 연결과 혼동하지 않습니다.
- 기존 Render 데이터 백업·이전은 사용자 요청으로 범위에서 제외합니다. 기존 Render·study는 변경하지 않고, 새 사이트는 빈 데이터로 시작합니다.
- 새 기능은 `npm run check`, `npm test`를 통과해야 하며, 브라우저 E2E·실제 Sites 배포 테스트는 추가로 요구됩니다.
