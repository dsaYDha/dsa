// 스폰 디렉터에 등록되는 2단계 인구 — 아군 분대, 민간인, 돌발 조우
// 모두 디렉터의 같은 출현 지점·등장 방식·예고음을 사용한다 ("뭔가 튀어나왔다 = 적"이 항상 성립하지 않게)
import { CONFIG, lerpRangeThreat } from '../config.js';
import { gameRand as R } from '../core/Random.js';

// ---------------------------------------------------------------------
// 아군: 적 출현 크레딧이 쌓이면 증원 분대 (습격 구간엔 적립 2배), 시작 직후 분대 하나
// ---------------------------------------------------------------------
export class AllyPopulation {
  constructor(director) {
    this.d = director;
    this.name = 'ally';
    this.reset();
  }

  reset() {
    this.initialDone = !CONFIG.ally.initialSquad;
    this.checkT = 1.5;
    this.squadsSent = 0;
  }

  update(dt) {
    const d = this.d;
    const A = CONFIG.ally;
    if (!this.initialDone) {
      this.initialDone = true;
      // 시작 분대: 근처 숨은 곳에서 등장해 플레이어 쪽으로 재집결
      if (d.spawnAppearance('ally', { size: R.int(2, 3), distRange: [12, 32], nearEnemy: false, announce: true, noCue: true, initial: true })) this.squadsSent++;
    }
    d.credits.ally = Math.min(d.credits.ally, A.squadSize[1] * 1.5);
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = 1.0;
    const active = d.activeCount('ally') + d.pendingCount('ally');
    const room = A.maxActive - active;
    // 상한이 차 있고 증원이 대기 중이면 오래 머문 조용한 분대부터 교대
    if (room < A.squadSize[0] && d.credits.ally >= A.squadSize[0]) {
      const old = d.game.npcs.squads.filter((s) => !s.done && !s.withdrawing && s.age > A.minTour && !s.fighting).sort((a, b) => b.age - a.age)[0];
      if (old) old.withdraw();
    }
    if (room < 1 || d.credits.ally < A.squadSize[0]) return;
    let size = Math.min(R.int(A.squadSize[0], A.squadSize[1]), Math.floor(d.credits.ally), room);
    if (size < 2 && !(active === 0 && size >= 1)) return;
    const req = d.spawnAppearance('ally', { size, announce: true });
    if (req) {
      d.credits.ally -= size;
      this.squadsSent++;
    }
  }

  debugInfo() {
    return `분대 ${this.squadsSent}`;
  }
}

// ---------------------------------------------------------------------
// 민간인: 시작 시 건물 안·창가·차량 뒤에 숨어 있음 + 크레딧만큼 문·골목·창가에서 등장
// 소강 구간·공황 중엔 숨어 있던 민간인의 대피 이동 증가
// ---------------------------------------------------------------------
export class CivilianPopulation {
  constructor(director) {
    this.d = director;
    this.name = 'civilian';
    this.reset();
  }

  reset() {
    this.initialDone = false;
    this.checkT = 1.2;
    this.evacT = 3;
  }

  update(dt) {
    const d = this.d;
    const C = CONFIG.civilian;
    if (!this.initialDone) {
      this.initialDone = true;
      const n = R.int(C.initialCount[0], C.initialCount[1]);
      for (let i = 0; i < n; i++) d.spawnAppearance('civilian', { spawnType: 'civilianHidden', distRange: [16, 60], nearEnemy: false, noCue: true, initial: true });
    }
    d.credits.civilian = Math.min(d.credits.civilian, 4);
    this.checkT -= dt;
    if (this.checkT <= 0) {
      this.checkT = R.range(0.6, 1.4);
      const active = d.activeCount('civilian') + d.pendingCount('civilian');
      if (d.credits.civilian >= 1 && active < C.maxActive) {
        if (d.spawnAppearance('civilian', {})) d.credits.civilian -= 1;
      }
    }
    // 소강 구간: 숨어 있던 민간인 대피 유도
    this.evacT -= dt;
    if (this.evacT <= 0) {
      this.evacT = R.range(2.5, 4.5);
      const lull = d.hostile.phase === 'lull' || d.hostile.phase === 'relax';
      if (lull || d.civPanicT > 0) {
        const hidden = d.game.npcs.byFaction('civilian').filter((c) => c.state === 'hide');
        if (hidden.length && R.chance(lull ? 0.6 : 0.35)) R.pick(hidden).encourageFlee();
      }
    }
  }

  debugInfo() {
    return `크레딧 ${this.d.credits.civilian.toFixed(1)}`;
  }
}

// ---------------------------------------------------------------------
// 돌발 조우: 근거리(8m 이내) 출입구·모퉁이에서 갑자기 등장 — 적 50 / 아군 25 / 민간인 25
// 예고음은 아주 짧게(0.25~0.5초). 적은 등장 유예(spawnGrace) 동안 명중 불가라 판단할 시간이 있다
// ---------------------------------------------------------------------
export class AmbushEvent {
  constructor(director) {
    this.d = director;
    this.name = 'ambush';
    this.reset();
  }

  reset() {
    this.timer = CONFIG.director.ambush.firstAfter + R.range(0, 10);
  }

  update(dt) {
    const d = this.d;
    const Am = CONFIG.director.ambush;
    if (!d.game.player.alive) return;
    this.timer -= dt;
    if (this.timer > 0) return;
    const [a, b] = lerpRangeThreat([Am.interval, Am.intervalAtMax], d.threat);
    this.timer = R.range(a, b);
    const mix = { ...Am.mix };
    for (const k of Object.keys(mix)) if (d.activeCount(k) + d.pendingCount(k) >= d.capFor(k)) mix[k] = 0;
    if (!Object.values(mix).some((v) => v > 0)) return;
    const kind = R.weighted(mix);
    const req = d.spawnAppearance(kind, {
      spawnType: 'ambush',
      entrance: 'ambush',
      ambush: true,
      distRange: [Am.minDist, Am.maxDist],
      nearEnemy: false,
      cueLead: Am.cueLead,
      forceCue: true,
      size: 1,
      enemyType: R.chance(0.6) ? 'assault' : 'rifleman',
    });
    if (!req) this.timer = 4; // 근처에 숨은 출입구가 없으면 곧 다시 시도
  }

  debugInfo() {
    return `${Math.max(0, this.timer).toFixed(0)}s`;
  }
}
