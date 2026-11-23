# 수동 준비 절차

코드 외에 사람이 브라우저에서 한 번 해야 하는 준비다. 발급받은 키·시크릿·토큰은 `.env`와 `secrets/`에만 넣고,
Claude Code 대화창이나 커밋에 붙여넣지 않는다.

`<PUBLIC_BASE_URL>`은 개발 중에는 터널 주소, 배포 후에는 서버 주소다. 바뀌면 아래 URL들도 함께 바꾼다.

---

## 1. GitHub App 만들기

소유 계정은 개인 계정보다 부트캠프 조직 계정(또는 운영용 봇 계정)을 권장한다.
Settings → Developer settings → GitHub Apps → New GitHub App

| 항목 | 값 |
| --- | --- |
| GitHub App name | 예: `bootcamp-notify-bot` (이 이름이 설치 링크의 slug가 됨) |
| Homepage URL | 아무 안내 페이지 또는 리포 주소 |
| Setup URL | `<PUBLIC_BASE_URL>/github/setup` |
| Redirect on update | 체크 |
| Request user authorization (OAuth) during installation | 체크 해제 |
| Webhook Active | 체크 |
| Webhook URL | `<PUBLIC_BASE_URL>/github/webhook` |
| Webhook secret | 긴 랜덤 문자열 생성 → `.env`의 `GITHUB_WEBHOOK_SECRET` |
| Where can this GitHub App be installed? | **Any account** |

### Repository permissions

| 권한 | 수준 | 용도 |
| --- | --- | --- |
| Metadata | Read-only | 필수 |
| Contents | Read-only | push diff, 파일 검사 |
| Pull requests | Read-only | PR·리뷰 상태 |
| Actions | Read-only | 워크플로 결과 |
| Issues | Read-only | 마일스톤 |
| Administration | **Read and write** | 룰셋 적용, 기본 브랜치 변경(2단계부터 사용) |

### Organization permissions

| 권한 | 수준 |
| --- | --- |
| Members | Read-only |

### Subscribe to events

`Pull request`, `Pull request review`, `Push`, `Workflow run`, `Release`, `Create`, `Milestone`,
`Repository`, `Repository ruleset`
(`installation` 관련 이벤트는 자동으로 전달된다)

### 생성 후

1. App ID → `.env`의 `GITHUB_APP_ID`
2. App 이름의 slug → `GITHUB_APP_SLUG`
3. Private keys → Generate a private key → 내려받은 `.pem`을 `secrets/github-app.pem`으로 저장

---

## 2. Slack App 만들기

https://api.slack.com/apps → Create New App → **From an app manifest** → 워크스페이스 선택 → 아래 YAML 붙여넣기
(`<PUBLIC_BASE_URL>`을 실제 주소로 바꾼 뒤)

```yaml
display_information:
  name: Bootcamp GitHub Bot
  description: 팀 GitHub 조직의 PR·브랜치·리뷰 알림
features:
  bot_user:
    display_name: github-bot
    always_online: true
  slash_commands:
    - command: /module
      url: <PUBLIC_BASE_URL>/slack/events
      description: 모듈 시작·종료 (운영진)
      usage_hint: "start | end [모듈ID]"
      should_escape: false
    - command: /team
      url: <PUBLIC_BASE_URL>/slack/events
      description: 팀 등록·이동
      usage_hint: "create [팀명] @팀원..."
      should_escape: false
    - command: /cohort
      url: <PUBLIC_BASE_URL>/slack/events
      description: 기수 생성 (운영진)
      usage_hint: "start [기수명]"
      should_escape: false
    - command: /github-link
      url: <PUBLIC_BASE_URL>/slack/events
      description: 내 GitHub 계정 연결
      usage_hint: "[GitHub 아이디]"
      should_escape: false
    - command: /notify-settings
      url: <PUBLIC_BASE_URL>/slack/events
      description: 팀 알림·브랜치 전략 설정 (팀장)
      usage_hint: "[view | audit | delegate @팀원]"
      should_escape: false
    - command: /pr-status
      url: <PUBLIC_BASE_URL>/slack/events
      description: 열린 PR 현황
      should_escape: false
oauth_config:
  scopes:
    bot:
      - chat:write
      - commands
      - channels:manage
      - channels:read
      - users:read
      - im:write
settings:
  interactivity:
    is_enabled: true
    request_url: <PUBLIC_BASE_URL>/slack/events
  org_deploy_enabled: false
  socket_mode_enabled: false
  token_rotation_enabled: false
```

아직 구현되지 않은 커맨드는 봇이 "준비 중"으로 응답하도록 만든다. 커맨드를 미리 다 등록해두면 나중에 매니페스트를 다시 고칠 필요가 없다.

### 생성 후

1. Basic Information → Signing Secret → `.env`의 `SLACK_SIGNING_SECRET`
2. Install to Workspace → Bot User OAuth Token(`xoxb-…`) → `SLACK_BOT_TOKEN`
3. 슬랙에서 운영진 채널(예: `#ops-github`)을 만들고 봇을 초대 → 채널 ID → `OPS_CHANNEL_ID`
   (채널 이름 클릭 → 하단에 채널 ID 표시)

---

## 3. 나머지 환경변수

- `STATE_SIGNING_SECRET`: 설치 링크 state 서명용 긴 랜덤 문자열
- `PUBLIC_BASE_URL`: 터널 또는 서버 주소(끝에 `/` 없이)

랜덤 문자열 생성 예: `openssl rand -hex 32`
