# Advanced Main+Shard Architecture (No-Loss Focus)

이 문서는 본 리포지토리(`D:\logger_bot`)의 특성(로깅 봇, PostgreSQL/Redis 의존성, 고트래픽) 기준으로
`Main + Shard` 구조를 **유실 최소화(운영상 무손실 목표)** 중심으로 정의한 설계 문서다.

목표는 단순 Discord 샤딩이 아니라:

- Main도 실제 샤드 워커 역할을 수행
- 외부 Shard 프로세스도 Main이 관리
- Main 장애 시 안전한 권한 승계
- 중복 적재와 유실을 동시에 제어

를 만족하는 것이다.

---

## 1. 용어 정의

- `Main Node`: 제어 권한(leader 가능) + 샤드 워커 역할을 동시에 수행하는 노드
- `Shard Node`: 샤드 워커 역할만 수행하거나, 상황에 따라 leader 후보가 될 수 있는 노드
- `Leader`: 현재 epoch에서 shard assignment를 발행할 수 있는 단일 제어자
- `Epoch`: 리더 세대 번호. 리더 변경 시 반드시 증가
- `Lease`: shard 소유권의 시간 제한 권한(만료 시 즉시 무효)
- `Fencing Token`: 오래된 리더/소유자의 명령을 차단하기 위한 단조 증가 또는 세대 결합 토큰
- `Control Plane`: 등록/할당/헬스/승계 통신 계층
- `Data Plane`: Discord 이벤트 수집 및 DB/큐 적재 계층

---

## 2. 설계 원칙 (반드시 고정)

1. `Ingest는 샤드에서 수행한다.`
   Main이 중앙 수집기가 되면 Main 장애가 즉시 수집 장애로 연결되므로 금지.

2. `제어권과 수집경로를 분리한다.`
   Leader 장애 시에도 기존 lease 유효 기간 동안 shard ingest는 계속되어야 한다.

3. `At-least-once + Idempotent write`를 기본 모델로 한다.
   중복 가능성을 허용하되, 저장소에서 최종 중복을 제거한다.

4. `Fail-closed`를 기본 동작으로 한다.
   lease/epoch/인증 검증 실패 시 “대충 계속 처리”가 아니라 즉시 write 중단.

5. `모든 권한은 시간 제한(lease) 기반`으로 한다.
   영구 권한/무기한 소유권은 split-brain 상황에서 중복 쓰기를 유발한다.

6. `Gateway 세션 제어(Identify/Resume)는 중앙 정책으로 제한한다.`
   lease가 유효해도 identify 예산/버킷 규칙을 위반하면 shard 기동을 지연해야 한다.

---

## 3. 현재 코드베이스 관찰 요약

핵심 관련 파일:

- `src/index.ts`: 단일 프로세스 초기화/실행 결합
- `src/utils/discordClient.ts`: 전역 단일 client 인스턴스
- `src/queue/logEventQueue.ts`: Redis 큐 + enqueue 실패 시 direct write fallback
- `src/db/logWrites.ts`: `messageCreate`만 결정적 `event_id`, `ON CONFLICT(event_id) DO NOTHING`
- `src/services/startupMessageRecoveryService.ts`: 재시작 시 `messageCreate` 복구

중요 포인트:

1. 현재 구조는 단일 런타임 가정이 강함 (`/reload`, `/status` 등).
2. queue 실패 시 direct fallback은 단일 인스턴스에서는 유용하지만, 분산 장애 상황에서 중복/폭주를 키울 수 있음.
3. 중복 방지는 일부 이벤트(`messageCreate`)에 강하고, 전 이벤트 타입에 대해 일관된 idempotency 정책은 아직 없음.
4. 과거 기본값(`REDIS_CLEAR_ON_STARTUP=true`)은 분산/무손실 지향 운영과 충돌 소지가 있었음.
5. 분산 모드(`DISTRIBUTED_MODE=true`)에서는 `REDIS_CLEAR_ON_STARTUP=false` 강제 + enqueue 실패 direct fallback 금지(fail-closed)가 필요함.

---

## 4. 시스템 목표 / 비목표

### 목표

1. Main/Shard 혼합 워커 구조에서 리더 장애 시 자동 승계
2. shard ownership 중복 없는 할당
3. 이벤트 누락 최소화와 중복 억제의 동시 달성
4. Pg/Redis 불안정 시 안전한 강등과 복구

### 비목표

1. “절대 0 유실”을 수학적으로 보장한다는 주장
   Discord Gateway/네트워크 특성상 이론적 절대보장은 어렵다.
   대신 운영적으로는 무손실에 매우 근접한 체계를 목표로 한다.

### 4.1 적용 결정 상태 (v1, 2026-03-22)

아래 항목은 “추후 결정”이 아니라 본 문서 기준으로 고정한다.

1. 합의 저장소: `PostgreSQL advisory lock + leader_epoch/fencing sequence 테이블`
2. 제어 plane 브로커: `Redis Streams + Pub/Sub + TTL heartbeat`
3. durable inbox: `Redis Streams`를 기본으로 사용하고, 브로커 비가용 시 `로컬 WAL`로 임시 강등
4. 분산 모드 fallback: enqueue 실패 시 direct DB write 금지(즉시 fail-closed)
5. Gateway 정책: `resume-first`, identify permit 1회성, bucket 직렬화, 대량 재기동 stagger

---

## 5. 역할 모델

### 5.1 Main Node

1. Leader일 때만 수행:

- shard assignment 발행/회수
- lease 및 fencing token 갱신
- cluster-wide 명령(`/reload`, 집계 `/status`) 오케스트레이션

2. Leader가 아니어도 수행:

- 자신에게 배정된 shard 워커 실행
- 이벤트 수집/적재

### 5.2 Shard Node

1. 할당받은 shard ID만 실행
2. heartbeat/metrics/reporting 송신
3. lease 검증 실패 시 즉시 ingest 정지

---

## 6. 통신 및 발견(Discovery) 모델

핵심 결정:

- 샤드끼리 직접 탐색하지 않는다.
- `Shard -> Broker` 아웃바운드 연결만 허용한다.
- Main/Shard 모두 Redis를 Control Plane 브로커로 사용한다.

권장 채널 분리:

1. 신뢰성 필요 명령: Redis Streams

- `register`, `assign`, `revoke`, `reload_all`, `sync`, `promote`

2. 저지연 알림: Pub/Sub

- `cache_invalidate`, `notice`

3. liveness: TTL key

- `node:{nodeId}:heartbeat`
- `leader:heartbeat`

---

## 7. 신원 검증 및 보안 모델

리버스 쉘 방식은 사용하지 않는다.

### 7.1 최소 요구

1. 사전 공유 키 기반 HMAC challenge-response
2. nonce 1회성 사용 및 만료 시간 강제
3. 메시지에 `timestamp`, `expires_at`, `signature` 포함

### 7.2 권장 운영 수준

1. mTLS(클라이언트 인증서)
2. 짧은 TTL의 등록 토큰(JWT 또는 1회성 토큰)
3. `node_id <-> cert fingerprint` 정적 허용 목록
4. 내부망/VPN(WireGuard 등) 한정 통신

---

## 8. 리더 선출 및 승계

### 8.1 선출

1. 후보 노드가 leader lock 획득 경쟁
2. lock 획득 성공 노드만 `leader_epoch = previous + 1` 발행
3. epoch 미증가 리더는 무효

### 8.2 승계 시 동작

1. 새 Leader는 즉시 전체 shard를 재할당하지 않는다.
2. 기존 lease 만료 + grace window 경과 후 재배정
3. 구 epoch 명령은 전부 폐기
4. 새 epoch + fencing token만 유효

### 8.3 Split-brain 방지

1. “리더라고 주장”하는 것만으로 권한 부여 금지
2. lock store(합의 저장소) 기준으로만 유효 리더 판단
3. fencing token 없는 명령은 전면 거부

### 8.4 Gateway 세션 제어 (Identify/Resume)

1. `Resume-first`:

- 재연결 시 shard worker는 기존 `session_id + seq`로 resume를 먼저 시도한다.
- resume 실패가 확인된 경우에만 identify로 승격한다.

2. `Identify permit`:

- identify는 worker가 임의로 실행하지 않고, leader가 발행한 permit을 받은 shard만 수행한다.
- permit은 `permit_id`, `epoch`, `shard_id`, `bucket_id`, `expires_at`을 포함하며 1회성이다.
- shard는 identify 직전에 `identify:permit:consumed:{epoch}:{shard_id}:{permit_id}` 키를 `SET NX EX`로 원자 소비한다.
- 이미 소비된 permit 또는 만료 permit은 거부하고 identify를 실행하지 않는다.
- epoch 변경 시 이전 epoch의 미소비 permit은 전부 무효 처리한다.

3. `Max concurrency 준수`:

- Discord의 `session start limit.max_concurrency` 버킷별로 identify를 직렬화/제한한다.
- 동일 버킷 shard들은 leader 스케줄에 따라 순차 identify 한다.

4. `재시작/승계 시 기동 파형 제어`:

- 대량 재기동 시 전체 shard 동시 identify를 금지하고, 배치/지연(stagger) 기동을 강제한다.
- leader 승계 직후에도 기존 lease + grace를 우선 존중하고, 필요 shard만 점진 기동한다.

5. `예산 소진 보호`:

- `session_start_limit.remaining` 임계 이하에서는 비필수 shard 재기동을 중지하고 운영 경보를 발송한다.
- 예산 회복 전에는 강제 identify 재시도를 금지한다.

### 8.5 Resume 승계 상태 저장 규약 (필수)

`Resume-first`를 실제로 성립시키기 위해 shard별 세션 상태를 내구 저장한다.

1. 저장 키: `gateway:session:{shard_id}`
2. 저장 필드:

- `session_id`, `seq`, `resume_gateway_url`
- `updated_at`, `owner_node_id`, `owner_epoch`, `lease_expires_at`

3. 기록 시점:

- `READY` 수신 직후
- `RESUMED` 수신 직후
- `seq`가 N(기본 100) 증가할 때마다 주기적 스냅샷
- shard 정상 종료 직전 flush

4. 승계 시도 규칙:

- 새 owner는 assignment 수락 후 저장된 세션으로 `resume` 1~3회(지수 백오프) 우선 시도
- `INVALID_SESSION` 또는 만료 판정 시에만 leader의 identify permit으로 승격
- permit 없이 identify 실행 시 shard를 즉시 `IngressPaused`로 강등

---

## 9. 이벤트 처리 경로 (권장)

1. Discord 이벤트 수신 (해당 shard owner)
2. 이벤트 정규화 + idempotency key 생성
3. durable inbox append (기본: Redis Streams, 강등: 로컬 WAL)
4. 비동기 적재 worker가 DB INSERT
5. DB `UNIQUE`/`ON CONFLICT DO NOTHING`로 최종 중복 제거
6. 성공 offset/ack 갱신

핵심:

- ingest 직후 내구성 계층에 먼저 기록해야 Redis/Pg 순간 장애에서 유실을 줄일 수 있다.
- queue 실패 시 direct write로 우회하는 로직은 분산 모드에서는 정책적으로 제한 또는 금지해야 한다.

### 9.1 로컬 WAL 강등 실행 규약 (필수)

`Redis Streams`를 사용할 수 없을 때의 강등 경로를 아래처럼 고정한다.

1. append 단위

- 이벤트 1건당 1레코드(JSONL 또는 length-prefixed binary)로 append
- 레코드 필드: `wal_seq`, `ingested_at`, `event_id`, `event_type`, `payload_hash`, `payload`

2. flush/fsync

- 기본: 배치 append 후 `100ms` 이내 주기 fsync
- 프로세스 종료 훅에서 강제 flush + fsync

3. replay/ack

- 재주입은 `wal_seq` 오름차순으로 수행
- DB 반영 성공(또는 idempotent conflict 확인) 후에만 `ack_seq` 커밋
- `ack_seq` 이전 세그먼트만 삭제 가능

4. 세그먼트/보존

- 고정 크기 세그먼트 롤링(예: `128MB`)
- `disk watermark` 임계(예: 85%) 초과 시 운영 경보 + ingress 점진 감속
- `WAL append 불가` 상태가 되면 즉시 `IngressPaused`로 전환(fail-closed)

---

## 10. 중복 방지(멱등성) 정책

### 10.1 기본 규칙

1. 모든 이벤트 타입에 idempotency key 전략을 정의한다.
2. DB는 이벤트 고유키 UNIQUE를 강제한다.
3. 재처리/재전송은 허용하되 결과는 1회 반영만 허용한다.

### 10.2 키 설계 원칙

1. 가능한 경우 원본 리소스 ID 기반

- 예: message ID, guild scheduled event ID, role ID

2. 원본 단일 ID가 없는 경우 복합키

- 시간 버킷 단독 기준은 금지한다.
- 변경 주체/대상/변경종류/원본 버전(또는 seq)을 포함한 불변 필드 조합을 우선한다.
- 시간값이 필요하면 보조 필드로만 사용하고, 충돌 방지용 해시를 결합한다.

3. 충돌 우려 시 hash suffix 사용

참고:

- 현재 `src/db/logWrites.ts`는 `messageCreate`에 결정적 eventId를 사용한다.
- 같은 패턴을 전 이벤트로 확대해야 승계/재처리 구간 중복이 억제된다.

### 10.3 이벤트 타입별 키 매핑 표 (필수 산출물)

아래 표를 구현 기준의 `v1 baseline`으로 고정한다. 신규 이벤트가 추가되면 같은 형식으로 표를 먼저 확장한다.

| eventType                                                                                                                            | source identity(원본 식별자)                                         | idempotency key 규칙                                                  | DB UNIQUE 대상                                                | 재처리 허용 여부 | 비고                        |
| ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------- | ---------------- | --------------------------- |
| `messageCreate`                                                                                                                      | `guild_id, channel_id, message.id`                                   | deterministic UUID(`messageCreate,guild,channel,message`)             | `event_id` + partial unique `(guild_id,event_type,target_id)` | 허용             | 현재 구현 존재, 유지        |
| `messageDelete`                                                                                                                      | `guild_id, channel_id, message.id`                                   | deterministic UUID(`messageDelete,guild,channel,message`)             | `event_id`                                                    | 허용             | tombstone 데이터 포함       |
| `messageUpdate`                                                                                                                      | `guild_id, channel_id, message.id, content_fingerprint`              | deterministic UUID(`messageUpdate,guild,channel,message,fingerprint`) | `event_id`                                                    | 허용             | 단순 `message.id` 단독 금지 |
| `messageDeleteBulk`                                                                                                                  | `guild_id, channel_id, sorted(messageIds)_hash`                      | deterministic hash UUID                                               | `event_id`                                                    | 허용             | 배열 순서 영향 제거 후 해시 |
| `messageReactionAdd`, `messageReactionRemove`                                                                                        | `guild_id, channel_id, message.id, user_id, emoji, action`           | deterministic UUID                                                    | `event_id`                                                    | 허용             | `action(add/remove)` 포함   |
| `channelCreate`, `channelDelete`                                                                                                     | `guild_id, channel.id, action`                                       | deterministic UUID                                                    | `event_id`                                                    | 허용             | 생성/삭제 분리              |
| `channelUpdate`, `roleUpdate`, `stickerUpdate`, `threadUpdate`, `guildScheduledEventUpdate`                                          | `target_id, change_fingerprint, audit_log_entry_id(optional)`        | deterministic hash UUID                                               | `event_id`                                                    | 허용             | 시간 버킷 단독 금지         |
| `roleCreate`, `roleDelete`, `emojiCreate`, `emojiDelete`, `stickerCreate`, `stickerDelete`, `threadCreate`, `threadDelete`           | `guild_id, target_id, action`                                        | deterministic UUID                                                    | `event_id`                                                    | 허용             | 리소스 생명주기 이벤트      |
| `guildMemberAdd`, `guildMemberRemove`, `guildBanAdd`, `guildBanRemove`                                                               | `guild_id, target_user_id, action`                                   | deterministic UUID                                                    | `event_id`                                                    | 허용             | 대상 사용자 기준            |
| `guildMemberNicknameUpdate`, `guildMemberRoleUpdate`, `guildMemberAvatarUpdate`, `guildMemberTimeoutAdd`, `guildMemberTimeoutRemove` | `guild_id, target_user_id, action, change_fingerprint`               | deterministic hash UUID                                               | `event_id`                                                    | 허용             | 변경 fingerprint 필수       |
| `guildNameUpdate`, `guildIconUpdate`, `guildOwnerUpdate`                                                                             | `guild_id, action, change_fingerprint, audit_log_entry_id(optional)` | deterministic hash UUID                                               | `event_id`                                                    | 허용             | guild 단위 변경             |
| `inviteCreate`, `inviteDelete`                                                                                                       | `guild_id, invite.code, action`                                      | deterministic UUID                                                    | `event_id`                                                    | 허용             | invite code 중심            |
| `voiceChannelJoin`, `voiceChannelLeave`, `voiceChannelMove`                                                                          | `guild_id, user_id, action, old_channel_id, new_channel_id`          | deterministic UUID                                                    | `event_id`                                                    | 허용             | move는 old/new 모두 포함    |
| `voiceStateUpdate`(mute/deaf/stream/video)                                                                                           | `guild_id, user_id, action, old_state, new_state, channel_id`        | deterministic hash UUID                                               | `event_id`                                                    | 허용             | 상태 전이 기반              |
| `userUpdate`                                                                                                                         | `user_id, change_fingerprint`                                        | deterministic hash UUID                                               | `event_id`                                                    | 허용             | 글로벌 사용자 변경          |

---

## 11. 장애 시나리오 대응 표

| 시나리오              | 감지                                                        | 즉시 조치                                                  | write 정책                                                                           | 복구                                |
| --------------------- | ----------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------- |
| Leader(Main) 다운     | leader heartbeat TTL 만료                                   | follower 선출 경쟁                                         | 기존 lease 유효 범위 내 shard 계속 ingest                                            | 새 leader가 epoch+1 후 lease 재발급 |
| Worker shard 다운     | node heartbeat TTL 만료                                     | 해당 shard lease 회수 예약                                 | grace 전 재배정 금지                                                                 | grace 후 재배정                     |
| Worker 하드다운 확정  | heartbeat TTL 만료 + 연속 renew 실패 + control channel 단절 | 해당 shard 조기 회수(강제 fencing token 증가)              | 기존 owner write 즉시 차단, 새 owner 점진 기동                                       | quarantine window 후 정상 편입      |
| Redis 제어 plane 장애 | ping/timeout 연속 실패                                      | cluster `Frozen`(신규 재할당/permit 중지), 기존 owner 유지 | `lease_ttl + grace_window` 내에는 로컬 WAL 경로로 제한 ingest 허용, 이후 fail-closed | Redis 정상화 후 재등록/재선출       |
| Pg 장애               | DB error rate 임계 초과                                     | ingest는 durable inbox까지, DB flush 중단                  | direct fallback 남발 금지                                                            | DB 복구 후 backlog drain            |
| 네트워크 분할         | heartbeat 불일치/지연                                       | lock store 기준으로 유효 리더만 유지                       | 구 epoch 명령/쓰기 차단                                                              | 네트워크 회복 후 재동기화           |

---

## 12. Fail-Closed 규칙 (실행 규약)

아래 중 하나라도 참이면 shard는 이벤트 write를 멈춘다.

1. lease 만료
2. epoch 불일치
3. fencing token 검증 실패
4. 인증된 control channel 단절 상태에서 `lease_ttl + grace_window` 내 재검증/renew에 실패
5. 저장소 내구성 경로(durable inbox) 비가용이며 로컬 WAL도 불가

멈춘 shard는:

1. durable inbox/WAL이 모두 불가하면 Discord ingress를 중지(disconnect 또는 이벤트 소비 중단)하고 write를 금지
2. 주기적으로 재등록/재할당 시도
3. 운영 경보를 즉시 발송

추가 규칙:

1. write가 금지된 상태에서 이벤트를 계속 수신해 폐기하는 동작은 금지한다.
2. 내구성 경로가 회복되기 전까지 shard를 `IngressPaused` 상태로 유지한다.
3. control plane 단절 중에는 기존 owner shard만 유지하며, 신규 shard assignment/reload/identify permit 발행을 금지한다.

---

## 13. “이벤트 유실 금지” 관점의 현실적 전략

절대 유실 0을 주장하는 대신, 아래 3중 전략을 고정한다.

1. 실시간 경로: at-least-once ingest + idempotent DB write
2. 내구성 경로: durable inbox 또는 WAL spool
3. 사후 보정: startup recovery/backfill/reconciliation 확장

추가 권장:

1. 이벤트 타입별 재수집 가능성 분류

- 재수집 가능(`messageCreate`류) vs 제한적(`일부 상태 변경`)

2. 재수집 어려운 이벤트는 더욱 강한 실시간 내구성 경로 필요

---

## 14. 운영 메트릭 / SLO

### 필수 메트릭

1. shard별 ingest rate
2. durable inbox lag
3. DB insert success/fail ratio
4. dedupe hit ratio(ON CONFLICT 비율)
5. lease renew latency/failure
6. leader election count 및 빈도
7. recovery(backfill)로 복원된 이벤트 수

### 경보 기준 예시

1. leader election이 짧은 기간 내 반복
2. inbox lag 급증
3. lease renew 실패율 임계 초과
4. dedupe hit 급증(중복 폭주 신호)

---

## 15. 단계적 전환 계획

### Phase 0: 안전장치 우선

1. 분산 모드 플래그 도입
2. 분산 모드에서 queue 실패 시 direct fallback 정책 재정의(기본 fail-closed)
3. shard 상태/lease 관측 메트릭 추가
4. 분산 모드 기본값에서 `REDIS_CLEAR_ON_STARTUP=false`를 강제

현재 코드 반영 상태:

- `DISTRIBUTED_MODE` 플래그: 반영됨
- 분산 모드 direct fallback 금지: 반영됨
- 분산 모드에서 `REDIS_CLEAR_ON_STARTUP=false` 강제: 반영됨
- lease 관측 메트릭: 미반영(Phase 2와 함께 구현)

### Phase 1: 런타임 분리

1. `main runtime` / `worker runtime` 분리
2. Main도 shard 워커를 실행할 수 있게 구성
3. 단일 프로세스 전제 명령(`/reload`, `/status`)을 cluster-aware로 전환
4. 전역 슬래시 커맨드 등록은 leader 단일 책임으로 제한(중복 등록 경쟁 방지)

### Phase 2: 제어 평면 도입

1. register/assign/heartbeat/lease/fencing 프로토콜 구현
2. leader election + epoch 관리
3. 승계/재배정 동작 검증
4. identify permit 발행기 + resume-first 게이트웨이 재접속 정책 구현

### Phase 3: 멱등성 확장

1. 이벤트 타입별 idempotency key 표 확정
2. DB 고유 제약/인덱스 확장
3. dedupe 지표 기반 튜닝

### Phase 4: 복구 체계 강화

1. startup recovery 범위 확장
2. 주기적 reconciliation 작업 도입
3. 장애 복구 runbook 확정

---

## 16. 수용 기준 (Acceptance Criteria)

1. Main 장애 시, grace window 내 shard ingest가 지속된다.
2. leader 승계 후 같은 shard에 대해 동시 owner가 발생하지 않는다.
3. 중복 주입 테스트에서 DB 최종 반영은 1건으로 수렴한다.
4. Redis/Pg 장애 테스트에서 정책대로 fail-closed 또는 backlog 축적이 동작한다.
5. 복구 후 backlog drain 및 reconciliation 결과가 관측 가능하다.
6. 재기동/승계/네트워크 흔들림 상황에서도 identify rate-limit 위반 없이 shard가 점진 복구된다.
7. fail-closed 발동 시 ingress stop이 관측되며, 회복 전 이벤트 폐기가 발생하지 않는다.

---

## 17. 구현 고정값 (v1)

1. 합의 저장소

- `PostgreSQL advisory lock`을 리더 선출에 사용
- `leader_epoch`, `fencing_counter`는 Postgres 트랜잭션으로 단조 증가 보장
- Redis lock 단독 리더 선출은 사용하지 않음

2. durable inbox

- 1차: `Redis Streams`
- 2차: Redis 비가용 시 노드 로컬 `WAL spool`로 강등 후 복구 시 재주입
- `WAL ack_seq` 커밋 이전 세그먼트 삭제 금지
- `WAL append + fsync` 실패 시 즉시 `IngressPaused`

3. lease/heartbeat 기본값

- `lease_ttl = 15s`
- `renew_interval = 5s`
- `suspect_threshold = 6s`
- `grace_window = 20s`
- `quarantine_window = 30s` (조기 회수된 shard 재편입 대기)

4. 분산 모드 fallback 정책

- `enqueue 실패 -> direct DB write` 금지
- 분산 모드에서 Redis 큐가 시작되지 않으면 프로세스 부팅 실패(fail-closed)

5. Gateway 세션 정책

- identify permit TTL: `30s` (1회성)
- identify permit 원자 소비 키: `identify:permit:consumed:{epoch}:{shard_id}:{permit_id}`
- bucket 스케줄링: `max_concurrency` 버킷별 직렬, 버킷 내 identify 최소 간격 `5s`
- resume 재시도: 최대 `3회`, 백오프 `1s -> 2s -> 4s`
- permit 없는 identify 시도는 정책 위반으로 shard `IngressPaused`

6. 전역 명령 오케스트레이션

- `/reload`, 집계 `/status`는 leader가 fan-out
- slash command 전역 등록은 leader 단일 책임
- follower/Main-worker는 등록/동기화 요청만 전송

---

## 18. 결론

로깅 봇에서 핵심은 “누가 리더인가” 자체보다:

1. write 권한이 시간 제한/토큰으로 엄격히 통제되는지
2. 장애 시 write를 안전하게 멈추거나 내구성 버퍼로 넘기는지
3. 중복을 저장소 수준에서 최종 제거하는지

에 달려 있다.

본 문서는 그 기준을 먼저 고정하기 위한 운영 설계 기준이며,
세부 프로토콜/코드 구현은 이 기준을 벗어나지 않는 선에서 진행해야 한다.
