[한국어](./README.ko.md) | [English](./README.md)

# Discord 로그 봇

TypeScript, Discord.js v14, PostgreSQL 기반 운영형 Discord 로그 봇입니다.
길드 활동을 기록하고 검색 가능한 이벤트 로그로 저장하며, 운영용 슬래시 명령과 레거시 텍스트 명령을 제공합니다.

## 기능

- 메시지 로깅: 생성, 수정, 삭제, 대량 삭제, 리액션 추가/삭제, 첨부 파일 캡처, 재시작 후 누락된 `messageCreate` 로그 복구.
- 길드 활동 로깅: 멤버 입장/퇴장/수정, 밴 추가/해제, 길드 수정, 초대 생성/삭제, 음성 상태 변경.
- 서버 객체 로깅: 채널 생성/수정/삭제/핀, 스레드 생성/수정/삭제, 역할 생성/수정/삭제, 이모지 생성/수정/삭제, 스티커 생성/수정/삭제, 예약 이벤트 생성/수정/삭제.
- 로그 검색/내보내기 명령, 길드/채널 메시지 백필 명령, 큐에 적재된 로그 이벤트 DLQ redrive.
- 유저/채널로 메시지 전송, 채널/길드/유저/개수 기준 메시지 삭제 명령.
- 길드, 채널, 유저 리포트 명령.
- 로그 알림 추가/목록/삭제/테스트 명령.
- PostgreSQL 저장소, 시작 시 스키마 마이그레이션, `event_logs` 엄격 스키마 검증.
- 선택형 Redis 로그 큐: 배치, 재시도, DLQ redrive, 분산 모드 안전장치.
- `local`, `webdav`, `s3`, `smb` 첨부 파일 저장소 제공자.
- 슬래시 명령 권한 제어, 허용 길드 강제, 레거시 텍스트 명령, 그레이스풀 셧다운, Sentry 연동, `en`/`ko` i18n 리소스.

## 명령

`src/command_slash/`에서 현재 로드되는 슬래시 명령:

- 로그: `log-search`, `log-export`, `log-guild-messages`, `log-channel-messages`, `log-dlq-redrive`.
- 알림: `log-alert-add`, `log-alert-list`, `log-alert-remove`, `log-alert-test`.
- 메시지: `message-send-channel`, `message-send-user`, `message-delete-channel`, `message-delete-guild`, `message-delete-number`, `message-delete-user`.
- 리포트: `report-guild`, `report-channel`, `report-user`.
- 운영/관리: `ping`, `status`, `reload`, `perm`.

`src/command_legacy/`에서 현재 로드되는 레거시 명령:

- `ping`, `status`, `reload`, `log-search`, `log-guild-messages`.

## 빠른 시작

1. 의존성을 설치합니다.
    ```bash
    npm install
    ```
2. `.env.example`을 복사해 `.env`를 만들고 필수 값을 채웁니다.
    ```bash
    cp .env.example .env
    ```
3. TypeScript 결과물을 빌드합니다.
    ```bash
    npm run build
    ```
4. 컴파일된 봇을 실행합니다.
    ```bash
    npm start
    ```

봇은 DB 연결 확인, 스키마 마이그레이션, `event_logs` 검증, 전역 슬래시 명령 등록, 허용 길드 로드, 큐 초기화 후 Discord에 로그인합니다.

## 환경 변수

`.env.example`을 `.env`로 복사하고 필수 Discord/PostgreSQL 값을 채우세요. PostgreSQL 연결 옵션과 선택형 Redis, 메시지 복구, 저장소, Sentry, 슈퍼 관리자, 레거시 접두사 설정은 `.env.example`에 정리되어 있습니다.

## NPM 스크립트

- `npm start`: `dist/index.js` 실행.
- `npm run dev`: 빌드 후 `NODE_ENV=development`로 실행.
- `npm run dev:watch`: 컴파일된 런타임을 Node watch 모드로 실행.
- `npm run build`: `dist/` 삭제 후 `tsc` 컴파일.
- `npm run type`: 파일 출력 없이 TypeScript 타입 검사.
- `npm run lint`: 저장소 전체 ESLint 실행.
- `npm run lint:strict`: `--max-warnings 0`으로 ESLint 실행.
- `npm run lint:scripts`: `scripts/**/*.cjs` 린트.
- `npm run format`: Prettier로 저장소 포맷.
- `npm run clean`: `dist`, `node_modules`, `package-lock.json` 삭제 후 재설치.

## 라이선스

PolyForm Noncommercial License 1.0.0. 자세한 내용은 [LICENSE](./LICENSE)를 참고하세요.
