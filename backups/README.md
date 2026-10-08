# Render 백업 계획 — 실제 백업 아직 실행되지 않음

기존 Render `render.yaml`에는 SQLite DB 경로가 `/var/data/lecturenote_suite.sqlite3`, 파일 디렉터리가 `/var/data/uploads`로 설정됨.

1. Render 대시보드에서 실제 영구 디스크의 데이터와 DB를 확인.
2. 데이터 수정 중지 또는 일시적으로 쓰기 제한. SQLite WAL 모드이므로 `sqlite3` 연결로 Online Backup API를 사용하여 **일관된 DB 스냅샷** 확보 (`.db` 파일만 무작정 복사하지 않음).
3. `/var/data/uploads` 원본 파일 전체 아카이브 및 SHA256 체크섬 리스트 생성.
4. DB 테이블별 행 수, 업로드 파일 수·크기, 정리본 버전, 문제팩 수, CASIO 프로젝트 수 기록.
5. **같은 브라우저에서** SolvePad·CASIO IndexedDB 로컬 자료를 별도로 내보냄. URL이 바뀌면 브라우저 저장소가 자동 공유되지 않음.
6. 암호화 저장소 2곳에 백업해 놓고 SQLite 복원·파일 해시 확인.
7. 데이터 이전 및 테스트 완료 전 **Render 해지 금지**.

현재 이 ZIP에는 **기존 운영자의 실제 데이터가 없다**. GitHub 소스 코드만으로 현재 운영 데이터 백업은 불가능하다.
