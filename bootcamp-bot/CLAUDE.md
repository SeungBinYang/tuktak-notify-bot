# Bootcamp GitHub–Slack Bot

부트캠프 팀별 GitHub 조직의 PR·브랜치·리뷰 이벤트를 슬랙 팀 채널과 운영진 채널로 알리고,
팀이 고른 브랜치 전략을 룰셋으로 강제하며, 막지 못한 위반은 사후 감지하는 봇이다.

- 설계 문서: `docs/DESIGN.md` — 모든 기능 번호(#1~#26)는 설계서 "알림 기능 전체 목록"의 번호를 따른다.
- 수동 준비 절차: `docs/SETUP.md` (GitHub App·Slack App 생성은 사람이 브라우저에서 한다)

## 현재 단계

**1단계 완료** (단위 테스트 42개, 통합 테스트 15개 통과: `npm test`, `npm run test:e2e`) → 다음은 **2단계 — 브랜치 전략과 사람 연결** (설계서 "구현 단계 로드맵")

1단계에서 만든 것:
- 웹훅 수신(서명 검증, 즉시 200, `jobs` 큐, `X-GitHub-Delivery` 중복 제거), 실패 3회 시 운영진 보고
- 설치 연결 플로우(`src/github/setup.ts`, 서명된 `state`, 재설치 시 이전 설치 해제)
- 기능 #1, #2, #3, #5(리뷰 승인·변경 요청을 팀 채널로, 설계서의 작성자 DM 대신), #9, #10 (`src/github/handlers/`), 기능 레지스트리와 단일 발송 출구(`src/core/router.ts`의 `emit`)
- `/health`, 슬래시 커맨드는 "준비 중" 응답만
- 팀 등록은 `npm run seed:pilot` (`src/core/seed.ts`), 모달 대신 사용 중
- Dockerfile, GitHub Actions CI, Dependabot

2단계 범위: 브랜치 전략 프리셋·보호 옵션과 리포 단위 룰셋 자동 적용, 룰셋 변경 감지·복구, `/github-link`, `/notify-settings` 1차.
범위 밖 기능은 만들지 않는다. 단계가 끝나면 이 섹션을 갱신한다.

## 운영 방식

- **폴링 모드(현재 운영)**: `src/poll.ts`를 GitHub Actions(`.github/workflows/poll.yml`)가 5분마다 실행. 주 시계는 cron-job.org의 workflow_dispatch 호출, 예비로 schedule. 상태는 `state/bot.db`를 Actions 캐시로 넘긴다. `src/poll/poller.ts`가 GitHub 상태를 웹훅 모양 이벤트로 바꿔 기존 핸들러를 그대로 쓴다. 자세한 절차: `docs/HOSTING.md`
- 웹훅 모드(선택): `src/index.ts` 상시 서버. 즉시 알림이 필요할 때.
- 새 기능은 핸들러(`src/github/handlers/`)에 만들고, 폴링 모드에서 필요한 조회는 `src/poll/`에 추가한다.

## 기술 스택

- Node.js LTS(22 이상), TypeScript(strict), ESM
- Slack: `@slack/bolt` (HTTP 모드, ExpressReceiver) — GitHub 라우트도 같은 Express 서버에 마운트
- GitHub: `@octokit/app` (App 인증, installation token, 웹훅 서명 검증)
- DB: Node 내장 SQLite(`node:sqlite`, `src/db/repo.ts`의 `DB` 래퍼). 네이티브 모듈 설치가 필요 없다. ORM 없이 SQL 직접 사용. 스키마는 `src/db/migrations.ts`에 번호순으로 추가(배포된 항목은 수정 금지), 모든 쿼리는 `src/db/repo.ts`의 `Repo`에만 둔다
- 큐: DB `jobs` 테이블 기반 워커 루프(별도 브로커 없음)
- 스케줄: `node-cron` (4단계에서 추가 예정)
- 설정 검증: `zod`로 환경변수 로드·검증
- 테스트: Vitest, GitHub 웹훅 샘플 페이로드는 `test/fixtures/github/`
- 패키지 버전은 정확한 버전으로 고정한다.

## 디렉터리 구조

```
src/
  index.ts              # 서버 진입점(Express + Bolt + 워커)
  config.ts             # 환경변수 로드·검증(zod)
  core/
    features.ts         # 기능 레지스트리(번호, 기본값, 잠금 여부, 수신처)
    router.ts           # installation_id → 팀, emit(단일 발송 출구), 운영진 보고, 멘션
    queue.ts            # jobs 소비·재시도·워커
    state.ts            # 설치 링크 state HMAC 서명·검증
    seed.ts             # 파일럿 팀 등록, 환영 메시지
    ports.ts, context.ts# 외부 경계 인터페이스(GitHubApi, Notifier), 컨텍스트
  db/
    migrations.ts       # 스키마
    repo.ts             # 모든 SQL
  github/
    api.ts              # GitHubApi 구현(@octokit/app, installation token)
    webhook.ts          # POST /github/webhook
    setup.ts            # GET /github/setup
    verify.ts           # 웹훅 서명 검증
    handlers/           # 이벤트별 감지(pullRequest, push, installation)
  slack/
    app.ts              # Bolt 앱, 커맨드, Notifier 구현
scripts/                # seed-pilot.ts, migrate.ts
test/                   # Vitest, fixtures/ 에 웹훅 샘플
```

## 설계 불변식 (반드시 지킬 것)

1. 라우팅 키는 `installation_id` 하나다. 리포 이름에 의존하는 로직을 만들지 않는다.
2. 웹훅은 서명 검증 후 즉시 200을 응답하고, 실제 처리는 `jobs` 큐에서 한다. `X-GitHub-Delivery`를 고유키로 중복 처리를 막는다.
3. GitHub API는 App installation token으로만 호출한다. 개인 토큰(PAT)을 쓰지 않는다.
4. GitHub 쓰기 권한은 Administration(룰셋, 기본 브랜치)만 쓴다. 코드·콘텐츠·이슈 쓰기 호출을 만들지 않는다.
5. LLM·AI API를 호출하지 않는다. 운영 중 AI 토큰 비용 0이 원칙이다.
6. 모든 알림은 `core/features.ts` 레지스트리를 거쳐 발송한다. 핸들러가 슬랙을 직접 호출하지 않는다.
7. 잠금 기능(#3, #9, #10, #12, #13, #21, #22, #24)의 운영진 채널 발송은 팀 설정과 무관하게 항상 실행한다.
8. 미등록 또는 `closed` 상태 설치의 이벤트는 처리하지 않고, 운영진 채널에 1회만 보고한다.
9. 시크릿은 `.env`에서만 읽는다. 코드·테스트·로그·커밋에 실제 값을 넣지 않는다. 민감 정보 알림에도 키 값을 넣지 않는다.
10. 처리 중 예외는 삼키지 말고 로그와 함께 운영진 채널에 요약 보고한다.
11. 시간 기준은 `Asia/Seoul`이다.

## 작업 방식

- 큰 작업은 코드를 쓰기 전에 계획을 먼저 보여주고 승인받는다.
- 기능 하나씩: fixture 기반 테스트 작성 → 구현 → 테스트 통과 → 커밋.
- 외부 호출(GitHub API, Slack API)은 테스트에서 모킹한다. 실제 앱 없이도 `npm test`가 통과해야 한다.
- 커밋 메시지는 Conventional Commits(`feat:`, `fix:`, `test:`, `chore:`)를 따른다.
- `.env`, `secrets/`, `data/`는 절대 커밋하지 않는다.

## 명령

```
npm run dev         # 로컬 서버(감시 모드)
npm test            # 테스트
npm run lint        # 린트·타입체크
npm run db:migrate  # 마이그레이션 적용
```

## 로컬 연결 테스트

실제 GitHub·Slack 이벤트는 터널(ngrok, cloudflared 등)로 로컬 서버를 외부에 노출해 받는다.
터널 주소를 `.env`의 `PUBLIC_BASE_URL`과 GitHub App·Slack App 설정 URL에 넣는다.
