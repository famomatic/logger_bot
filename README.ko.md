<div style="display: flex; justify-content: center; gap: 1rem; margin-top: 20px;">
  <a href="/README.ko.md" style="text-decoration: none; cursor: pointer; font-weight: bold; color: inherit;">한국어</a>
  <a href="/README.md" style="text-decoration: none; cursor: pointer; font-weight: bold; color: inherit;">English</a>
</div>

# Discord 로그 봇

이 봇은 TypeScript로 작성된 Discord.js v14 기반 로거 봇으로, 다양한 서버 이벤트를 PostgreSQL 데이터베이스에 기록합니다. 첨부 파일은 WebDAV 서버에 저장할 수 있으며 여러 슬래시 명령어를 통해 메시지 관리와 로그 조회 기능을 제공합니다.

## 주요 특징

- **메시지, 멤버, 채널, 역할, 스레드 등** 광범위한 이벤트 기록
- 길드별 파티션을 이용한 **PostgreSQL 저장소**와 중복 방지 로직
- 메시지 전송/삭제, 과거 메시지 일괄 기록, 조건별 로그 검색 등 다양한 **슬래시 명령어**
- 개발자 레벨이 있는 사용자 전용 **레거시 명령어**(`logger ping`, `logger status`)
- 메시지 첨부 파일을 외부에 저장하기 위한 **WebDAV 연동**
- 오류 추적을 위한 **Sentry 통합**
- 모든 소스가 **TypeScript**로 작성되어 유지보수가 용이

## 시작하기

1. 의존성 설치
   ```bash
   npm install
   ```
2. 프로젝트 빌드
   ```bash
   npm run build
   ```
3. `.env.example` 파일을 참고해 환경 변수를 설정
4. 데이터베이스 마이그레이션 실행
   ```bash
   npm run db:migrate
   ```
5. 봇 실행
   ```bash
   npm start
   ```
6. 봇을 실행하면 자동으로 샤딩이 관리됩니다.
   ```bash
   npm start
   ```

## 환경 변수 예시

```dotenv
DISCORD_BOT_TOKEN=
DISCORD_CLIENT_ID=
BOT_DB_NAME=
BOT_DB_USER=
BOT_DB_PASSWORD=
PG_HOST=
PG_PORT=
WEBDAV_HOST=
WEBDAV_PORT=
WEBDAV_HTTPS=
WEBDAV_USERNAME=
WEBDAV_PASSWORD=
WEBDAV_BASE_PATH=
SENTRY_DSN=
DEV_LVL1_IDS=
DEV_LVL2_IDS=
DEV_LVL3_IDS=
```

더 자세한 항목은 `.env.example` 파일을 참고하세요.

## 라이선스

ISC
