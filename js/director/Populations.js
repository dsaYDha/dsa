// 스폰 디렉터에 등록되는 인구 — 아군 분대, 민간인, 돌발 조우(2단계), 위장 적(3단계)
// 모두 디렉터의 같은 출현 지점·등장 방식·예고음을 사용한다 ("뭔가 튀어나왔다 = 적"이 항상 성립하지 않게)
import * as THREE from 'three';
import { CONFIG, lerpRangeThreat } from '../config.js';
import { gameRand as R } from '../core/Random.js';
import { lerpD } from '../npc/Disguise.js';

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
    // 3단계: 오판 유도용 진짜 행동 — 1인 낙오병(다가와 합류) 또는 동행 엄호가 붙는 분대
    const decoy = d.disguises.rollDecoy('ally');
    if (decoy === 'straggler') {
      if (d.spawnAppearance('ally', { size: 1, decoy: 'straggler' })) d.credits.ally -= 1;
      return;
    }
    let size = Math.min(R.int(A.squadSize[0], A.squadSize[1]), Math.floor(d.credits.ally), room);
    if (size < 2 && !(active === 0 && size >= 1)) return;
    const req = d.spawnAppearance('ally', { size, announce: true, decoy });
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
        // 3단계: 오판 유도용 진짜 행동 — 충격으로 얼어붙음 / 도와달라며 다가옴
        if (d.spawnAppearance('civilian', { decoy: d.disguises.rollDecoy('civilian') })) d.credits.civilian -= 1;
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

// ---------------------------------------------------------------------
// 3단계 위장 적: 가짜 아군 / 가짜 민간인 — 위협 2단계부터, 동시 2~3명, "가끔" 나오는 양념 수준
// · 가짜 크레딧(디렉터 _accrueCredits)이 1 이상이면 같은 출현 지점·방식으로 등장
//   가짜 아군: 아군 분대 근처 / 아군 쪽 경로 / 가끔 적이 있던 쪽, 가짜 민간인: 다른 민간인 근처 / 정찰형은 창가 위주
// · 습격 구간이 시작되면 혼란을 틈타 접근하는 위장 적 (onAssault)
// · 오판 유도용 진짜 행동 비율(rollDecoy)도 같은 단계부터 비슷한 빈도로
// ---------------------------------------------------------------------
export class DisguisePopulation {
  constructor(director) {
    this.d = director;
    this.name = 'disguise';
    this.reset();
  }

  reset() {
    this.checkT = 2;
    this.infiltrations = 0;
  }

  get enabled() {
    return this.d.threat >= CONFIG.disguise.fromThreat;
  }

  canSpawn() {
    const d = this.d;
    return this.enabled && d.activeCount('disguised') + d.pendingCount('disguised') < d.capFor('disguised');
  }

  update(dt) {
    const d = this.d;
    d.credits.allyFake = Math.min(d.credits.allyFake, 1.5);
    d.credits.civilianFake = Math.min(d.credits.civilianFake, 1.5);
    this.checkT -= dt;
    if (this.checkT > 0) return;
    this.checkT = R.range(0.8, 1.6);
    if (!this.canSpawn()) return;
    if (d.credits.allyFake >= 1) {
      if (this.spawnFake('ally')) d.credits.allyFake -= 1;
    } else if (d.credits.civilianFake >= 1) {
      if (this.spawnFake('civilian')) d.credits.civilianFake -= 1;
    }
  }

  spawnFake(as, extra = {}) {
    const d = this.d;
    const g = d.game;
    const D = CONFIG.disguise;
    const role = extra.role || (R.chance(D.scoutChance[as]) ? 'scout' : 'ambusher');
    const opts = { as, role, nearEnemy: false, ...extra };
    if (as === 'ally') {
      if (R.chance(0.3)) {
        // 적이 있던 쪽에서 걸어옴
        const eng = g.npcs.byApparent('enemy').filter((e) => e.aware);
        if (eng.length) {
          opts.nearPos = R.pick(eng).position;
          opts.nearRadius = 22;
          opts.fromEnemySide = true;
        }
      } else if (R.chance(D.nearSquadChance)) {
        const sqs = g.npcs.squads.filter((q) => !q.done && !q.straggler);
        if (sqs.length) {
          opts.nearPos = R.pick(sqs).centroid(new THREE.Vector3());
          opts.nearRadius = 22;
        }
      }
    } else if (role !== 'scout' && R.chance(D.nearCiviliansChance)) {
      const civs = g.npcs.byApparent('civilian');
      if (civs.length) {
        opts.nearPos = R.pick(civs).position;
        opts.nearRadius = 16;
      }
    }
    return d.spawnAppearance('disguised', opts);
  }

  // 오판 유도용 진짜 행동: 아군 'straggler'|'escort', 민간인 'frozen'|'helpSeeker' (없으면 null)
  rollDecoy(kind) {
    if (!this.enabled) return null;
    const D = CONFIG.disguise.decoy;
    if (!R.chance(lerpD(kind === 'ally' ? D.allyChance : D.civilianChance, this.d.threat))) return null;
    if (kind === 'ally') return R.chance(0.5) ? 'straggler' : 'escort';
    return R.chance(0.5) ? 'frozen' : 'helpSeeker';
  }

  // 습격 구간 시작: 혼란을 틈타 가까이 접근하는 위장 적
  onAssault() {
    const d = this.d;
    if (!this.canSpawn() || !R.chance(lerpD(CONFIG.disguise.assaultInfiltrate, d.threat))) return;
    const as = R.chance(0.55) ? 'ally' : 'civilian';
    if (this.spawnFake(as, { role: 'ambusher', infiltrate: true, distRange: [14, 28] })) this.infiltrations++;
  }

  debugInfo() {
    const d = this.d;
    return `위장 ${d.activeCount('disguised')}/${d.capFor('disguised')} · 가짜 크레딧 아군 ${d.credits.allyFake.toFixed(2)} 민간인 ${d.credits.civilianFake.toFixed(2)}`;
  }
}
