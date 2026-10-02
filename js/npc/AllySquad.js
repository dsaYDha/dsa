// 아군 분대 (2~4명) — 목표 재평가: 알려진 적이 있으면 엄폐 지점을 따라 전진·교전,
// 없으면 근처 건물 실내 소탕 또는 플레이어 근처로 재집결. 무전 콜아웃 담당 (적 위치는 실제 도움이 되게)
// 3단계: 겉보기 적만 인식(위장 적에게 속음), 분대원 하나가 동행 엄호로 빠지기도 함(escortDecoyT),
//        1인 '낙오병' 분대(straggler)는 계획 없이 플레이어에게 합류. 위치 콜아웃은 주변 아군 표식 인물에게도 들린다
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { gameRand as R } from '../core/Random.js';
import { describeLocation, line } from '../dialogue/Callouts.js';

const CALLSIGNS = ['알파', '브라보', '찰리', '델타', '에코', '폭스'];
let NEXT = 0;
const _v = new THREE.Vector3();

export class AllySquad {
  constructor(game) {
    this.game = game;
    this.id = NEXT++;
    this.name = CALLSIGNS[this.id % CALLSIGNS.length];
    this.members = [];
    this.objective = null; // { kind: 'advance'|'regroup'|'clear', focus, buildingId }
    this.objT = 0.3;
    this.lastCalloutT = -99;
    this.reported = new Map(); // 적 id → 마지막 보고 시각
    this.engagedT = -99;
    this.cleared = new Set();
    this.done = false;
    this.bornT = game.time;
    this.tourEnd = game.time + R.range(...CONFIG.ally.tour);
    this.lastFightT = game.time;
    this.withdrawing = false;
    this.straggler = false; // 1인 낙오병 분대 (계획 없음)
    this.escortDecoyT = null; // 이 시간이 지나면 분대원 하나가 플레이어 동행으로 빠짐
    this.unit = R.pick(CONFIG.dialogue.units); // 4단계: 소속 부대 (분대원 모두 같은 어깨 패치, "소속 대!"에 이 이름으로 답함)
  }

  /** 분대 계획에 따르는 분대원 (동행·합류 중인 인원 제외) */
  get free() {
    return this.alive.filter((m) => !m.isEscorting);
  }

  // 분대원 하나를 플레이어 동행으로 (오판 유도용 진짜 동행)
  detachEscort(duration) {
    const cands = this.free;
    if (cands.length < 1) return null;
    const m = cands.length > 1 ? cands[cands.length - 1] : cands[0];
    m.startEscort(duration);
    const dc = this.game.director && this.game.director.decoyCount;
    if (dc) dc.escort++;
    return m;
  }

  get age() {
    return this.game.time - this.bornT;
  }

  // 최근 교전 중인지 (분대원이 적을 보고 있거나 맞고 있음)
  get fighting() {
    return this.game.time - this.lastFightT < CONFIG.ally.withdrawQuiet;
  }

  add(member) {
    this.members.push(member);
    member.squad = this;
  }

  get alive() {
    return this.members.filter((m) => m.alive);
  }

  centroid(out) {
    const a = this.alive;
    out.set(0, 0, 0);
    for (const m of a) out.add(m.position);
    return a.length ? out.divideScalar(a.length) : out;
  }

  update(dt) {
    const alive = this.alive;
    if (!alive.length) {
      this.done = true;
      return;
    }
    if (this.pendingOrders && this.pendingOrders.length) {
      for (const o of this.pendingOrders) o.delay -= dt;
      const ready = this.pendingOrders.filter((o) => o.delay <= 0);
      this.pendingOrders = this.pendingOrders.filter((o) => o.delay > 0);
      for (const o of ready) if (o.m.alive && !o.m.isEscorting && this.objective && this.objective.kind === 'clear') o.m.orderClear(o.seq);
    }
    const engaged = alive.some((m) => m.target && m.target !== 'player' && m.hasLOS);
    if (engaged) this.lastFightT = this.game.time;
    if (this.straggler) return;
    if (this.escortDecoyT != null) {
      this.escortDecoyT -= dt;
      if (this.escortDecoyT <= 0) {
        this.escortDecoyT = null;
        this.detachEscort(R.range(...CONFIG.disguise.decoy.escortTime));
      }
    }
    if (this.withdrawing) return;
    if (this.game.time > this.tourEnd && !this.fighting) {
      this.withdraw();
      return;
    }
    this.objT -= dt;
    // 교전 중인데 목표가 재집결이면 빨리 재평가
    if (engaged && this.objective && this.objective.kind !== 'advance' && this.objT > 1.5) this.objT = 1.5;
    if (this.objT <= 0) {
      this.objT = R.range(...CONFIG.ally.objectiveInterval);
      this.plan();
    }
  }

  // ------------------------------------------------------------------
  plan() {
    const game = this.game;
    const A = CONFIG.ally;
    const alive = this.free;
    this.pendingOrders = null;
    if (!alive.length) return;
    const c = this.centroid(_v).clone();
    // 알려진 적(빨간 표식): 분대원이 봤거나, 플레이어 화면에 보였거나, 플레이어 근처 — 위장 적은 모른다
    const pf = game.player.feet;
    let focus = null;
    let best = Infinity;
    for (const e of game.npcs.byApparent('enemy')) {
      const seenByUs = alive.some((m) => m.target === e && game.time - m.lastLOST < 6);
      const known = seenByUs || e.visibleToPlayer || e.position.distanceTo(pf) < 35;
      if (!known) continue;
      const d = e.position.distanceTo(c);
      if (d < best && d < 70) {
        best = d;
        focus = e;
      }
    }
    if (focus) {
      this.objective = { kind: 'advance', focus };
      this._advance(focus, c);
      return;
    }
    // 적이 없으면: 가끔 근처 건물 실내 소탕
    if (R.chance(A.clearChance)) {
      const b = this._pickBuilding(c);
      if (b) {
        this.objective = { kind: 'clear', buildingId: b.id };
        this._clear(b);
        return;
      }
    }
    this.objective = { kind: 'regroup' };
    // 3단계: 플레이어 곁으로 오는 김에 한 명이 동행 엄호로 붙기도 함 (위장 적의 '동행'과 구분되지 않게)
    const D = CONFIG.disguise;
    if (game.director.threat >= D.fromThreat && alive.length >= 2 && !this.alive.some((m) => m.isEscorting) && R.chance(D.decoy.regroupEscortChance)) {
      this.detachEscort(R.range(...D.decoy.escortTime));
    }
    this._regroup();
  }

  _advance(enemy, c) {
    const game = this.game;
    const A = CONFIG.ally;
    const ep = enemy.position;
    const away = new THREE.Vector3(c.x - ep.x, 0, c.z - ep.z);
    if (away.lengthSq() < 0.01) away.set(1, 0, 0);
    away.normalize();
    const stop = R.range(A.advanceStopDist[0], A.advanceStopDist[1]);
    const anchor = new THREE.Vector3(ep.x + away.x * stop, 0, ep.z + away.z * stop);
    const used = new Set();
    for (const m of this.free) {
      if (m.state === 'clear' && m.clearSeq) continue;
      const node = this._coverNear(m, anchor, ep, used);
      if (node) {
        used.add(node.id);
        if (node.type === 'cover') {
          m._releaseCover();
          node.reservedBy = m;
          m.coverNode = node;
          m.orderMove(node.id, 'cover');
        } else m.orderMove(node.id, 'hold');
      }
    }
    if (game.time - this.engagedT > 20) {
      this.engagedT = game.time;
      this.callout(this.alive[0], line('allyEngage'));
    }
  }

  // 앵커 근처의 엄폐 지점 (적 방향으로 보호되는 곳) 또는 일반 노드
  _coverNear(m, anchor, enemyPos, used) {
    const nav = this.game.world.nav;
    const cands = nav.inRadius(anchor.x, 0, anchor.z, 11, (n) => !n.indoor && !used.has(n.id) && (n.reservedBy == null || n.reservedBy === m || !n.reservedBy.alive));
    let best = null;
    let bestScore = -Infinity;
    for (const n of cands) {
      const dx = enemyPos.x - n.x;
      const dz = enemyPos.z - n.z;
      const d = Math.hypot(dx, dz) || 1;
      let score = -Math.hypot(n.x - anchor.x, n.z - anchor.z) * 0.4 + R.range(0, 1.5);
      if (n.type === 'cover' && n.coverDir) {
        const prot = (n.coverDir.x * dx + n.coverDir.z * dz) / d;
        if (prot > 0.4) score += 4 + prot * 2;
      }
      // 다른 NPC 와 겹치지 않게
      for (const o of this.game.npcs.list) if (o !== m && o.alive && Math.hypot(o.position.x - n.x, o.position.z - n.z) < 1.6) score -= 4;
      score -= this._playerSpacePenalty(n);
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  // 플레이어 바로 옆(3m 이내)이나 플레이어 정면 조준선 위 지점은 감점
  _playerSpacePenalty(n) {
    const p = this.game.player;
    const dx = n.x - p.feet.x;
    const dz = n.z - p.feet.z;
    const d = Math.hypot(dx, dz);
    let pen = d < 3 ? 12 : 0;
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const t = dx * fx + dz * fz;
    if (t > 0 && t < 40 && Math.abs(dx * fz - dz * fx) < 2) pen += 5;
    return pen;
  }

  _regroup() {
    const game = this.game;
    const A = CONFIG.ally;
    const p = game.player;
    const nav = game.world.nav;
    // 플레이어 뒤쪽·옆쪽 (조준선을 막지 않게)
    const back = R.range(A.regroupDist[0], A.regroupDist[1]);
    const side = R.sign() * R.range(3, 7);
    const fx = -Math.sin(p.yaw);
    const fz = -Math.cos(p.yaw);
    const anchor = new THREE.Vector3(p.feet.x - fx * back + fz * side, p.feet.y, p.feet.z - fz * back - fx * side);
    const indoor = game.world.getIndoorInfo(p.position);
    const used = new Set();
    for (const m of this.free) {
      const cands = nav.inRadius(anchor.x, anchor.y, anchor.z, 9, (n) => !used.has(n.id) && (indoor ? true : !n.indoor) && (n.reservedBy == null || !n.reservedBy.alive));
      let best = null;
      let bestScore = -Infinity;
      for (const n of cands) {
        let score = -Math.hypot(n.x - anchor.x, n.z - anchor.z) + (n.type === 'cover' ? 1.5 : 0) + R.range(0, 1);
        for (const o of game.npcs.list) if (o !== m && o.alive && Math.hypot(o.position.x - n.x, o.position.z - n.z) < 1.6) score -= 4;
        score -= this._playerSpacePenalty(n);
        if (score > bestScore) {
          bestScore = score;
          best = n;
        }
      }
      if (best) {
        used.add(best.id);
        m.orderMove(best.id, 'hold');
      }
    }
  }

  _pickBuilding(c) {
    const game = this.game;
    const playerB = game.world.getIndoorInfo(game.player.position);
    let best = null;
    let bd = Infinity;
    for (const b of game.world.enterable) {
      if (this.cleared.has(b.id)) continue;
      if (playerB && playerB.building.id === b.id) continue;
      const bx = (b.minX + b.maxX) / 2;
      const bz = (b.minZ + b.maxZ) / 2;
      const d = Math.hypot(bx - c.x, bz - c.z);
      const dp = Math.hypot(bx - game.player.feet.x, bz - game.player.feet.z);
      if (d < 40 && dp < 45 && d < bd) {
        bd = d;
        best = b;
      }
    }
    return best;
  }

  // 실내 소탕: 출입구 → 1층 방들 → 계단 → 2층 방들 (분대원이 시차를 두고 같은 순서로)
  _clear(b) {
    const seq = [];
    if (b.doors.length) seq.push(b.doors[0].outside, b.doors[0].inside);
    const floors = Math.min(b.floors, 2);
    for (let k = 0; k < floors; k++) {
      const fn = b.floorNodes[k];
      seq.push(fn.H, fn.h1, fn.R0, fn.h2, fn.R1, fn.Cb);
      if (k + 1 < floors) {
        const lane = k % 2 === 0 ? 'A' : 'B';
        seq.push(lane === 'A' ? fn.lAf : fn.lBb);
        seq.push(lane === 'A' ? b.floorNodes[k + 1].lAb : b.floorNodes[k + 1].lBf);
      }
    }
    const nav = this.game.world.nav;
    const valid = seq.filter((id) => id != null && !nav.get(id).removed);
    this.cleared.add(b.id);
    const free = this.free;
    this._clearing = new Set(free.map((m) => m.id));
    // 분대원이 0.7초 간격으로 같은 순서를 따라 진입 (게임 시간 기준)
    this.pendingOrders = free.map((m, i) => ({ m, delay: i * 0.7, seq: valid }));
    this.callout(this.alive[0], line('allyClearStart'));
    this.objT = 60; // 소탕 끝날 때까지 재평가 보류 (적 발견 시 빨라짐)
  }

  onMemberCleared(m) {
    if (!this._clearing) return;
    this._clearing.delete(m.id);
    if (this._clearing.size === 0) {
      this._clearing = null;
      this.callout(m, line('allyClearDone'));
      this.objT = 0.5;
    }
  }

  // ------------------------------------------------------------------
  // 콜아웃
  // ------------------------------------------------------------------
  callout(member, text, priority = 1) {
    if (!member) return false;
    const game = this.game;
    if (game.time - this.lastCalloutT < 1.2 && priority < 2) return false;
    const ok = game.voice.say({ speaker: `아군 무전 · ${this.name}`, text, channel: 'radio', priority, voice: member.voice });
    if (ok) this.lastCalloutT = game.time;
    return ok;
  }

  // 분대원이 적을 발견 — 같은 적은 일정 시간 안에 다시 보고하지 않음
  reportEnemy(member, enemy, first) {
    const game = this.game;
    const last = this.reported.get(enemy.id) ?? -99;
    if (game.time - last < 15) return;
    if (game.time - this.lastCalloutT < CONFIG.ally.calloutCooldown * (first ? 0.5 : 1)) return;
    const loc = describeLocation(game, enemy);
    if (this.callout(member, line('allySpotted', { loc: loc.place, range: loc.range }), 2)) {
      this.reported.set(enemy.id, game.time);
      // 주변의 다른 아군 표식 인물(동행·낙오병·위장 적)도 무전을 듣는다 — 반응 여부가 행동 단서
      game.npcs.broadcastRadio(this, enemy);
    }
    // 발견하면 목표를 바로 재평가
    if (!this.objective || this.objective.kind !== 'advance') this.objT = Math.min(this.objT, 0.8);
  }

  // 분대 교대: 플레이어에게서 먼 숨은 진입 지점으로 이동 → 화면 밖에서 퇴장 (아군 상한에 자리를 비움)
  withdraw() {
    if (this.withdrawing) return false;
    const game = this.game;
    const A = CONFIG.ally;
    const pf = game.player.feet;
    const c = this.centroid(_v);
    const pts = game.world.spawnPoints.filter((sp) => {
      if (sp.type !== 'alleyEnd' && sp.type !== 'streetEnd') return false;
      const d = Math.hypot(sp.x - pf.x, sp.z - pf.z);
      return d > A.withdrawDist[0] && d < A.withdrawDist[1];
    });
    if (!pts.length) return false;
    // 분대에서 가깝고 플레이어에게서 먼 곳
    let best = null;
    let bestScore = -Infinity;
    for (const sp of pts) {
      const score = Math.hypot(sp.x - pf.x, sp.z - pf.z) * 0.5 - Math.hypot(sp.x - c.x, sp.z - c.z) + R.range(0, 6);
      if (score > bestScore) {
        bestScore = score;
        best = sp;
      }
    }
    this.withdrawing = true;
    this.pendingOrders = null;
    this.objective = { kind: 'withdraw', nodeId: best.nodeId };
    for (const m of this.free) m.orderWithdraw(best.nodeId); // 동행 중인 인원은 동행이 끝난 뒤 따라감
    this.callout(this.alive[0], line('allyWithdraw'), 2);
    return true;
  }

  onMemberDown(m) {
    if (m.killedBy === 'player') return; // 플레이어 오인 사살 → 페널티 시스템이 무전 두절 처리
    const other = this.alive.find((x) => x !== m);
    if (other) this.callout(other, line('allyDown'), 2);
  }

  onArrive() {
    this.callout(this.members[0], line('allyArrive'));
  }
}
