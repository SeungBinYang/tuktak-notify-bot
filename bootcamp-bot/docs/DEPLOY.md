# 배포와 파일럿 적용 (뚝딱연구soo · tuktak-lab/Keepsy)

순서: **봇 서버 띄우기 → 앱 2개 만들기 → 채널 준비 → 팀 등록 → 조직에 설치 → 확인**

빠르게 확인만 하려면 A(로컬 + 터널), 계속 쓰려면 B(상시 배포)로 간다.
A로 시작했다가 B로 옮길 때 주의할 점은 맨 아래 "A에서 B로 옮길 때"에 있다.

---

## A. 로컬 + 터널로 빠르게 확인 (약 30분)

**가장 쉬운 방법: `npm ci` 후 `npm run local`** — .env 준비, 다운로드 폴더의 GitHub 개인키 복사, 슬랙 값 입력, 터널 주소 발급, 서버 실행, 팀 채널 연결 버튼 발송까지 한 번에 안내한다. 아래는 같은 과정을 손으로 할 때의 방법이다.

```bash
npm ci
cp .env.example .env
# 터널 실행(둘 중 하나). 출력되는 https 주소가 PUBLIC_BASE_URL
cloudflared tunnel --url http://localhost:3000
# 또는: ngrok http 3000
```

1. `.env`의 `PUBLIC_BASE_URL`에 터널 주소를 넣는다.
2. `docs/SETUP.md` 순서대로 GitHub App과 Slack App을 만든다. URL은 모두 터널 주소 기준.
3. 발급값을 `.env`에 채우고, 개인키는 `secrets/github-app.pem`에 둔다.
4. 아래 "공통: 채널 준비 → 팀 등록 → 설치 → 확인"을 진행한다. 서버 실행은 `npm run dev`.

무료 터널은 재시작할 때마다 주소가 바뀌므로, 바뀌면 GitHub App(Webhook URL, Setup URL)과 Slack App(매니페스트의 URL 3곳)도 고쳐야 한다. 계속 쓸 거라면 B로 간다.

---

## B. 상시 배포 (Docker)

Docker 이미지를 실행할 수 있고 **영구 볼륨(디스크)**을 붙일 수 있는 곳이면 어디든 된다(Fly.io, Railway, Render, 개인 VPS 등). 요금과 무료 한도는 자주 바뀌니 고를 때 확인한다.

1. 이 리포를 호스팅에 연결하거나 `Dockerfile`로 이미지를 빌드한다.
2. 영구 볼륨을 컨테이너의 `/app/data`에 연결한다. **안 하면 재배포 때마다 DB(팀 등록·설치 연결)가 사라진다.**
3. 환경변수를 설정한다. `.env.example`의 항목과 같고, 개인키는 파일 대신 환경변수로 넣는다.
   ```bash
   # 개인키를 한 줄 base64로 바꿔 GITHUB_PRIVATE_KEY에 넣는다 (GITHUB_PRIVATE_KEY_PATH는 비워둔다)
   base64 -w0 secrets/github-app.pem      # macOS: base64 -i secrets/github-app.pem
   ```
   `PORT`는 호스팅이 지정하는 값이 있으면 그걸 따른다. `DATABASE_PATH`는 이미지 기본값(`/app/data/bot.db`)을 쓴다.
4. 배포 후 `https://<배포주소>/health`가 `{"ok":true,...}`를 돌려주는지 확인한다.
5. GitHub App 설정의 Webhook URL·Setup URL, Slack App 매니페스트의 URL 3곳을 배포 주소로 바꾼다.
6. 아래 "공통" 단계를 진행한다. 팀 등록은 서버에서 실행한다:
   ```bash
   # 호스팅의 셸/콘솔에서. 팀 정보는 PILOT_MEMBERS_JSON 환경변수에 pilot-members.json 내용을 넣어둔다
   node dist/scripts/seed-pilot.js --welcome
   ```

---

## 공통: 채널 준비 → 팀 등록 → 설치 → 확인

### 1. 슬랙 채널 준비

- 팀 채널 `뚝딱연구soo-깃허브-알림`(`C0CL42NA29Y`)에 팀원 5명이 들어와 있는지 확인한다.
- 운영진 채널을 비공개로 하나 만들고(예: `깃허브-운영`), 채널 ID를 `OPS_CHANNEL_ID`에 넣는다. 팀 채널과 같은 채널을 쓰면 위반 알림이 두 번 온다.
- **두 채널 모두에서** `/invite @github-bot`으로 봇을 초대한다. 초대 전에는 봇이 메시지를 보낼 수 없다.

### 2. 팀 등록

```bash
npm run seed:pilot -- --welcome     # 로컬(A)
node dist/scripts/seed-pilot.js --welcome   # 서버(B)
```

팀 채널에 팀원 소개와 **"GitHub 연결하기"** 버튼이 올라온다. 터미널에도 같은 설치 링크가 출력된다(7일 유효).

### 3. tuktak-lab 조직에 설치

- `tuktak-lab` 조직의 **owner**가 버튼을 누른다.
- 조직을 `tuktak-lab`으로 고르고, 리포 범위는 **All repositories**를 권장한다(Keepsy만 골라도 된다).
- 설치가 끝나면 "연결 완료" 페이지가 뜨고, 팀 채널과 운영진 채널에 연결 메시지가 온다.

### 4. 동작 확인 (Keepsy에서)

| 해볼 것 | 기대 결과 |
| --- | --- |
| 브랜치를 만들어 PR 열기 | 팀 채널에 #1 "새 PR" |
| 그 PR을 승인 없이 main에 머지 | 팀 채널 + 운영진 채널에 #3 "승인 없이 머지됨", 팀 채널에 #2 "main 갱신" |
| 다른 PR을 팀원 승인 후 머지 | #2만, #3 없음 |
| 로컬에서 main에 직접 커밋 후 push | #2 후 약 15초 뒤 #9 "직접 push" (팀 + 운영진) |
| `git push --force`로 main 덮어쓰기(테스트 리포에서만!) | #10 "force push" (팀 + 운영진) |

Keepsy는 지금 `main` 브랜치만 있다. `develop`을 만들면 그 브랜치도 자동으로 감시 대상이 된다.
force push 테스트는 실제 Keepsy가 아니라 같은 조직의 테스트용 리포에서 하길 권한다.

---

## 문제 해결

| 증상 | 확인할 것 |
| --- | --- |
| 아무 알림도 안 옴 | GitHub App 설정 → Advanced → **Recent Deliveries**에서 응답 코드 확인. 200이 아니면 아래 항목 |
| Recent Deliveries가 401 | `GITHUB_WEBHOOK_SECRET`이 GitHub App 설정값과 다름 |
| 200인데 알림 없음, 서버 로그에 `not_in_channel` | 봇을 채널에 초대하지 않음 |
| 운영진 채널에 "미등록 조직 이벤트" | 버튼을 거치지 않고 설치함 → 조직 설정에서 앱 제거 후 버튼으로 다시 설치 |
| 설치 후 "링크가 만료됐거나 올바르지 않아요" | 7일 지난 링크이거나 `STATE_SIGNING_SECRET`이 바뀜 → 팀 등록 명령을 다시 실행해 새 버튼 받기 |
| 운영진 채널에 "봇 처리 오류" | 서버 로그의 해당 작업 오류 확인. GitHub API 권한(Pull requests: Read)이 빠졌는지도 확인 |
| 서버가 시작하자마자 종료 | 로그의 "환경변수 설정이 올바르지 않아요" 목록대로 값 보완 |

---

## A에서 B로 옮길 때

로컬 DB에 있던 팀 등록과 설치 연결은 서버로 자동으로 넘어가지 않는다. 둘 중 하나를 한다.

- 로컬 `data/bot.db`를 서버 볼륨(`/app/data/bot.db`)으로 복사한다.
- 또는 서버에서 팀 등록을 다시 하고, `tuktak-lab` 조직 설정 → GitHub Apps에서 앱을 **제거한 뒤** 새 버튼으로 다시 설치한다.
