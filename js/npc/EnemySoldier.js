// 적군 — 빨간 표식. 상태 머신 AI
// 등장 → 엄폐 지점으로 이동 → 시야(시야각·거리·가림)나 총소리로 감지 → 반응 지연 후 사격
// → 맞으면 엄폐 이동 → 시간이 지나면 측면 우회나 돌격
// 유형: rifleman(소총수) / assault(돌격병: 빠른 접근·실내 습격) / window(창문·옥상 사수)
import * as THREE from 'three';
import { CONFIG, lerpThreat, lerpRangeThreat } from '../config.js';
import { Events } from '../core/EventBus.js';
import { NPCBase } from './NPCBase.js';
import { gameRand as R } from '../core/Random.js';

const S = {
  ENTER: 'enter',
  MOVE: 'move',
  COVER: 'cover',
  POST: 'post', // 창가·옥상 자리
  ENGAGE: 'engage',
  RUSH: 'rush',
  SEARCH: 'search',
  DEAD: 'dead',
};
export const EnemyState = S;

const _eye = new THREE.Vector3();
const _tgt = new THREE.Vector3();
const _chest = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _tmp = new THREE.Vector3();
const _side = new THREE.Vector3();

export class EnemySoldier extends NPCBase {
  /**
   * opts: { type, threat, entrance, nodeId, goalNode, goalNodes }
   */
  constructor(game, opts) {
    super(game, { ...opts, trueFaction: 'enemy', apparentFaction: opts.apparentFaction || 'enemy', kind: opts.type });
    this.type = opts.type || 'rifleman';
    this.tcfg = CONFIG.npc.types[this.type];
    this.threat = opts.threat || 1;
    this.entrance = opts.entrance || 'walkOut';
    this.goalNode = opts.goalNode ?? null;
    this.goalNodes = opts.goalNodes || null;
    this.buildingId = opts.buildingId ?? -1;

    this.state = S.ENTER;
    this.stateT = 0;
    this.goalKind = null;
    this.coverNode = null;
    this.postOut = null;

    // 지각
    this.aware = false;
    this.alerted = true; // 디렉터가 투입 — 대략적인 위치는 앎
    this.hasLOS = false;
    this.losStartT = -99;
    this.lastLOST = -99;
    this.lastKnown = new THREE.Vector3();
    this.percT = R.range(0, 0.25);
    this.reactT = 0;

    // 사격
    this.burstLeft = 0;
    this.shotT = 0;
    this.burstPauseT = R.range(0.2, 0.6);
    this.shotIdx = 0;
    this.shotsFired = 0;

    // 엄폐 주기
    this.coverPhase = 'hide';
    this.phaseT = R.range(...CONFIG.npc.coverPeek);
    this.aggroT = R.range(...CONFIG.npc.aggressionTime);
    this.cycles = 0;
    this.repathT = 0;
    this.searchT = 0;

    const reach = lerpRangeThreat(CONFIG.threat.reactionDelay, this.threat);
    this.reactRange = reach;
    this.accMul = lerpThreat(CONFIG.threat.accuracyMul, this.threat);
    this.flankChance = lerpThreat(CONFIG.threat.flankChance, this.threat);
  }

  get stateLabel() {
    return `${this.state}${this.state === S.COVER || this.state === S.POST ? ':' + this.coverPhase : ''}`;
  }

  // ------------------------------------------------------------------
  // 지각 — NPC 마다 주기를 나눠 레이캐스트
  // ------------------------------------------------------------------
  _perceive() {
    const game = this.game;
    const p = game.player;
    this.hasLOS = false;
    if (!p.alive) return;
    const N = CONFIG.npc;
    this.getEyePosition(_eye);
    _tgt.copy(p.eye);
    const dist = _eye.distanceTo(_tgt);
    if (dist > N.sightRange) return;
    if (!this.aware) {
      // 시야각 판정
      _dir.subVectors(_tgt, _eye).normalize();
      const fx = Math.sin(this.yaw);
      const fz = Math.cos(this.yaw);
      const cos = (_dir.x * fx + _dir.z * fz) / Math.max(1e-4, Math.hypot(_dir.x, _dir.z));
      if (cos < Math.cos(THREE.MathUtils.degToRad(N.sightFov / 2))) return;
      // 멀리서 웅크린 플레이어는 늦게 발견
      if (p.crouching && dist > 25 && R.chance(0.5)) return;
    }
    const world = game.world;
    let los = world.hasLineOfSight(_eye, _tgt);
    if (!los) {
      _chest.copy(_tgt);
      _chest.y -= p.crouching ? 0.35 : 0.6;
      los = world.hasLineOfSight(_eye, _chest);
    }
    if (los) {
      this.hasLOS = true;
      if (game.time - this.lastLOST > 1.2) this.losStartT = game.time;
      this.lastLOST = game.time;
      this.lastKnown.copy(p.feet);
      if (!this.aware) {
        this.aware = true;
        this.reactT = R.range(this.reactRange[0], this.reactRange[1]);
      } else if (game.time - this.losStartT < 0.05) {
        // 시야를 잃었다가 다시 찾음: 짧은 재반응
        this.reactT = Math.max(this.reactT, R.range(this.reactRange[0], this.reactRange[1]) * 0.5);
      }
    }
  }

  // 플레이어 총성 청취
  hearShot(pos) {
    if (!this.alive) return;
    this.lastKnown.copy(pos);
    this.lastKnown.y -= 1.6;
    if (!this.aware) {
      this.aware = true;
      this.reactT = R.range(this.reactRange[0], this.reactRange[1]) + 0.25;
    }
  }

  // ------------------------------------------------------------------
  think(dt) {
    const game = this.game;
    this.stateT += dt;
    this.percT -= dt;
    if (this.percT <= 0) {
      this.percT = R.range(...CONFIG.npc.perceptionInterval);
      this._perceive();
    }
    // 시야 상실 시간 초과
    if (this.aware && game.time - this.lastLOST > CONFIG.npc.loseSightTime && !this.hasLOS) {
      // 여전히 경계 상태지만 반응을 다시 해야 함
      this.reactT = Math.max(this.reactT, 0.25);
    }
    if (this.hasLOS) this.reactT -= dt;

    switch (this.state) {
      case S.ENTER: this._enter(); break;
      case S.MOVE: this._move(dt); break;
      case S.COVER: this._cover(dt); break;
      case S.POST: this._post(dt); break;
      case S.ENGAGE: this._engage(dt); break;
      case S.RUSH: this._rush(dt); break;
      case S.SEARCH: this._search(dt); break;
      default: break;
    }

    // 조준 방향·피치
    if (this.aware && (this.hasLOS || game.time - this.lastLOST < 2)) {
      const pe = game.player.eye;
      if (this.state !== S.MOVE || this.hasLOS) {
        if (this.curSpeed < 0.1 || this.type === 'assault' || this.hasLOS) this.faceTowards(pe.x, pe.z);
      }
      this.getEyePosition(_eye);
      const dy = pe.y - 0.4 - _eye.y;
      const dh = Math.hypot(pe.x - _eye.x, pe.z - _eye.z);
      this.aimPitch = Math.atan2(dy, dh);
    } else {
      this.aimPitch *= 0.95;
    }

    this._shooting(dt);
  }

  _setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  _enter() {
    const mgr = this.game.npcs;
    switch (this.entrance) {
      case 'coverPop': {
        // 엄폐물 뒤에 웅크린 채 생성 → 잠시 뒤 튀어나옴
        const n = this.game.world.nav.get(this.navNode);
        this.coverNode = n;
        n.reservedBy = this;
        this.crouchTarget = 1;
        this.crouch = 1;
        this.coverPhase = 'hide';
        this.phaseT = R.range(0.6, 1.6);
        if (n.coverDir) this.targetYaw = this.yaw = Math.atan2(n.coverDir.x, n.coverDir.z);
        this._setState(S.COVER);
        break;
      }
      case 'window':
      case 'roof': {
        const goal = this.entrance === 'window' ? this.goalNode : mgr.pickPostNode(this, this.goalNodes);
        if (goal != null && this._goTo(goal, 'post', false)) break;
        this._goToCover(true);
        break;
      }
      default:
        if (this.type === 'assault') this._startRush();
        else this._goToCover(true);
    }
  }

  // 경로 설정 (성공 여부 반환)
  _goTo(nodeId, kind, run = true) {
    const nav = this.game.world.nav;
    const start = this.navNode;
    const path = nav.findPath(start, nodeId);
    if (!path) return false;
    this.setPath(path);
    this.goalKind = kind;
    this.goalNode = nodeId;
    this.moveSpeed = run ? this.tcfg.run : this.tcfg.walk;
    this.crouchTarget = 0;
    this.aimTarget = 0;
    this._setState(S.MOVE);
    return true;
  }

  _releaseCover() {
    if (this.coverNode && this.coverNode.reservedBy === this) this.coverNode.reservedBy = null;
    this.coverNode = null;
  }

  _goToCover(advance = false, flank = false) {
    this._releaseCover();
    const mgr = this.game.npcs;
    const node = mgr.findCover(this, { advance, flank });
    if (node) {
      node.reservedBy = this;
      this.coverNode = node;
      if (this._goTo(node.id, 'cover', true)) return true;
      node.reservedBy = null;
      this.coverNode = null;
    }
    // 엄폐물이 없으면 플레이어 쪽으로 접근 후 교전
    const near = mgr.nearestNodeToPlayer(this, 14);
    if (near != null && this._goTo(near, 'engage', true)) return true;
    this._setState(S.ENGAGE);
    return false;
  }

  _startRush() {
    this._releaseCover();
    const target = this.game.npcs.playerNode();
    if (target == null || !this._goTo(target, 'rush', true)) {
      this._goToCover(true);
      return;
    }
    this.state = S.RUSH;
    this.repathT = 2.0;
    this._rushTarget = target;
  }

  _move(dt) {
    const done = this._followPath(dt, this.moveSpeed);
    if (!done) return;
    this.curSpeed = 0;
    if (this.goalKind === 'cover' && this.coverNode) {
      this.crouchTarget = 1;
      this.coverPhase = 'hide';
      this.phaseT = R.range(0.4, 1.0);
      if (this.coverNode.coverDir) this.targetYaw = Math.atan2(this.coverNode.coverDir.x, this.coverNode.coverDir.z);
      this._setState(S.COVER);
    } else if (this.goalKind === 'post') {
      const n = this.game.world.nav.get(this.goalNode);
      this.postOut = n.out;
      if (n.out) this.targetYaw = Math.atan2(n.out.x, n.out.z);
      this.crouchTarget = 1;
      this.coverPhase = 'hide';
      this.phaseT = R.range(0.3, 0.9);
      this._setState(S.POST);
    } else if (this.goalKind === 'search') {
      this.searchT = R.range(2.5, 4.5);
      this._setState(S.SEARCH);
    } else {
      this._setState(S.ENGAGE);
    }
  }

  // 엄폐: 숨기 ↔ 고개 내밀고 사격
  _cover(dt) {
    const game = this.game;
    this.phaseT -= dt;
    this.aggroT -= dt;
    const pp = game.player.feet;
    const n = this.coverNode;
    // 플레이어가 돌아 들어와 엄폐가 무의미해지면 이동
    if (n && n.coverDir) {
      const dx = pp.x - n.x;
      const dz = pp.z - n.z;
      const d = Math.hypot(dx, dz);
      const prot = (n.coverDir.x * dx + n.coverDir.z * dz) / Math.max(0.01, d);
      if ((prot < 0.15 || d < 4) && this.stateT > 1.0) {
        if (d < 7) {
          this.crouchTarget = 0;
          this._setState(S.ENGAGE);
        } else this._goToCover(false);
        return;
      }
    }
    if (this.coverPhase === 'hide') {
      this.crouchTarget = 1;
      this.aimTarget = 0;
      if (this.phaseT <= 0) {
        this.coverPhase = 'peek';
        this.phaseT = R.range(1.8, 3.4);
        this.burstLeft = 0;
        this.burstPauseT = R.range(0.15, 0.45);
      }
    } else {
      this.crouchTarget = 0;
      this.aimTarget = 1;
      if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
      const doneBurst = this.shotsInPeek >= 1 && this.burstLeft === 0;
      if (this.phaseT <= 0 || doneBurst) {
        this.coverPhase = 'hide';
        this.phaseT = R.range(...CONFIG.npc.coverPeek);
        this.shotsInPeek = 0;
        this.cycles++;
      }
    }
    // 교착 → 측면 우회 / 돌격 / 전진
    if (this.aggroT <= 0) {
      this.aggroT = R.range(...CONFIG.npc.aggressionTime);
      if (R.chance(this.flankChance)) this._goToCover(false, true);
      else if (this.type === 'assault' || R.chance(0.2 + this.threat * 0.03)) this._startRush();
      else this._goToCover(true);
    }
  }

  // 창가·옥상: 아래로 숨었다가 일어나 사격, 가끔 자리 이동
  _post(dt) {
    this.phaseT -= dt;
    this.aggroT -= dt;
    if (this.coverPhase === 'hide') {
      this.crouchTarget = 1;
      this.aimTarget = 0;
      if (this.phaseT <= 0) {
        this.coverPhase = 'peek';
        this.phaseT = R.range(2.0, 3.8);
        this.burstLeft = 0;
        this.burstPauseT = R.range(0.2, 0.5);
      }
    } else {
      this.crouchTarget = 0;
      this.aimTarget = 1;
      if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
      else if (this.postOut) this.targetYaw = Math.atan2(this.postOut.x, this.postOut.z);
      const doneBurst = this.shotsInPeek >= 1 && this.burstLeft === 0;
      if (this.phaseT <= 0 || doneBurst) {
        this.coverPhase = 'hide';
        this.phaseT = R.range(1.2, 2.6);
        this.shotsInPeek = 0;
        this.cycles++;
        // 플레이어가 반대편이면 자리 이동
        if (this.cycles % 3 === 0 || !this._postFacesPlayer()) {
          const next = this.game.npcs.pickPostNode(this, null);
          if (next != null && next !== this.goalNode) this._goTo(next, 'post', false);
        }
      }
    }
  }

  _postFacesPlayer() {
    if (!this.postOut) return true;
    const pp = this.game.player.feet;
    const dx = pp.x - this.position.x;
    const dz = pp.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return (this.postOut.x * dx + this.postOut.z * dz) / d > 0.2;
  }

  _engage(dt) {
    this.crouchTarget = 0;
    this.aimTarget = 1;
    this.curSpeed = 0;
    if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
    if (this.stateT > R.range(3.5, 6) || (!this.hasLOS && this.stateT > 2.5)) {
      if (this.type === 'assault') this._startRush();
      else if (this.aware && !this.hasLOS && this.game.time - this.lastLOST > 3) this._search();
      else this._goToCover(false);
    }
  }

  _rush(dt) {
    const game = this.game;
    this.aimTarget = this.hasLOS ? 0.7 : 0;
    this.repathT -= dt;
    const pd = this.position.distanceTo(game.player.feet);
    if (pd < 6.5 && this.hasLOS) {
      this.path = null;
      this._setState(S.ENGAGE);
      return;
    }
    if (this.repathT <= 0) {
      this.repathT = 2.0;
      const target = game.npcs.playerNode();
      if (target != null && target !== this._rushTarget) {
        const path = game.world.nav.findPath(this.navNode, target);
        if (path) {
          this.setPath(path);
          this._rushTarget = target;
        }
      }
    }
    const done = this._followPath(dt, this.tcfg.run);
    if (done) this._setState(S.ENGAGE);
  }

  _search(dt) {
    if (this.state !== S.SEARCH) {
      const node = this.game.world.nav.nearest(this.lastKnown.x, this.lastKnown.y, this.lastKnown.z, (n) => !n.removed, 20);
      if (node && this._goTo(node.id, 'search', false)) return;
      this._goToCover(true);
      return;
    }
    this.searchT -= dt;
    this.targetYaw += dt * 1.2;
    if (this.searchT <= 0) this._goToCover(true);
  }

  // ------------------------------------------------------------------
  // 사격
  // ------------------------------------------------------------------
  _canShoot() {
    const game = this.game;
    if (!game.player.alive || !this.aware || !this.hasLOS) return false;
    if (game.time - this.spawnTime < CONFIG.npc.spawnGrace * 0.6) return false;
    if (this.reactT > 0) return false;
    if (this.aim < 0.6) return false;
    if (this.state === S.MOVE && this.type !== 'assault') {
      // 소총수는 가까울 때만 이동 사격
      if (this.position.distanceTo(game.player.feet) > 12) return false;
    }
    if ((this.state === S.COVER || this.state === S.POST) && this.coverPhase !== 'peek') return false;
    return true;
  }

  _shooting(dt) {
    if (this.state === S.MOVE && this.hasLOS && this.aware && (this.type === 'assault' || this.position.distanceTo(this.game.player.feet) < 12)) {
      this.aimTarget = 0.8;
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

  _hitChance(dist) {
    const game = this.game;
    const A = CONFIG.npc.accuracy;
    const p = game.player;
    let acc = this.tcfg.accuracy * this.accMul;
    const dt = THREE.MathUtils.clamp((dist - A.nearDist) / (A.farDist - A.nearDist), 0, 1);
    acc *= 1 + (A.farFactor - 1) * dt;
    acc *= 1 - A.moveFactor * Math.min(1, p.speed / CONFIG.player.sprintSpeed);
    if (p.crouching) acc *= A.crouchFactor;
    acc *= Math.max(0.4, 1 - A.burstDecay * this.shotIdx);
    if (this.curSpeed > 0.5) acc *= A.movingShooterFactor;
    // 등장 직후 유예 + 서서히 정확해짐
    const since = game.time - this.spawnTime - CONFIG.npc.spawnGrace;
    if (since < 0) return 0;
    acc *= 0.25 + 0.75 * Math.min(1, since / CONFIG.npc.graceRamp);
    // 시야 확보 직후 첫 사격은 부정확
    acc *= Math.min(1, 0.45 + (game.time - this.losStartT) / 1.2);
    return Math.min(A.max, acc);
  }

  _fireShot() {
    const game = this.game;
    const p = game.player;
    this.rig.getMuzzleWorld(_muzzle);
    _tgt.copy(p.eye);
    _tgt.y -= p.crouching ? 0.25 : 0.45;
    const dist = _muzzle.distanceTo(_tgt);
    _dir.subVectors(_tgt, _muzzle).normalize();
    this.rig.onFire();
    this.shotsFired++;
    this.shotsInPeek = (this.shotsInPeek || 0) + 1;
    game.audio.enemyGunshot(_muzzle);
    game.effects.enemyMuzzle(_muzzle, _dir);
    game.events.emit(Events.WEAPON_FIRED, { shooter: this, isPlayer: false, position: _muzzle.clone(), direction: _dir.clone() });

    // 실제로 총구에서 플레이어까지 막혀 있으면 엄폐물에 맞음
    const blocked = game.world.collision.segmentBlocked(_muzzle, _tgt);
    const hit = !blocked && R.next() < this._hitChance(dist);
    if (hit) {
      const dmg = CONFIG.npc.hitDamage[this.type] || 9;
      p.takeDamage(dmg, _muzzle, this);
      if (R.chance(0.35)) game.effects.tracer(_muzzle, _tgt, true);
      return;
    }
    // 빗나감: 플레이어 주변으로 흩어진 탄
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
    }
    if (R.chance(0.45)) game.effects.tracer(_muzzle, end, true);
    // 귀 옆을 스침
    const toHead = _chest.subVectors(p.eye, _muzzle);
    const along = toHead.dot(_dir);
    const travel = res ? res.distance : dist + 45;
    if (along > 0 && along < travel) {
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
  }

  // ------------------------------------------------------------------
  onDamaged() {
    const game = this.game;
    this.aware = true;
    this.lastKnown.copy(game.player.feet);
    this.reactT = Math.min(this.reactT, 0.25);
    if (this.state === S.COVER && this.coverPhase === 'peek' && R.chance(0.55)) {
      this.coverPhase = 'hide';
      this.phaseT = R.range(1.0, 2.0);
      if (R.chance(0.5)) this._goToCover(false);
    } else if (this.state === S.ENGAGE && R.chance(0.65)) {
      this._goToCover(false);
    } else if (this.state === S.POST && R.chance(0.6)) {
      this.coverPhase = 'hide';
      this.phaseT = R.range(1.5, 2.5);
    }
  }

  onDeath() {
    this._releaseCover();
    this.state = S.DEAD;
  }
}
