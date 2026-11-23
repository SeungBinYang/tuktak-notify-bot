# 클라우드 운영 (서버 없이 5분마다 확인)

```
cron-job.org ──(정각·5분·10분… 정확히)──▶ GitHub Actions "poll" 실행 ──▶ GitHub 확인 ──▶ 슬랙 알림
                                    ▲
             GitHub 예약 실행(예비) ─┘  ※ 지연·누락될 수 있어 예비로만 사용
```

- 서버·터널·본인 PC가 필요 없다. 비용 0원(공개 리포의 GitHub Actions는 무료).
- 알림은 최대 약 5분 늦게 온다(정각, 5분, 10분…에 확인).
- 같은 일은 두 번 알리지 않는다. 처음 실행할 때는 기존 내역을 기록만 하고, 그 뒤 생긴 일부터 알린다.
- 웹훅을 쓰지 않으므로 GitHub App의 Webhook은 꺼도 되고, Setup URL도 필요 없다.

---

## 1. 봇 코드를 GitHub 리포에 올리기

**공개(Public) 리포**로 만든다. 비공개 리포는 Actions 무료 시간(월 2,000분)을 5분마다 실행으로 넘기게 된다. 비밀값은 코드가 아니라 리포 시크릿에 들어가므로 공개해도 안전하다(`.env`, `secrets/`, `scripts/pilot-members.json`은 `.gitignore`로 올라가지 않는다).

```powershell
# 프로젝트 폴더에서 (리포 이름 예: tuktak-notify-bot)
git init
git add .
git commit -m "알림 봇"
git branch -M main
git remote add origin https://github.com/<계정>/tuktak-notify-bot.git
git push -u origin main
```

## 2. 리포 시크릿 5개 넣기

리포 → Settings → Secrets and variables → Actions → **New repository secret**

| 이름 | 값 |
| --- | --- |
| `APP_ID` | `5884754` |
| `APP_PRIVATE_KEY` | GitHub App 개인키 `.pem` 파일 내용 전체(`-----BEGIN`부터 `END-----`까지) |
| `SLACK_BOT_TOKEN` | 슬랙 봇 토큰(`xoxb-…`) |
| `OPS_CHANNEL_ID` | 운영진 채널 ID(파일럿은 팀 채널 `C0CL42NA29Y`도 가능) |
| `PILOT_MEMBERS_JSON` | `scripts/pilot-members.json` 파일 내용 전체 |

## 3. 한 번 수동 실행해서 확인

리포 → Actions → **poll** → **Run workflow**. 1분 안에 팀 채널에 ":cloud: 알림 봇이 클라우드에서 동작을 시작했어요"가 오면 성공.

## 4. 정확한 5분 시계 연결 (cron-job.org)

**4-1. 실행용 토큰 만들기** (GitHub → Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token)
- Repository access: **Only select repositories** → 봇 리포 하나만
- Permissions → Repository → **Actions: Read and write** (이것만)
- 만료일: 최대 1년. 만료되면 예비 시계(GitHub 예약 실행)만 남으니 달력에 적어둔다.

이 토큰은 "봇 리포의 poll 실행 버튼 누르기"만 할 수 있다. 사용량·비용이 생기지 않는다.

**4-2. cron-job.org에 작업 만들기** (가입 후 Create cronjob)

| 항목 | 값 |
| --- | --- |
| URL | `https://api.github.com/repos/<계정>/tuktak-notify-bot/actions/workflows/poll.yml/dispatches` |
| Schedule | Every 5 minutes |
| Advanced → Request method | `POST` |
| Advanced → Headers | `Authorization: Bearer <4-1 토큰>`<br>`Accept: application/vnd.github+json`<br>`X-GitHub-Api-Version: 2022-11-28` |
| Advanced → Request body | `{"ref":"main"}` |

저장 후 "Test run"에서 응답 코드 **204**가 나오면 연결 완료. 리포 Actions 탭에 `workflow_dispatch`로 실행된 기록이 5분마다 쌓인다.

## 5. 정리

- 로컬에서 켜둔 `npm run local`은 종료해도 된다.
- GitHub App 설정에서 Webhook의 **Active**를 끈다(꺼두면 실패 기록이 쌓이지 않는다).
- `tuktak-lab` 조직에 GitHub App이 설치돼 있어야 한다. 설치는 `https://github.com/apps/tuktak-notify-bot/installations/new`에서 조직 owner가 한다.

## 확인·문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 알림이 안 옴 | Actions 탭에서 poll 실행 기록과 로그. "앱이 설치돼 있지 않아요"면 5번의 설치 |
| cron-job.org 응답 401/403 | 토큰 만료 또는 권한(Actions: Read and write)·리포 선택 확인 |
| cron-job.org 응답 404 | URL의 계정·리포 이름, 워크플로 파일명(`poll.yml`) 확인 |
| 운영진 채널에 "봇 확인 실패" | 같은 오류는 한 번만 보고된다. Actions 로그에서 원인 확인 |
| 처음부터 다시 시작하고 싶음 | Actions → Caches에서 `bot-state-` 캐시를 모두 지운다(다음 실행이 기준선부터 다시 잡음) |
