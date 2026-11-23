// 기능 레지스트리. 번호는 docs/DESIGN.md "4. 알림 기능 전체 목록"의 #을 따른다.
// 모든 알림은 router.emit()을 통해 이 레지스트리를 거쳐 발송된다.

export interface FeatureDef {
  id: number;
  name: string;
  /** 팀 채널 발송 기본값 */
  defaultOn: boolean;
  /** 팀 채널로 보내는가 */
  team: boolean;
  /** 팀장이 팀 채널 발송을 끌 수 없는가 */
  teamLocked: boolean;
  /** 운영진 채널로도 보내는가(팀 설정과 무관, 항상) */
  ops: boolean;
}

const def = (d: FeatureDef) => d;

export const FEATURES = {
  1: def({ id: 1, name: 'PR 생성', defaultOn: true, team: true, teamLocked: false, ops: false }),
  2: def({ id: 2, name: '보호 브랜치 변동', defaultOn: true, team: true, teamLocked: false, ops: false }),
  3: def({ id: 3, name: '승인 없는 머지', defaultOn: true, team: true, teamLocked: false, ops: true }),
  5: def({ id: 5, name: '리뷰 결과(승인·변경 요청)', defaultOn: true, team: true, teamLocked: false, ops: false }),
  9: def({ id: 9, name: '보호 브랜치 직접 push', defaultOn: true, team: true, teamLocked: true, ops: true }),
  10: def({ id: 10, name: 'force push', defaultOn: true, team: true, teamLocked: true, ops: true }),
} as const;

export type FeatureId = keyof typeof FEATURES;

export const DEFAULT_WATCHED_BRANCHES = ['main', 'develop'];
