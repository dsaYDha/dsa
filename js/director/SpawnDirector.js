// 스폰 디렉터 — "언제 어디서 튀어나올지 모른다"
// · 리듬: 소강 → 산발적 출현 → 여러 방향 동시 습격 → 다시 소강 (무작위성 + 플레이어 긴장도 반영, L4D AI 디렉터 방식)
// · 플레이어 시야 안에서 갑자기 생성 금지: 시야 밖·가려진 곳에서 생성 후 걸어 나오기/창가에 나타나기/엄폐물에서 튀어나오기
// · 측면·후방 출현은 발소리·잔해·문 소리를 먼저 들려줌
// · 1분마다 위협 단계 상승
// · 확장: registerPopulation() 으로 2단계 민간인·아군, registerFactory() 로 3단계 위장 적 생성기를 붙인다
import * as THREE from 'three';
import { CONFIG, lerpRangeThreat } from '../config.js';
import { Events } from '../core/EventBus.js';
import { gameRand as R } from '../core/Random.js';

export const Phase = { LULL: 'lull', SPORADIC: 'sporadic', ASSAULT: 'assault', RELAX: 'relax' };
export const PhaseLabel = { lull: '소강', sporadic: '산발', assault: '습격', relax: '정리' };

// 적 유형별로 쓸 수 있는 출현 지점 종류와 가중치
const SPAWN_TYPES = {
  rifleman: { alleyEnd: 1.1, streetEnd: 0.8, doorway: 0.8, room: 0.6, behindCover: 1.6 },
  assault: { alleyEnd: 1.3, streetEnd: 1.0, doorway: 1.0, room: 0.9 },
  window: { window: 1.6, roof: 1.0 },
};

const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

// ---------------------------------------------------------------------
// 적대 세력 인구 — 리듬 관리
// ---------------------------------------------------------------------
class HostilePopulation {
  constructor(director) {
    this.d = director;
    this.name = 'hostile';
    this.reset();
  }

  reset() {
    this.phase = Phase.LULL;
    this.phaseT = R.range(...CONFIG.director.firstLull);
    this.phaseElapsed = 0;
    this.spawnT = 0;
    this.firstCycle = true;
    this.waveIds = new Set();
    this.stragglerDone = false;
    this.history = [];
  }

  _enter(phase, duration) {
    this.phase = phase;
    this.phaseT = duration;
    this.phaseElapsed = 0;
    this.history.push({ phase, t: this.d.game.time });
    if (this.history.length > 20) this.history.shift();
    this.d.game.events.emit(Events.DIRECTOR_PHASE, { phase, duration });
  }

  update(dt) {
    const d = this.d;
    const D = CONFIG.director;
    const lvl = d.threat;
    this.phaseT -= dt;
    this.phaseElapsed += dt;
    const active = d.activeHostiles();
    const cap = d.cap;

    switch (this.phase) {
      case Phase.LULL: {
        // 소강 중 가끔 낙오병 한 명
        if (!this.stragglerDone && this.phaseElapsed > 2.5 && R.chance(D.lullStragglerChance * dt * 0.25)) {
          this.stragglerDone = true;
          if (active < 2) d.spawnHostile({});
        }
        const quiet = active === 0 && d.intensity < 0.15 && this.phaseElapsed > 4;
        if (this.phaseT <= 0 || (quiet && R.chance(dt * 0.15))) {
          this.stragglerDone = false;
          if (this.firstCycle) {
            this.firstCycle = false;
            this._enter(Phase.SPORADIC, R.range(...D.sporadicDuration));
            this.spawnT = 0.2;
          } else if (R.chance(D.chanceLullToAssault)) this._startAssault();
          else {
            this._enter(Phase.SPORADIC, R.range(...D.sporadicDuration));
            this.spawnT = R.range(0.3, 1.5);
          }
        }
        break;
      }
      case Phase.SPORADIC: {
        this.spawnT -= dt;
        if (this.spawnT <= 0) {
          const [a, b] = lerpRangeThreat(CONFIG.threat.sporadicInterval, lvl);
          // 일정한 박자를 피하려고 넓은 분포 + 가끔 짧은 연속
          this.spawnT = R.chance(0.2) ? R.range(0.4, 1.2) : R.range(a, b) * R.range(0.6, 1.5);
          if (active + d.pending.length < Math.ceil(cap * 0.75)) {
            d.spawnHostile({});
            if (R.chance(0.22 + lvl * 0.02) && active + d.pending.length + 1 < cap) d.spawnHostile({ nearPrevious: true });
          }
        }
        if (d.intensity > D.intensityHigh) this._enter(Phase.RELAX, D.relaxMaxTime);
        else if (this.phaseT <= 0) {
          if (R.chance(D.chanceSporadicToAssault)) this._startAssault();
          else this._enter(Phase.LULL, R.range(...lerpRangeThreat(CONFIG.threat.lullDuration, lvl)));
        }
        break;
      }
      case Phase.ASSAULT: {
        let alive = 0;
        for (const id of this.waveIds) {
          const n = d.game.npcs.list.find((x) => x.id === id);
          if (n && n.alive) alive++;
        }
        const allSpawned = !d.pending.some((p) => p.wave);
        if ((allSpawned && alive <= 1 && this.phaseElapsed > 4) || this.phaseT <= 0) {
          this._enter(Phase.RELAX, D.relaxMaxTime);
        }
        break;
      }
      case Phase.RELAX: {
        if (active <= 1 || this.phaseT <= 0) {
          const [a, b] = lerpRangeThreat(CONFIG.threat.lullDuration, lvl);
          this._enter(Phase.LULL, R.range(a, b) * R.range(0.7, 1.2));
        }
        break;
      }
      default:
        break;
    }
  }

  // 여러 방향 동시 습격
  _startAssault() {
    const d = this.d;
    const lvl = d.threat;
    this._enter(Phase.ASSAULT, CONFIG.director.assaultTimeout);
    const [a, b] = lerpRangeThreat(CONFIG.threat.waveSize, lvl);
    let size = Math.round(R.range(a, b));
    size = Math.min(size, d.cap - d.activeHostiles() - d.pending.length);
    if (size <= 0) {
      this._enter(Phase.RELAX, 6);
      return;
    }
    const groups = size >= 5 ? 3 : size >= 2 ? 2 : 1;
    const bearings = [];
    this.waveIds.clear();
    let made = 0;
    for (let g = 0; g < groups && made < size; g++) {
      const n = g === groups - 1 ? size - made : Math.max(1, Math.round(size / groups));
      const delay = g * R.range(0.4, 1.6);
      for (let i = 0; i < n; i++) {
        const req = d.spawnHostile({ avoidBearings: i === 0 ? bearings : null, nearPrevious: i > 0, wave: true, extraDelay: delay + i * R.range(0.15, 0.7) });
        if (req) {
          if (i === 0) bearings.push(req.bearing);
          made++;
        }
      }
    }
    if (made === 0) this._enter(Phase.RELAX, 5);
  }

  onSpawned(npc, req) {
    if (req.wave) this.waveIds.add(npc.id);
  }

  debugInfo() {
    return `${PhaseLabel[this.phase]} ${Math.max(0, this.phaseT).toFixed(1)}s`;
  }
}

// ---------------------------------------------------------------------
// 디렉터
// ---------------------------------------------------------------------
export class SpawnDirector {
  constructor(game) {
    this.game = game;
    this.populations = [];
    this.factories = new Map();
    this.pending = [];
    this.spawnLog = [];
    this.hostile = new HostilePopulation(this);
    this.registerPopulation(this.hostile);
    // 생성기: 진영/종류별. 2·3단계에서 'civilian', 'ally', 'disguisedEnemy' 를 추가 등록
    this.registerFactory('enemy', (req) => game.npcs.spawnEnemy(req));

    game.events.on(Events.PLAYER_DAMAGED, (e) => { this.intensity = Math.min(1.5, this.intensity + e.amount / 55); });
    game.events.on(Events.NPC_KILLED, () => { this.intensity = Math.min(1.5, this.intensity + 0.07); });
    game.events.on(Events.BULLET_NEAR_MISS, () => { this.intensity = Math.min(1.5, this.intensity + 0.02); });
    this.reset();
  }

  registerPopulation(pop) {
    this.populations.push(pop);
  }

  registerFactory(kind, fn) {
    this.factories.set(kind, fn);
  }

  reset() {
    this.elapsed = 0;
    this.threat = 1;
    this.intensity = 0;
    this.pending.length = 0;
    this.spawnLog.length = 0;
    this._lastSpawnPos = null;
    for (const sp of this.game.world.spawnPoints || []) sp.lastUsed = -999;
    for (const p of this.populations) p.reset();
  }

  get cap() {
    const arr = CONFIG.threat.maxActive;
    return arr[Math.min(arr.length - 1, this.threat - 1)];
  }

  activeHostiles() {
    return this.game.npcs.countActive('enemy');
  }

  update(dt) {
    const T = CONFIG.threat;
    this.elapsed += dt;
    const lvl = Math.min(T.maxLevel, 1 + Math.floor(this.elapsed / T.secondsPerLevel));
    if (lvl !== this.threat) {
      this.threat = lvl;
      this.game.events.emit(Events.THREAT_LEVEL, { level: lvl });
    }
    this.intensity = Math.max(0, this.intensity - CONFIG.director.intensityDecay * dt);
    for (const p of this.populations) p.update(dt);

    // 예고음 뒤 실제 생성
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const req = this.pending[i];
      req.delay -= dt;
      if (req.delay > 0) continue;
      this.pending.splice(i, 1);
      this._realize(req);
    }
  }

  // ------------------------------------------------------------------
  // 적 1명 생성 요청 (출현 지점 선택 + 예고음 + 지연 생성)
  // ------------------------------------------------------------------
  spawnHostile(opts = {}) {
    const game = this.game;
    const lvl = this.threat;
    const weights = { ...(lvl >= CONFIG.threat.windowFromLevel ? lerpWeights(lvl) : { rifleman: 0.78, assault: 0.22, window: 0 }) };
    if (game.player.isIndoors && game.player.isIndoors()) weights.assault *= 1.8; // 실내 습격
    let type = R.weighted(weights);
    let sp = this.pickSpawnPoint(type, opts);
    if (!sp && type === 'window') {
      type = 'rifleman';
      sp = this.pickSpawnPoint(type, opts);
    }
    if (!sp) return null;
    sp.lastUsed = game.time;

    const pf = game.player.feet;
    const bearing = Math.atan2(sp.z - pf.z, sp.x - pf.x);
    const req = {
      kind: 'enemy',
      type,
      threat: lvl,
      spawnPoint: sp,
      entrance: entranceFor(sp.type),
      goalNode: sp.goalNode,
      goalNodes: sp.goalNodes,
      bearing,
      wave: !!opts.wave,
      delay: opts.extraDelay || 0,
      cue: null,
    };
    // 측면·후방이거나 가까우면 소리를 먼저
    const rel = this.relativeAngle(sp);
    const dist = Math.hypot(sp.x - pf.x, sp.z - pf.z);
    const D = CONFIG.director;
    if (rel > D.cueAngleDeg || (dist < D.cueDistance && R.chance(0.6)) || R.chance(0.25)) {
      req.cue = sp.cue || 'footsteps';
      if (req.delay <= 0) {
        this._playCue(req);
        req.delay = R.range(...D.cueLead);
      } else {
        req.awaitingCue = true; // 습격 시차: 그 시점에 예고음 → 다시 선행 시간 대기
      }
    }
    this._lastSpawnPos = { x: sp.x, z: sp.z };
    this.pending.push(req);
    return req;
  }

  _playCue(req) {
    const a = this.game.audio;
    const sp = req.spawnPoint;
    _p.set(sp.x, sp.y + 1, sp.z);
    if (req.cue === 'door') a.door(_p);
    else if (req.cue === 'rubble') {
      a.rubble(_p);
      a.footstepSequence(_p.clone(), 2, 0.3);
    } else if (req.cue === 'glass') a.glass(_p);
    else a.footstepSequence(_p.clone(), R.int(3, 5), R.range(0.22, 0.32));
  }

  _realize(req) {
    const game = this.game;
    if (req.awaitingCue) {
      // 지연된 예고음: 이제 재생하고 다시 대기
      req.awaitingCue = false;
      this._playCue(req);
      req.delay = R.range(...CONFIG.director.cueLead);
      this.pending.push(req);
      return;
    }
    if (!game.player.alive) return;
    // 생성 직전 재확인: 그새 시야에 들어왔으면 근처의 다른 숨은 지점으로
    let sp = req.spawnPoint;
    if (this.isSpawnVisible(sp, req.entrance)) {
      sp = this.pickSpawnPoint(req.type, { nearPos: sp, sameType: sp.type });
      if (!sp) return;
      req.spawnPoint = sp;
      req.goalNode = sp.goalNode;
      req.goalNodes = sp.goalNodes;
      req.entrance = entranceFor(sp.type);
    }
    if (this.activeHostiles() >= this.cap) return;
    const make = this.factories.get(req.kind);
    if (!make) return;
    const npc = make(req);
    if (!npc) return;
    for (const p of this.populations) if (p.onSpawned) p.onSpawned(npc, req);
    this.spawnLog.push({ t: game.time, type: req.type, sp: sp.type, x: sp.x, z: sp.z, cue: req.cue });
    if (this.spawnLog.length > 60) this.spawnLog.shift();
  }

  // ------------------------------------------------------------------
  // 출현 지점 선택
  // ------------------------------------------------------------------
  pickSpawnPoint(type, opts = {}) {
    const game = this.game;
    const D = CONFIG.director;
    const pf = game.player.feet;
    const pts = game.world.spawnPoints;
    const allowed = SPAWN_TYPES[type] || SPAWN_TYPES.rifleman;
    const playerIndoor = game.world.getIndoorInfo(game.player.position);
    const byType = new Map();
    for (const sp of pts) {
      const w = allowed[sp.type];
      if (!w) continue;
      if (opts.sameType && sp.type !== opts.sameType) continue;
      if (game.time - sp.lastUsed < D.spawnPointCooldown) continue;
      const dx = sp.x - pf.x;
      const dz = sp.z - pf.z;
      const dy = sp.y - pf.y;
      const d = Math.hypot(dx, dz);
      const indoor = sp.type === 'room' || sp.type === 'doorway' || sp.type === 'window';
      const minD = indoor ? D.minIndoorSpawnDist : D.minSpawnDist;
      if (d < minD || d > D.maxSpawnDist) continue;
      if (opts.nearPos && Math.hypot(sp.x - opts.nearPos.x, sp.z - opts.nearPos.z) > 16) continue;
      // 플레이어와 같은 방이면 제외
      if (playerIndoor && playerIndoor.room && sp.buildingId === playerIndoor.building.id && Math.abs(dy) < 1.5 && d < 9) continue;
      // 다른 NPC 근처 제외
      let crowded = false;
      for (const n of game.npcs.list) {
        if (n.alive && Math.abs(n.position.x - sp.x) < 3 && Math.abs(n.position.z - sp.z) < 3) {
          crowded = true;
          break;
        }
      }
      if (crowded) continue;
      if (this.pending.some((p) => p.spawnPoint === sp)) continue;
      if (!byType.has(sp.type)) byType.set(sp.type, []);
      byType.get(sp.type).push({ sp, d });
    }
    if (!byType.size) return null;

    // 1단계: 출현 지점 종류를 가중치로 선택 (골목이 수가 많아도 문·창·엄폐가 고르게 나오도록)
    const typeWeights = {};
    for (const [t, list] of byType) {
      let w = allowed[t];
      if (playerIndoor && t === 'room') w *= 1.8;
      typeWeights[t] = w * Math.min(1, 0.4 + list.length / 6);
    }
    const tried = new Set();
    for (let attempt = 0; attempt < 3; attempt++) {
      const avail = Object.fromEntries(Object.entries(typeWeights).filter(([t]) => !tried.has(t)));
      if (!Object.keys(avail).length) break;
      const t = R.weighted(avail);
      tried.add(t);
      const list = byType.get(t);
      // 2단계: 같은 종류 안에서 점수화
      for (const c of list) {
        let s = -Math.abs(c.d - D.preferredSpawnDist) / 8 + R.range(0, 2.5);
        const bearing = Math.atan2(c.sp.z - pf.z, c.sp.x - pf.x);
        if (opts.avoidBearings && opts.avoidBearings.length) {
          for (const b of opts.avoidBearings) {
            const diff = Math.abs(Math.atan2(Math.sin(bearing - b), Math.cos(bearing - b)));
            if (diff < THREE.MathUtils.degToRad(D.groupSpreadDeg)) s -= 6;
          }
        }
        if (opts.nearPrevious && this._lastSpawnPos) {
          const dd = Math.hypot(c.sp.x - this._lastSpawnPos.x, c.sp.z - this._lastSpawnPos.z);
          s += dd < 12 ? 2 : -1;
        }
        c.score = s;
      }
      list.sort((a, b) => b.score - a.score);
      const tries = Math.min(18, list.length);
      for (let i = 0; i < tries; i++) {
        const sp = list[i].sp;
        if (!this.isSpawnVisible(sp, entranceFor(sp.type))) return sp;
      }
    }
    return null;
  }

  // 플레이어 기준 방위각 차 (도) — 0 이면 정면
  relativeAngle(sp) {
    const cam = this.game.camera;
    const f = cam.getWorldDirection(_q);
    const dx = sp.x - cam.position.x;
    const dz = sp.z - cam.position.z;
    const a = Math.atan2(dz, dx) - Math.atan2(f.z, f.x);
    return Math.abs(THREE.MathUtils.radToDeg(Math.atan2(Math.sin(a), Math.cos(a))));
  }

  // 생성 위치가 지금 플레이어 화면에 보이는지 (시야각 + 여유, 가림 판정)
  isSpawnVisible(sp, entrance) {
    const crouched = entrance === 'coverPop';
    const heights = crouched ? [0.6, 1.2] : [0.9, 1.8]; // 웅크린 머리 끝 ≈1.15m, 선 머리 끝 ≈1.85m
    for (const h of heights) {
      _p.set(sp.x, sp.y + h, sp.z);
      if (this.isPointVisible(_p)) return true;
    }
    return false;
  }

  isPointVisible(point) {
    const cam = this.game.camera;
    const D = CONFIG.director;
    if (point.distanceTo(cam.position) < 5) return true;
    _q.copy(point).applyMatrix4(cam.matrixWorldInverse);
    if (_q.z > -0.1) return false; // 뒤쪽
    const margin = THREE.MathUtils.degToRad(D.visibilityMarginDeg);
    const vHalf = THREE.MathUtils.degToRad(cam.fov / 2) + margin;
    const hHalf = Math.atan(Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * cam.aspect) + margin;
    if (Math.abs(_q.x / -_q.z) > Math.tan(Math.min(1.5, hHalf))) return false;
    if (Math.abs(_q.y / -_q.z) > Math.tan(Math.min(1.5, vHalf))) return false;
    return this.game.world.hasLineOfSight(cam.position, point);
  }

  debugInfo() {
    return {
      phase: this.hostile.phase,
      label: this.hostile.debugInfo(),
      threat: this.threat,
      cap: this.cap,
      active: this.activeHostiles(),
      pending: this.pending.length,
      intensity: this.intensity,
      nextLevelIn: CONFIG.threat.secondsPerLevel - (this.elapsed % CONFIG.threat.secondsPerLevel),
      lastSpawns: this.spawnLog.slice(-4),
    };
  }
}

function lerpWeights(level) {
  const [a, b] = CONFIG.threat.typeWeights;
  const t = Math.min(1, Math.max(0, (level - 1) / (CONFIG.threat.maxLevel - 1)));
  const out = {};
  for (const k of Object.keys(a)) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

export function entranceFor(spType) {
  if (spType === 'behindCover') return 'coverPop';
  if (spType === 'window') return 'window';
  if (spType === 'roof') return 'roof';
  return 'walkOut';
}
