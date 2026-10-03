// 무장 NPC 공통 — 적군·아군이 함께 쓰는 지각(시야각·거리·가림)·반응 지연·점사·명중 판정·이동 보조
// 대상(target)은 'player' 또는 NPC. 적대 판정은 trueFaction 기준 (candidateTargets 에서 결정)
// NPC 총알은 적대 대상에게만 피해를 준다 — 같은 진영·민간인·(아군 탄의) 플레이어에게는 피해 없음
// v1.1 엄폐 규칙: 전투 NPC 는 '유효한 엄폐'(npcs.coverCheck — 위협 눈높이에서 웅크린 머리·몸통이 가려지고, 일어서거나
//   옆으로 내밀면 위협이 보임)에서만 웅크린다. 엄폐 판정은 위협 위치 기준으로 그때그때(_evalCover), 교전은
//   웅크려 대기 → 1~2초 일어서거나 옆으로 내밀어(lean) 짧게 사격 → 다시 숨음. 마지막 안전장치 _enforceCrouch.
//   엄폐가 없으면 옆으로 움직이며 사격(_strafe). 상태가 바뀐 이유는 stateReason (디버그 오버레이)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { NPCBase } from './NPCBase.js';
import { gameRand as R } from '../core/Random.js';

const _eye = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _side = new THREE.Vector3();
const _close = new THREE.Vector3();
const _te = new THREE.Vector3();

export class Soldier extends NPCBase {
  constructor(game, opts) {
    super(game, opts);
    this.target = null; // 'player' | NPC
    this.aware = false;
    this.hasLOS = false;
    this.losStartT = -99;
    this.lastLOST = -99;
    this.lastKnown = new THREE.Vector3();
    this.percT = R.range(0, 0.25);
    this.reactT = 0;
    this.reactRange = [0.5, 0.8];
    this.accMul = 1;
    this.sightRange = CONFIG.npc.sightRange;
    this.sightFov = CONFIG.npc.sightFov;
    this.perceptionInterval = CONFIG.npc.perceptionInterval;

    // 사격
    this.burstLeft = 0;
    this.shotT = 0;
    this.burstPauseT = R.range(0.2, 0.6);
    this.shotIdx = 0;
    this.shotsFired = 0;
    this.shotsInPeek = 0;
    this.mag = null; // 탄창 관리가 필요한 NPC 만 숫자 (아군)
    this.reloadT = 0;

    // 이동·엄폐
    this.state = 'enter';
    this.stateT = 0;
    this.goalKind = null;
    this.goalNode = null;
    this.coverNode = null;
    this.coverPhase = 'hide';
    this.phaseT = R.range(...CONFIG.npc.coverPeek);
    // v1.1 엄폐 판정·몸 내밀기·옆 이동
    this.coverEval = { t: -9 + R.range(0, 0.4), x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, protected: false, peek: null, valid: false, leanX: 0, leanZ: 0, noThreat: true };
    this.coverAnchor = new THREE.Vector3(); // 엄폐 자리 (몸을 옆으로 내밀어도 여기로 돌아옴)
    this.inCoverSpot = false;
    this.lean = new THREE.Vector3(); // 지금 내민 만큼 (anchor 기준)
    this.peekMode = null; // 'up' | 'left' | 'right'
    this.afterBurstT = -1;
    this.strafeSide = R.sign();
    this.strafePauseT = 0;
    this.weave = 0; // 지그재그 이동 세기 (NPCBase._followPath)
    this.leadFrac = 0; // 적의 예측 사격 정도 (EnemySoldier — 빗나간 탄을 대상이 가던 쪽으로)
    this.stateReason = '등장';
    this.crouchNote = '';
  }

  // ------------------------------------------------------------------
  // 서브클래스가 정의
  // ------------------------------------------------------------------
  /** 우선순위 순서의 후보 대상 목록 ('player' 또는 NPC) */
  candidateTargets() {
    return [];
  }

  /** 대상에게 주는 1발 피해 { amount, zone } */
  rollDamage() {
    return { amount: 8, zone: 'torso' };
  }

  gunSound(pos) {
    this.game.audio.enemyGunshot(pos);
  }

  get isEnemyTracer() {
    return true;
  }

  // ------------------------------------------------------------------
  // 대상 위치 보조
  // ------------------------------------------------------------------
  static targetAlive(t, game) {
    if (!t) return false;
    if (t === 'player') return game.player.alive;
    return t.alive;
  }

  targetEye(t, out) {
    if (t === 'player') return out.copy(this.game.player.eye);
    return t.getEyePosition(out);
  }

  targetAimPoint(t, out) {
    if (t === 'player') {
      const p = this.game.player;
      out.copy(p.eye);
      out.y -= p.crouching ? 0.25 : 0.45;
      return out;
    }
    return t.getChestPosition(out);
  }

  targetFeet(t, out) {
    if (t === 'player') return out.copy(this.game.player.feet);
    return out.copy(t.position);
  }

  // ------------------------------------------------------------------
  // 지각 — NPC 마다 주기를 나눠 레이캐스트 (한 번에 최대 3개 대상)
  // ------------------------------------------------------------------
  _perceive() {
    const game = this.game;
    const world = game.world;
    this.hasLOS = false;
    const cands = this.candidateTargets();
    if (!cands.length) return;
    this.getEyePosition(_eye);
    const fovCos = Math.cos(THREE.MathUtils.degToRad(this.sightFov / 2));
    const fx = Math.sin(this.yaw);
    const fz = Math.cos(this.yaw);
    let checks = 0;
    for (const t of cands) {
      if (!Soldier.targetAlive(t, game)) continue;
      this.targetEye(t, _tgt);
      const dist = _eye.distanceTo(_tgt);
      if (dist > this.sightRange) continue;
      if (!this.aware || t !== this.target) {
        _dir.subVectors(_tgt, _eye);
        const cos = (_dir.x * fx + _dir.z * fz) / Math.max(1e-4, Math.hypot(_dir.x, _dir.z));
        if (cos < fovCos && dist > 6) continue;
        // 멀리서 웅크린 플레이어는 늦게 발견
        if (t === 'player' && game.player.crouching && dist > 25 && R.chance(0.5)) continue;
      }
      if (checks++ >= 3) break;
      let los = world.hasLineOfSight(_eye, _tgt);
      if (!los) {
        this.targetAimPoint(t, _chest);
        los = world.hasLineOfSight(_eye, _chest);
      }
      if (!los) continue;
      const switched = t !== this.target;
      this.target = t;
      this.hasLOS = true;
      if (game.time - this.lastLOST > 1.2 || switched) this.losStartT = game.time;
      this.lastLOST = game.time;
      this.targetFeet(t, this.lastKnown);
      if (!this.aware) {
        this.aware = true;
        this.reactT = R.range(this.reactRange[0], this.reactRange[1]);
        this.onAcquire(t, true);
      } else if (game.time - this.losStartT < 0.05) {
        // 시야를 잃었다가 다시 찾음(또는 대상 전환): 짧은 재반응
        this.reactT = Math.max(this.reactT, R.range(this.reactRange[0], this.reactRange[1]) * CONFIG.npc.reacquireReactMul);
        this.onAcquire(t, false);
      }
      return;
    }
  }

  // 대상을 처음 발견/재발견 (콜아웃 등)
  onAcquire() {}

  _tickPerception(dt) {
    this.stateT += dt;
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = R.range(...this.perceptionInterval);
      this._perceive();
    }
    if (this.aware && this.game.time - this.lastLOST > CONFIG.npc.loseSightTime && !this.hasLOS) {
      this.reactT = Math.max(this.reactT, 0.25);
    }
    if (this.target && !Soldier.targetAlive(this.target, this.game)) {
      this.target = null;
      this.hasLOS = false;
    }
    if (this.hasLOS) this.reactT -= dt;
  }

  // 대상 쪽으로 몸·총구 피치
  _aimAtTarget(allowTurn = true) {
    const game = this.game;
    if (this.target && this.aware && (this.hasLOS || game.time - this.lastLOST < 2)) {
      this.targetAimPoint(this.target, _tgt);
      if (allowTurn) this.faceTowards(_tgt.x, _tgt.z);
      this.getEyePosition(_eye);
      this.aimPitch = Math.atan2(_tgt.y - _eye.y, Math.hypot(_tgt.x - _eye.x, _tgt.z - _eye.z));
    } else {
      this.aimPitch *= 0.95;
    }
  }

  // reason: 그 상태가 된 이유 (디버그 오버레이 — 판정 원인을 눈으로 확인)
  _setState(s, reason = null) {
    this.state = s;
    this.stateT = 0;
    if (reason) this.stateReason = reason;
  }

  // 경로 설정 (성공 여부 반환)
  _goTo(nodeId, kind, run = true, reason = null) {
    const nav = this.game.world.nav;
    const path = nav.findPath(this.navNode, nodeId);
    if (!path) return false;
    this._leaveCoverSpot();
    this.stepBack = false;
    this.setPath(path);
    this.goalKind = kind;
    this.goalNode = nodeId;
    this.moveSpeed = run ? this.tcfg.run : this.tcfg.walk;
    this.crouchTarget = 0;
    this.aimTarget = 0;
    this._setState('move', reason);
    return true;
  }

  _releaseCover() {
    if (this.coverNode && this.coverNode.reservedBy === this) this.coverNode.reservedBy = null;
    this.coverNode = null;
  }

  // ------------------------------------------------------------------
  // v1.1 엄폐 — 위협 기준 판정·숨기 ↔ 일어서기/옆으로 내밀기·옆 이동 사격
  // ------------------------------------------------------------------
  /** 지금 위협의 눈 위치 (서브클래스가 정함: 적 = 대상 NPC 또는 플레이어 / 아군 = 가장 가까운 빨간 표식). 없으면 null */
  threatEye(out) {
    return out.copy(this.game.player.eye);
  }

  /** 엄폐 자리에 들어감 (몸을 내밀었다가 돌아올 기준점) */
  _enterCoverSpot(x, y, z) {
    this.coverAnchor.set(x, y, z);
    this.inCoverSpot = true;
    this.lean.set(0, 0, 0);
    this.afterBurstT = -1;
    this.coverEval.t = -9; // 바로 다시 판정
  }

  _leaveCoverSpot() {
    if (this.inCoverSpot && this.lean.lengthSq() > 1e-4) {
      // 내민 몸을 기준점으로 되돌려 놓고 떠남 (경로는 노드에서 시작)
      this.position.copy(this.coverAnchor);
    }
    this.inCoverSpot = false;
    this.lean.set(0, 0, 0);
  }

  /** 지금 자리의 엄폐 판정 — recheck 주기마다, 위협·자리가 움직이면 즉시 다시 (위협 위치 기준, 저장된 방향은 안 씀) */
  _evalCover(force = false) {
    const C = CONFIG.npc.cover;
    const e = this.coverEval;
    const eye = this.threatEye(_te);
    if (!eye) {
      e.valid = e.protected = false;
      e.peek = null;
      e.noThreat = true;
      e.t = this.game.time;
      return e;
    }
    const a = this.inCoverSpot ? this.coverAnchor : this.position;
    const moved = Math.abs(eye.x - e.tx) + Math.abs(eye.z - e.tz) + Math.abs(eye.y - e.ty) > C.threatMove || Math.abs(a.x - e.x) + Math.abs(a.z - e.z) > 0.3;
    if (!force && !moved && !e.noThreat && this.game.time - e.t < C.recheck) return e;
    e.t = this.game.time;
    e.tx = eye.x;
    e.ty = eye.y;
    e.tz = eye.z;
    e.x = a.x;
    e.y = a.y;
    e.z = a.z;
    e.noThreat = false;
    this.game.npcs.coverCheck(a.x, a.y, a.z, eye, e);
    return e;
  }

  /** 지금 웅크려도 되는 자리인지 (엄폐 자리 + 최근 판정이 유효) */
  get coverOK() {
    const e = this.coverEval;
    return this.inCoverSpot && e.valid && this.game.time - e.t < 1.2;
  }

  // 몸 내밀기: 엄폐 기준점에서 lean 만큼 옆으로 (부드럽게)
  _applyLean(dt, tx, tz) {
    if (!this.inCoverSpot) return;
    const k = Math.min(1, dt * 7);
    this.lean.x += (tx - this.lean.x) * k;
    this.lean.z += (tz - this.lean.z) * k;
    this.position.set(this.coverAnchor.x + this.lean.x, this.coverAnchor.y, this.coverAnchor.z + this.lean.z);
    this.curSpeed = Math.abs(tx - this.lean.x) + Math.abs(tz - this.lean.z) > 0.05 ? 1.2 : 0;
  }

  /**
   * 엄폐 교전: 웅크린 채 대기(hide) → 1~2초 일어서거나 옆으로 내밀어(peek) 짧게 사격 → 다시 숨음 (숨는 시간 불규칙)
   * 반환: 'peek'(막 일어섬) | 'hide'(막 숨음) | 'exposed'(엄폐가 무효 — 웅크리지 않음, 호출한 쪽이 이동을 정함) | null
   */
  _coverCycle(dt, peekRange = CONFIG.npc.cover.peek, hideRange = CONFIG.npc.cover.hide) {
    const C = CONFIG.npc.cover;
    const ev = this._evalCover();
    if (!ev.valid) {
      this.crouchTarget = 0;
      this._applyLean(dt, 0, 0);
      return 'exposed';
    }
    this.phaseT -= dt;
    if (this.coverPhase === 'hide') {
      this.crouchTarget = 1;
      this.aimTarget = 0;
      this._applyLean(dt, 0, 0);
      if (this.phaseT <= 0) {
        this.coverPhase = 'peek';
        this.peekMode = ev.peek;
        this.phaseT = R.range(peekRange[0], peekRange[1]);
        this.burstLeft = 0;
        this.burstPauseT = R.range(0.15, 0.4);
        this.afterBurstT = -1;
        return 'peek';
      }
    } else {
      this.crouchTarget = 0;
      this.aimTarget = 1;
      if (ev.peek === 'up') this._applyLean(dt, 0, 0);
      else this._applyLean(dt, ev.leanX, ev.leanZ);
      // 점사를 마치면 잠깐 뒤 숨음 (노출 시간을 짧게)
      if (this.shotsInPeek >= 1 && this.burstLeft === 0 && this.afterBurstT < 0) this.afterBurstT = R.range(C.afterBurst[0], C.afterBurst[1]);
      if (this.afterBurstT >= 0) this.afterBurstT -= dt;
      if (this.phaseT <= 0 || (this.afterBurstT >= 0 && this.afterBurstT <= 0 && this.burstLeft === 0)) {
        this._hideNow(hideRange);
        return 'hide';
      }
    }
    return null;
  }

  // 지금 숨음 (불규칙한 숨는 시간 — 가끔 오래)
  _hideNow(hideRange = CONFIG.npc.cover.hide, extra = 0) {
    const C = CONFIG.npc.cover;
    this.coverPhase = 'hide';
    this.phaseT = (R.chance(C.longHideChance) ? R.range(C.longHide[0], C.longHide[1]) : R.range(hideRange[0], hideRange[1])) + extra;
    this.shotsInPeek = 0;
    this.afterBurstT = -1;
    this.burstLeft = 0;
  }

  /** 엄폐가 없을 때: 위협을 향해 옆으로 움직이며 사격 (노드 사이를 오가며, 가끔 멈칫) — 이동 중 명중률 감점은 그대로 */
  _strafe(dt) {
    const C = CONFIG.npc.cover.strafe;
    this.crouchTarget = 0;
    this.aimTarget = 1;
    if (this.strafePauseT > 0) {
      this.strafePauseT -= dt;
      this.curSpeed = 0;
      return;
    }
    if (this.pathDone) {
      const node = this._pickStrafeNode();
      const path = node ? this.game.world.nav.findPath(this.navNode, node.id, { maxIter: 400 }) : null;
      if (!path) {
        this.strafeSide = -this.strafeSide;
        this.strafePauseT = R.range(0.4, 0.9);
        this.curSpeed = 0;
        return;
      }
      this.setPath(path);
    }
    const speed = (this.tcfg.walk + (this.tcfg.run - this.tcfg.walk) * 0.4) * C.speedMul;
    if (this._followPath(dt, speed)) {
      this.strafePauseT = R.range(C.pause[0], C.pause[1]);
      if (R.chance(0.7)) this.strafeSide = -this.strafeSide;
    }
  }

  // 위협 방향에 수직인 쪽(strafeSide)의 노드 (2.5~7m, 같은 층, 위협 쪽으로 너무 다가가지 않게)
  _pickStrafeNode() {
    const C = CONFIG.npc.cover.strafe;
    const eye = this.threatEye(_te);
    if (!eye) return null;
    const p = this.position;
    let fx = eye.x - p.x;
    let fz = eye.z - p.z;
    const fd = Math.hypot(fx, fz) || 1;
    fx /= fd;
    fz /= fd;
    const nav = this.game.world.nav;
    const cands = nav.inRadius(p.x, p.y, p.z, C.dist[1], (n) => Math.abs(n.y - p.y) < 0.8 && n.id !== this.navNode && n.type !== 'window' && n.type !== 'roof');
    let best = null;
    let bestScore = -Infinity;
    for (const n of cands) {
      const dx = n.x - p.x;
      const dz = n.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d < C.dist[0]) continue;
      const fwd = (dx * fx + dz * fz) / d;
      const side = (dx * -fz + dz * fx) / d; // 위협 기준 오른쪽(+)
      if (Math.abs(fwd) > 0.6) continue;
      if (fd - fwd * d < 6) continue; // 위협에 6m 안으로는 붙지 않음
      let crowd = 0;
      for (const o of this.game.npcs.list) if (o !== this && o.alive && Math.hypot(o.position.x - n.x, o.position.z - n.z) < 1.6) crowd++;
      const score = side * this.strafeSide * 3 - Math.abs(fwd) * 2 - Math.abs(d - 4.5) * 0.4 - crowd * 4 + R.range(0, 1.5);
      if (score > bestScore) {
        bestScore = score;
        best = n;
      }
    }
    return best;
  }

  /**
   * 마지막 안전장치 — 전투 NPC 는 유효한 엄폐 자리에서만 웅크린다 (어떤 경로로 웅크리려 해도 여기서 막음)
   * (crouchTarget 0.3 이하의 무릎 굽힘은 웅크림으로 보지 않음)
   */
  _enforceCrouch() {
    if (this.crouchTarget <= 0.3) return;
    if (this.coverOK) return;
    this.crouchTarget = 0;
    this.crouchNote = '엄폐 무효 — 웅크림 취소';
    this.game.npcs.coverStats.prevented++;
  }

  // ------------------------------------------------------------------
  // 사격
  // ------------------------------------------------------------------
  _canShoot() {
    if (!this.target || !Soldier.targetAlive(this.target, this.game)) return false;
    if (!this.aware || !this.hasLOS) return false;
    if (this.game.time - this.spawnTime < CONFIG.npc.spawnGrace * CONFIG.npc.graceFireFrac) return false;
    if (this.reactT > 0 || this.aim < 0.6) return false;
    if (this.reloadT > 0) return false;
    return true;
  }

  _shooting(dt) {
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0 && this.mag != null) this.mag = this.tcfg.magSize;
    }
    if (!this._canShoot()) {
      if (this.burstLeft > 0 && !this.hasLOS) this.burstLeft = 0;
      return;
    }
    if (this.burstLeft > 0) {
      this.shotT -= dt;
      if (this.shotT <= 0) {
        this.shotT = CONFIG.npc.shotInterval * R.range(0.9, 1.2);
        this._fireShot();
        this.burstLeft--;
        this.shotIdx++;
        if (this.mag != null && --this.mag <= 0) {
          this.burstLeft = 0;
          this.reloadT = this.tcfg.reloadTime;
          this.onReload();
        }
        if (this.burstLeft === 0) this.burstPauseT = R.range(...this.tcfg.burstPause);
      }
    } else {
      this.burstPauseT -= dt;
      if (this.burstPauseT <= 0) {
        this.burstLeft = R.int(this.tcfg.burst[0], this.tcfg.burst[1]);
        this.shotIdx = 0;
        this.shotT = 0;
      }
    }
  }

  onReload() {}

  // 공통 명중 보정 (거리·점사 순번·이동 사격·등장 유예·시야 확보 직후) — burst: { decay, floor } (적은 npc.aim 값)
  _baseHitChance(dist, burst = null) {
    const game = this.game;
    const N = CONFIG.npc;
    const A = N.accuracy;
    let acc = this.tcfg.accuracy * this.accMul;
    const f = THREE.MathUtils.clamp((dist - A.nearDist) / (A.farDist - A.nearDist), 0, 1);
    acc *= 1 + (A.farFactor - 1) * f;
    acc *= Math.max(burst ? burst.burstFloor : A.burstFloor, 1 - (burst ? burst.burstDecay : A.burstDecay) * this.shotIdx);
    if (this.curSpeed > 0.5) acc *= A.movingShooterFactor;
    const since = game.time - this.spawnTime - N.spawnGrace;
    if (since < 0) return 0;
    acc *= 0.25 + 0.75 * Math.min(1, since / N.graceRamp);
    acc *= Math.min(1, N.losRamp.start + (game.time - this.losStartT) / N.losRamp.time);
    return acc;
  }

  _hitChance(dist, target) {
    const A = CONFIG.npc.accuracy;
    let acc = this._baseHitChance(dist);
    if (target === 'player') {
      const p = this.game.player;
      acc *= 1 - A.moveFactor * Math.min(1, p.speed / CONFIG.player.sprintSpeed);
      if (p.crouching) acc *= A.crouchFactor;
    } else {
      if (target.curSpeed > 0.5) acc *= 0.75;
      if (target.crouch > 0.5) acc *= 0.7;
    }
    return Math.min(A.max, acc);
  }

  _fireShot() {
    const game = this.game;
    const t = this.target;
    this.rig.getMuzzleWorld(_muzzle);
    this.targetAimPoint(t, _tgt);
    const dist = _muzzle.distanceTo(_tgt);
    _dir.subVectors(_tgt, _muzzle).normalize();
    this.rig.onFire();
    this.shotsFired++;
    this.shotsInPeek++;
    this.gunSound(_muzzle);
    game.effects.enemyMuzzle(_muzzle, _dir);
    if (this.shotsFired % 3 === 0) game.effects.muzzleSmoke(_muzzle, _dir, 0.8);
    game.events.emit(Events.WEAPON_FIRED, { shooter: this, isPlayer: false, position: _muzzle.clone(), direction: _dir.clone() });

    // 총구에서 대상까지 막혀 있으면 엄폐물에 맞음
    const blocked = game.world.collision.segmentBlocked(_muzzle, _tgt);
    const hit = !blocked && R.next() < this._hitChance(dist, t);
    if (hit) {
      const d = this.rollDamage(t);
      if (t === 'player') game.player.takeDamage(d.amount, _muzzle, this);
      else {
        t.takeDamage({ amount: d.amount, zone: d.zone, attacker: this, direction: _dir.clone(), point: _tgt.clone(), distance: dist });
        game.effects.blood(_tgt, _dir);
      }
      if (R.chance(0.35)) game.effects.tracer(_muzzle, _tgt, this.isEnemyTracer);
      return;
    }
    // 빗나감: 대상 주변으로 흩어진 탄 (v1.1 예측 사격 중이면 대상이 가던 쪽으로 앞서 감 — 방향을 꺾어 피한 탄)
    _side.set(-_dir.z, 0, _dir.x).normalize();
    const off = R.range(0.35, 1.7) * R.sign();
    _tmp.copy(_tgt).addScaledVector(_side, off);
    _tmp.y += R.range(-0.6, 0.9);
    if (t === 'player' && this.leadFrac > 0) {
      const v = game.player.velocity;
      _tmp.x += v.x * 0.14 * this.leadFrac;
      _tmp.z += v.z * 0.14 * this.leadFrac;
    }
    _dir.subVectors(_tmp, _muzzle).normalize();
    const res = game.world.raycast(_muzzle, _dir, dist + 45);
    const end = res ? res.point : _tmp.copy(_muzzle).addScaledVector(_dir, dist + 45);
    if (res) {
      game.effects.impact(res.point, res.normal, res.surface, res.distance > 4);
      game.audio.impact(res.point, res.surface);
      // 5단계: 플레이어 바로 옆에 맞은 탄 — 흙먼지 + 화면 흔들림 (Game 이 NEAR_IMPACT 로 흔들림 처리)
      if (t === 'player') {
        const d = res.point.distanceTo(game.player.eye);
        if (d < 3.2) {
          game.effects.nearImpact(res.point, res.normal, res.surface);
          game.audio.nearImpact(res.point);
          game.events.emit(Events.NEAR_IMPACT, { point: res.point, distance: d });
        }
      }
    }
    if (R.chance(0.45)) game.effects.tracer(_muzzle, end, this.isEnemyTracer);
    const travel = res ? res.distance : dist + 45;
    if (t === 'player') this._nearMissPlayer(travel);
    else {
      // 제압: 대상 가까이로 지나간 탄
      this.targetAimPoint(t, _chest);
      const along = _close.subVectors(_chest, _muzzle).dot(_dir);
      if (along > 0 && along < travel) {
        _close.copy(_muzzle).addScaledVector(_dir, along);
        if (_close.distanceTo(_chest) < CONFIG.ally.suppressRadius) t.onSuppressed(this);
      }
    }
  }

  // 귀 옆을 스침 (플레이어 대상)
  _nearMissPlayer(travel) {
    const game = this.game;
    const p = game.player;
    const along = _chest.subVectors(p.eye, _muzzle).dot(_dir);
    if (along <= 0 || along >= travel) return;
    const closest = _eye.copy(_muzzle).addScaledVector(_dir, along);
    const miss = closest.distanceTo(p.eye);
    if (miss < CONFIG.npc.whizRadius) {
      const camRight = _side.set(1, 0, 0).applyQuaternion(game.camera.quaternion);
      const side = Math.sign(camRight.dot(_eye.sub(p.eye))) || 1;
      game.audio.whiz(side);
      p.addShake(0.12);
      game.events.emit(Events.BULLET_NEAR_MISS, { shooter: this, distance: miss });
    }
  }

  onDeath() {
    this._releaseCover();
    this.state = 'dead';
  }
}
