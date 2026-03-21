[한국어](./README.ko.md) | [English](./README.md)

# Discord 로그 봇

TypeScript + Discord.js v14 기반의 운영형 로거 봇입니다.  
대량 길드 이벤트를 PostgreSQL에 안정적으로 적재하고, 검색/내보내기/알림/리포트/운영 명령을 슬래시 커맨드로 제공합니다.

## 핵심 강점

- 메시지, 수정/삭제, 리액션, 멤버, 역할, 채널, 스레드, 음성, 초대, 예약 이벤트, 스티커 등 폭넓은 이벤트 로깅.
- PostgreSQL 중심 구조와 중복 방지 적재 로직.
- 트래픽 급증 대응을 위한 Redis 기반 선택형 큐 적재.
- 재시작 후 누락 `messageCreate` 로그를 메우는 시작 복구 기능.
- 실무형 슬래시 명령 세트:
- 로그 작업: `log-search`, `log-export`, `log-alert-*`
- 메시지 작업: `message-send-*`, `message-delete-*`, `log-*-messages`
- 리포트: `report-guild`, `report-channel`, `report-user`
- 운영/관리: `status`, `reload`, `perm`
- 첨부 파일 저장소 다중 백엔드 지원: `local`, `webdav`, `s3`, `smb`.
- 권한 검사, 허용 길드 관리, 그레이스풀 셧다운, Sentry 연동 등 운영 안정성 기능 포함.
- `en`, `ko` i18n 리소스 기본 제공.

## 빠른 시작

1. 의존성을 설치합니다.
    ```bash
    npm install
    ```
2. `.env.example`를 복사해 `.env`를 만들고 값을 채웁니다.
    ```bash
    cp .env.example .env
    ```
3. DB 스키마를 초기화/마이그레이션합니다.
    ```bash
    npm run db:setup
    npm run db:migrate
    ```
4. 빌드 후 실행합니다.
    ```bash
    npm run build
    npm start
    ```

## 개발 명령어

- `npm run dev`: 빌드 후 개발 모드 실행.
- `npm run dev:build:watch`: TypeScript watch 빌드.
- `npm run dev:run:watch`: 컴파일 결과 변경 감지 후 재실행.
- `npm run lint`: ESLint 실행.
- `npm run format`: Prettier 포맷 적용.
- `npm run type`: 타입 검사만 수행.
- `npm run verify:release`: 릴리즈 전 엄격 검증(lint/type/build/audit).

환경 변수 상세 설명은 `.env.example`만 기준으로 유지합니다.

## 라이선스

ISC
