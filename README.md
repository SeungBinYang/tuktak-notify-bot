# Bootcamp GitHub–Slack Bot

부트캠프 팀별 GitHub 조직의 PR·브랜치 이벤트를 슬랙 팀 채널과 운영진 채널로 알리는 봇.

- 설계: `docs/DESIGN.md`
- 앱 준비(GitHub App·Slack App): `docs/SETUP.md`
- **클라우드 운영(권장, 서버 없음)**: `docs/HOSTING.md` — GitHub Actions + cron-job.org로 정각 기준 5분마다 확인
- 웹훅 서버 방식 배포(선택): `docs/DEPLOY.md`

## 지금 되는 것 (1단계)

| # | 기능 | 수신처 |
| --- | --- | --- |
| 1 | PR 생성 | 팀 채널 |
| 2 | main/develop 변동 | 팀 채널 |
| 3 | 승인 없는 머지 | 팀 + 운영진 |
| 5 | PR 승인·변경 요청 | 팀 채널 |
| 9 | 보호 브랜치 직접 push | 팀 + 운영진 |
| 10 | force push | 팀 + 운영진 |

## 명령

```bash
npm ci
npm run local                   # 로컬 원클릭 실행(터널 주소 발급 + 서버 + 팀 등록)
npm run dev                     # 로컬 서버
npm test                        # 단위 테스트
npm run test:e2e                # 통합 테스트(가짜 GitHub·Slack 서버로 Keepsy 시나리오 전체 실행)
npm run lint                    # 타입 검사
npm run build && npm start      # 빌드 후 실행
npm run seed:pilot -- --welcome # 파일럿 팀 등록 + 연결 버튼 발송
```

운영 중 AI API를 호출하지 않고, GitHub는 App installation token만 쓴다(개인 토큰 없음).
