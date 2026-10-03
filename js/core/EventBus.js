// 이벤트 버스 — 시스템 간 결합을 줄이기 위한 발행/구독
// 2단계 오인 사격 페널티(PenaltySystem)가 NPC_DAMAGED / NPC_KILLED 를 구독, 3·4단계 판단 통계도 같은 이벤트를 쓴다
export const Events = {
  NPC_SPAWNED: 'npc:spawned',
  NPC_DAMAGED: 'npc:damaged', // { attacker, victim, trueFaction, apparentFaction, zone, headshot, damage, distance, timeSinceFirstSeen, position, time }
  NPC_KILLED: 'npc:killed', // NPC_DAMAGED 와 같은 형식
  NPC_REMOVED: 'npc:removed',
  PLAYER_DAMAGED: 'player:damaged', // { amount, health, sourcePosition, attacker }
  PLAYER_DIED: 'player:died',
  WEAPON_FIRED: 'weapon:fired', // { shooter, position, direction, isPlayer }
  WEAPON_RELOAD: 'weapon:reload',
  BULLET_NEAR_MISS: 'bullet:nearMiss',
  SCORE_KILL: 'score:kill', // { points, labels, combo, total }
  SCORE_EVENT: 'score:event', // { points, label, kind: 'assist'|'evac'|'penalty' } — 사살 외 점수 변화
  FRIENDLY_FIRE: 'penalty:friendlyFire', // { kind: 'allyHit'|'allyKill'|'civHit'|'civKill', points, warnings, victim }
  OPERATION_DISMISSED: 'penalty:dismissed', // 경고 누적 → 작전 해임 (게임 오버)
  CIVILIAN_EVACUATED: 'civilian:evacuated', // { npc, position, time }
  AMBUSH: 'director:ambush', // { kind, spawnPoint }
  // 3단계: 위장 적·관찰
  DISGUISE_SPAWNED: 'disguise:spawned', // { npc, profile }
  DISGUISE_REVEALING: 'disguise:revealing', // { npc, reason } — 예고 동작 시작 (장전음)
  DISGUISE_REVEALED: 'disguise:revealed', // { npc, as, role, reason, ambush } — 정체를 드러냄 (ambush: 기습)
  DISGUISE_KILLED: 'disguise:killed', // { npc, as } — 정체를 드러내기 전에 사살
  DISGUISE_CALLED: 'disguise:called', // { npc } — 정찰형이 습격을 부름
  OBSERVE_START: 'observe:start',
  OBSERVE_FACT: 'observe:fact', // { npc, fact, distance } — 관찰로 사실 하나를 알아챔
  // 4단계: 말 걸기·문답
  DIALOGUE_OPEN: 'dialogue:open', // { npc, indoor, first, firstIndoor }
  DIALOGUE_ASK: 'dialogue:ask', // { npc, question: 'password'|'indoor'|'unit'|'lower'|'hands'|'id'|'evac', number? }
  DIALOGUE_ANSWER: 'dialogue:answer', // { npc, question, outcome, fail } — 통계·테스트용 (화면에는 판정을 보여주지 않음)
  DIALOGUE_CLOSE: 'dialogue:close', // { npc, reason: 'timeout'|'key'|'fired'|'lost'|'dead'|'revealed'|'player' }
  COUNTERSIGN_CHANGED: 'countersign:changed', // { current: {challenge, reply}, previous, indoorBase, prevIndoorBase, initial }
  DIRECTOR_PHASE: 'director:phase',
  CURVE_PHASE: 'director:curve', // 5단계: 난이도 곡선 구간 변경 { index, name, note }
  NEAR_IMPACT: 'bullet:nearImpact', // 5단계: 빗나간 적 탄이 플레이어 가까이에 맞음 { point, distance }
  RUN_END: 'game:runEnd', // 5단계: 판 종료 { reason: 'killed'|'dismissed'|'complete' }
  THREAT_LEVEL: 'director:threat',
  GAME_STATE: 'game:state',
};

export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(type, fn) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const set = this.handlers.get(type);
    if (set) set.delete(fn);
  }

  emit(type, payload) {
    const set = this.handlers.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        fn(payload);
      } catch (err) {
        console.error(`[EventBus] '${type}' 처리 중 오류`, err);
      }
    }
  }
}
