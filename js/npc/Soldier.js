// 무장 NPC 공통 — 적군·아군이 함께 쓰는 지각(시야각·거리·가림)·반응 지연·점사·명중 판정·이동 보조
// 대상(target)은 'player' 또는 NPC. 적대 판정은 trueFaction 기준 (candidateTargets 에서 결정)
// NPC 총알은 적대 대상에게만 피해를 준다 — 같은 진영·민간인·(아군 탄의) 플레이어에게는 피해 없음
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
        this.reactT = Math.max(this.reactT, R.range(this.reactRange[0], this.reactRange[1]) * 0.5);
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

  _setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  // 경로 설정 (성공 여부 반환)
  _goTo(nodeId, kind, run = true) {
    const nav = this.game.world.nav;
    const path = nav.findPath(this.navNode, nodeId);
    if (!path) return false;
    this.setPath(path);
    this.goalKind = kind;
    this.goalNode = nodeId;
    this.moveSpeed = run ? this.tcfg.run : this.tcfg.walk;
    this.crouchTarget = 0;
    this.aimTarget = 0;
    this._setState('move');
    return true;
  }

  _releaseCover() {
    if (this.coverNode && this.coverNode.reservedBy === this) this.coverNode.reservedBy = null;
    this.coverNode = null;
  }

  // 숨기 ↔ 고개 내밀기 주기. 반환: 'peek'(막 일어섬) | 'hide'(막 숨음) | null
  _coverCycle(dt, peekRange = [1.8, 3.4], hideRange = CONFIG.npc.coverPeek) {
    this.phaseT -= dt;
    if (this.coverPhase === 'hide') {
      this.crouchTarget = 1;
      this.aimTarget = 0;
      if (this.phaseT <= 0) {
        this.coverPhase = 'peek';
        this.phaseT = R.range(peekRange[0], peekRange[1]);
        this.burstLeft = 0;
        this.burstPauseT = R.range(0.15, 0.45);
        return 'peek';
      }
    } else {
      this.crouchTarget = 0;
      this.aimTarget = 1;
      const doneBurst = this.shotsInPeek >= 1 && this.burstLeft === 0;
      if (this.phaseT <= 0 || doneBurst) {
        this.coverPhase = 'hide';
        this.phaseT = R.range(hideRange[0], hideRange[1]);
        this.shotsInPeek = 0;
        return 'hide';
      }
    }
    return null;
  }

  // ------------------------------------------------------------------
  // 사격
  // ------------------------------------------------------------------
  _canShoot() {
    if (!this.target || !Soldier.targetAlive(this.target, this.game)) return false;
    if (!this.aware || !this.hasLOS) return false;
    if (this.game.time - this.spawnTime < CONFIG.npc.spawnGrace * 0.6) return false;
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

  // 공통 명중 보정 (거리·점사 순번·이동 사격·등장 유예·시야 확보 직후)
  _baseHitChance(dist) {
    const game = this.game;
    const A = CONFIG.npc.accuracy;
    let acc = this.tcfg.accuracy * this.accMul;
    const f = THREE.MathUtils.clamp((dist - A.nearDist) / (A.farDist - A.nearDist), 0, 1);
    acc *= 1 + (A.farFactor - 1) * f;
    acc *= Math.max(0.4, 1 - A.burstDecay * this.shotIdx);
    if (this.curSpeed > 0.5) acc *= A.movingShooterFactor;
    const since = game.time - this.spawnTime - CONFIG.npc.spawnGrace;
    if (since < 0) return 0;
    acc *= 0.25 + 0.75 * Math.min(1, since / CONFIG.npc.graceRamp);
    acc *= Math.min(1, 0.45 + (game.time - this.losStartT) / 1.2);
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
    // 빗나감: 대상 주변으로 흩어진 탄
    _side.set(-_dir.z, 0, _dir.x).normalize();
    const off = R.range(0.35, 1.7) * R.sign();
    _tmp.copy(_tgt).addScaledVector(_side, off);
    _tmp.y += R.range(-0.6, 0.9);
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
