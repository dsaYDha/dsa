// 이벤트 버스 — 시스템 간 결합을 줄이기 위한 발행/구독
// 2단계 오인 사격 페널티, 3·4단계 판단 통계가 NPC_DAMAGED / NPC_KILLED 를 구독할 예정
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
  DIRECTOR_PHASE: 'director:phase',
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
