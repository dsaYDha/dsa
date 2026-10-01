// 아군 — 파란 표식. 적과 거의 같은 군복 + 아군 장비 세트(낮은 헬멧·직선 탄창 소총)
// 보조 역할: 낮은 명중률로 제압 사격, 적 처치의 주인공은 플레이어. 적만 공격 (trueFaction 기준)
// 분대(AllySquad)의 지시로 엄폐 지점을 따라 전진·실내 소탕·재집결
// 사선 회피: 플레이어 조준선 앞을 오래 막지 않도록 앉거나 비킴 (교전 중엔 가끔 가로지름)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Soldier } from './Soldier.js';
import { gameRand as R } from '../core/Random.js';
import { line } from '../dialogue/Callouts.js';

const S = { ENTER: 'enter', MOVE: 'move', COVER: 'cover', HOLD: 'hold', CLEAR: 'clear', DEAD: 'dead' };
export const AllyState = S;

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();
const _c = new THREE.Vector3();
const _rel = { t: 0, lat: 0, h: 0 };
const _rel2 = { t: 0, lat: 0, h: 0 };

export class AllySoldier extends Soldier {
  constructor(game, opts) {
    super(game, { ...opts, trueFaction: 'ally', apparentFaction: 'ally', kind: 'ally', maxHealth: CONFIG.ally.health });
    const A = CONFIG.ally;
    this.tcfg = A;
    this.squad = opts.squad || null;
    this.entrance = opts.entrance || 'walkOut';
    this.mag = A.magSize;
    this.reactRange = A.reaction;
    this.sightRange = A.sightRange;
    this.sightFov = A.sightFov;
    this.perceptionInterval = A.perceptionInterval;
    this.state = S.ENTER;
    this.clearSeq = null;
    this.clearIdx = 0;
    this.pauseT = 0;
    this.duckT = 0;
    this.blockT = 0;
    this.lineCheckT = R.range(0, 0.2);
    this.lineCooldown = 0;
    this.orderKind = null;
  }

  get stateLabel() {
    return `${this.state}${this.state === S.COVER ? ':' + this.coverPhase : ''}`;
  }

  // 적만 대상 (가까운 순 최대 3명)
  candidateTargets() {
    const enemies = this.game.npcs.byFaction('enemy');
    const near = [];
    const r2 = this.sightRange * this.sightRange;
    for (const e of enemies) {
      const d = e.position.distanceToSquared(this.position);
      if (d < r2) near.push({ e, d });
    }
    near.sort((a, b) => a.d - b.d);
    return near.slice(0, 3).map((x) => x.e);
  }

  rollDamage() {
    const A = CONFIG.ally;
    const zone = R.chance(A.headChance) ? 'head' : R.weighted({ torso: 0.6, arm: 0.2, leg: 0.2 });
    return { amount: A.damage * (CONFIG.weapon.zoneMultiplier[zone] ?? 1), zone };
  }

  gunSound(pos) {
    this.game.audio.allyGunshot(pos);
  }

  get isEnemyTracer() {
    return false;
  }

  // ------------------------------------------------------------------
  // 분대 지시
  // ------------------------------------------------------------------
  orderMove(nodeId, kind) {
    this.clearSeq = null;
    if (kind !== 'cover') this._releaseCover();
    this.orderKind = kind;
    const ok = this._goTo(nodeId, kind, true);
    if (!ok) this._setState(S.HOLD);
    return ok;
  }

  // 분대 교대: 뛰어서 이동, 플레이어 화면 밖·충분히 멀어지면 퇴장
  orderWithdraw(nodeId) {
    this.clearSeq = null;
    this._releaseCover();
    this.orderKind = 'withdraw';
    this.withdrawing = true;
    this.withdrawNode = nodeId;
    this.leaveCheckT = 1;
    if (!this._goTo(nodeId, 'withdraw', true)) this._setState(S.HOLD);
  }

  _checkLeave(dt) {
    this.leaveCheckT -= dt;
    if (this.leaveCheckT > 0) return;
    this.leaveCheckT = 0.5;
    const d = this.position.distanceTo(this.game.player.feet);
    const arrived = this.state !== S.MOVE;
    if (!this.visibleToPlayer && (d > CONFIG.ally.leaveDist || (arrived && d > 12))) {
      this._releaseCover();
      this.alive = false;
      this.removed = true;
      this.leftArea = true;
    } else if (arrived && this.navNode !== this.withdrawNode && this.stateT > 1.5) {
      // 사선 회피로 비켜 선 뒤라면 다시 이동 목표로
      if (!this._goTo(this.withdrawNode, 'withdraw', true)) this.withdrawNode = this.navNode;
    }
  }

  orderClear(seq) {
    this._releaseCover();
    this.clearSeq = seq;
    this.clearIdx = 0;
    this.orderKind = 'clear';
    this._nextClearNode();
  }

  _nextClearNode() {
    while (this.clearSeq && this.clearIdx < this.clearSeq.length) {
      const id = this.clearSeq[this.clearIdx++];
      if (id === this.navNode) continue;
      if (this._goTo(id, 'clear', false)) {
        this.moveSpeed = this.tcfg.walk * 1.4;
        return true;
      }
    }
    this.clearSeq = null;
    if (this.squad) this.squad.onMemberCleared(this);
    this._setState(S.HOLD);
    return false;
  }

  // ------------------------------------------------------------------
  think(dt) {
    this._tickPerception(dt);
    this.duckT = Math.max(0, this.duckT - dt);
    this.lineCooldown = Math.max(0, this.lineCooldown - dt);

    switch (this.state) {
      case S.ENTER:
        if (this.stateT > 0.6) this._setState(S.HOLD);
        break;
      case S.MOVE:
        this._move(dt);
        break;
      case S.COVER:
        this._cover(dt);
        break;
      case S.HOLD:
        this._hold();
        break;
      case S.CLEAR:
        this.pauseT -= dt;
        this.aimTarget = this.target && this.hasLOS ? 1 : 0.6;
        if (this.pauseT <= 0) this._nextClearNode();
        break;
      default:
        break;
    }
    this._aimAtTarget(this.curSpeed < 0.1);
    this._sightLine(dt);
    this._shooting(dt);
    if (this.withdrawing) this._checkLeave(dt);
  }

  _move(dt) {
    if (this._waitForGap(dt)) return;
    const done = this._followPath(dt, this.moveSpeed);
    if (!done) return;
    this.curSpeed = 0;
    if (this.goalKind === 'cover' && this.coverNode) {
      this.coverPhase = 'hide';
      this.phaseT = R.range(0.4, 1.2);
      if (this.coverNode.coverDir) this.targetYaw = Math.atan2(this.coverNode.coverDir.x, this.coverNode.coverDir.z);
      this._setState(S.COVER);
    } else if (this.goalKind === 'clear') {
      this.pauseT = R.range(0.8, 1.6);
      this.targetYaw += R.range(-1.2, 1.2);
      this._setState(S.CLEAR);
    } else {
      this._setState(S.HOLD);
    }
  }

  _cover(dt) {
    // 적이 보이거나 최근에 봤으면 숨기↔일어나 사격, 아니면 웅크린 채 경계
    if (this.target && this.aware && this.game.time - this.lastLOST < 6) {
      this._coverCycle(dt, [2.0, 3.6], [1.0, 2.4]);
      if (this.duckT > 0) {
        this.crouchTarget = 1;
        this.aimTarget = 0;
      }
    } else {
      this.crouchTarget = 1;
      this.aimTarget = 0.3;
    }
  }

  _hold() {
    const engaged = this.target && this.aware && this.game.time - this.lastLOST < 4;
    this.aimTarget = engaged ? 1 : 0.4;
    this.crouchTarget = this.duckT > 0 ? 1 : engaged ? 0 : 0.5;
  }

  _canShoot() {
    if (!super._canShoot()) return false;
    if (this.curSpeed > 0.4) return false; // 이동 중엔 쏘지 않음
    if (this.duckT > 0) return false;
    if (this.state === S.COVER && this.coverPhase !== 'peek') return false;
    return this.state === S.COVER || this.state === S.HOLD || this.state === S.CLEAR;
  }

  // ------------------------------------------------------------------
  // 사선 회피 — 플레이어 조준선 앞을 오래 막으면 앉거나 비킴
  // ------------------------------------------------------------------
  // 플레이어가 지금 쏘고 있는지 (마지막 발사 후 0.5초)
  _playerFiring() {
    return this.game.player.alive && this.game.weapon.timeSinceShot < 0.5;
  }

  // 점 p 와 플레이어 조준선의 관계: { t(전방 거리), lat(옆 거리), h(그 지점 조준선 높이 - 발 높이) }
  _aimLineRel(px, py, pz, out) {
    const cam = this.game.camera;
    cam.getWorldDirection(_f);
    _v.set(px - cam.position.x, py - cam.position.y, pz - cam.position.z);
    const t = _v.dot(_f);
    out.t = t;
    out.lat = _v.addScaledVector(_f, -t).length();
    out.h = cam.position.y + _f.y * t - this.position.y;
    return out;
  }

  // 이동 중: 플레이어가 쏘는 조준선을 막 가로지르려 하면 잠깐 멈춰 틈을 기다림 (가끔은 그냥 가로지름)
  _waitForGap(dt) {
    const L = CONFIG.ally.sightLine;
    this.gapCheckT = (this.gapCheckT || 0) - dt;
    if (this.gapWaitT > 0) {
      this.gapWaitT -= dt;
      // 기다리는 사이 조준선이 이쪽으로 옮겨 왔으면 멈춰 있지 말고 빠져나감
      const now = this._aimLineRel(this.position.x, this.position.y + 1.2, this.position.z, _rel);
      if (!this._playerFiring() || this.gapWaitT <= 0 || (now.t > 1 && now.lat < L.width + 0.2)) this.gapWaitT = 0;
      else {
        this.curSpeed = 0;
        this.crouchTarget = 0.6;
        return true;
      }
    }
    if (this.gapCheckT > 0 || this.heading == null || !this._playerFiring()) return false;
    this.gapCheckT = 0.15;
    const n = this.game.world.nav.get(this.heading);
    const dx = n.x - this.position.x;
    const dz = n.z - this.position.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return false;
    const now = this._aimLineRel(this.position.x, this.position.y + 1.2, this.position.z, _rel);
    if (now.t < 1 || now.t > 45 || now.lat < L.width + 0.2) return false; // 이미 선 위면 빨리 빠져나감
    const ahead = Math.min(1.8, d);
    const nx = this.position.x + (dx / d) * ahead;
    const nz = this.position.z + (dz / d) * ahead;
    const nxt = this._aimLineRel(nx, this.position.y + 1.2, nz, _rel2);
    if (nxt.t < 1 || nxt.t > 45 || nxt.lat > L.width + 0.4) return false;
    if (this.crossRolledFor !== this.heading) {
      this.crossRolledFor = this.heading;
      this.crossAnyway = R.chance(L.crossChance * 0.5); // 교전 중 가끔은 그대로 가로지름 (긴장 요소)
    }
    if (this.crossAnyway) return false;
    this.gapWaitT = R.range(0.8, 2.2);
    this.curSpeed = 0;
    return true;
  }

  _sightLine(dt) {
    this.lineCheckT -= dt;
    if (this.lineCheckT > 0) return;
    const step = 0.2;
    this.lineCheckT = step;
    const L = CONFIG.ally.sightLine;
    const game = this.game;
    if (!game.player.alive) return;
    const cam = game.camera;
    cam.getWorldDirection(_f);
    // 플레이어와 몸이 겹칠 만큼 가까이 서 있으면 먼저 비킴
    if (this.curSpeed < 0.3 && this.state !== S.MOVE && this.position.distanceTo(game.player.feet) < 1.6 && this.lineCooldown <= 0) {
      this.lineCooldown = 1.0;
      const node = this._sideStepNode(cam.position, _f);
      if (node != null) this.orderMove(node, this.orderKind === 'cover' || this.orderKind === 'clear' ? 'hold' : this.orderKind || 'hold');
      return;
    }
    this.getChestPosition(_c);
    _v.subVectors(_c, cam.position);
    const t = _v.dot(_f);
    let blocking = false;
    if (t > 1.5 && t < 45) {
      const lateral = _v.addScaledVector(_f, -t).length();
      blocking = lateral < L.width + t * 0.01;
    }
    if (!blocking) {
      this.blockT = Math.max(0, this.blockT - step);
      return;
    }
    this.blockT += step;
    if (this.curSpeed > 0.5) return;
    // 플레이어가 지금 쏘고 있으면 즉시 반응, 아니면 잠시 막고 있을 때만
    const playerFiring = this._playerFiring();
    if (playerFiring ? this.lineCooldown > L.cooldown - 0.8 : this.blockT < L.holdTime || this.lineCooldown > 0) return;
    this.blockT = 0;
    this.lineCooldown = L.cooldown;
    const firing = this.burstLeft > 0 || (this.aim > 0.6 && this.hasLOS);
    if (!playerFiring && firing && R.chance(L.crossChance)) return; // 교전 중엔 가끔 그대로 사선에 머묾 (긴장 요소)
    // 조준선이 앉은 머리보다 높게 지나가면 앉아서 피하고, 낮게 지나가면(플레이어가 앉아 쏘는 중 등) 옆으로 비킴
    const lineH = this._aimLineRel(_c.x, _c.y, _c.z, _rel).h;
    if (lineH > 1.4 && this.crouch < 0.5 && this.duckT <= 0) {
      this.duckT = 2.5;
      if (this.squad && R.chance(0.25)) this.squad.callout(this, line('allySightLine'));
    } else {
      // 이미 앉았는데도 막고 있으면 옆 노드로 비킴
      const node = this._sideStepNode(cam.position, _f);
      if (node != null) this.orderMove(node, this.orderKind === 'cover' ? 'hold' : this.orderKind || 'hold');
    }
  }

  _sideStepNode(camPos, fwd) {
    const nav = this.game.world.nav;
    const cand = nav.inRadius(this.position.x, this.position.y, this.position.z, 5, (n) => n.id !== this.navNode && Math.abs(n.y - this.position.y) < 1);
    let best = null;
    let bestScore = -Infinity;
    for (const n of cand) {
      _v.set(n.x - camPos.x, n.y + 1.2 - camPos.y, n.z - camPos.z);
      const t = _v.dot(fwd);
      const lat = t > 0 ? _v.addScaledVector(fwd, -t).length() : 99;
      if (lat < 1.6) continue;
      if (Math.hypot(n.x - camPos.x, n.z - camPos.z) < 2.2) continue; // 플레이어 바로 옆은 제외
      const score = -Math.hypot(n.x - this.position.x, n.z - this.position.z) + Math.min(lat, 4);
      if (score > bestScore) {
        bestScore = score;
        best = n.id;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------
  onAcquire(t, first) {
    if (this.squad && t !== 'player') this.squad.reportEnemy(this, t, first);
  }

  onReload() {
    if (this.squad && R.chance(0.35)) this.squad.callout(this, line('allyReload'));
  }

  onSuppressed() {
    if (this.state === S.COVER && this.coverPhase === 'peek' && R.chance(0.4)) {
      this.coverPhase = 'hide';
      this.phaseT = R.range(1.0, 2.0);
    }
  }

  onDamaged(info) {
    const att = info && info.attacker;
    if (att === 'player') {
      // 맞은 아군의 외침은 무전 차단과 무관하게 항상 들림 (오인 사격 피드백)
      this.game.voice.say({ speaker: '아군', text: line('allyFriendlyFire'), channel: 'shout', priority: 3, force: true, voice: this.voice });
      this.game.camera.getWorldDirection(_f);
      const node = this.curSpeed < 0.5 ? this._sideStepNode(this.game.camera.position, _f) : null;
      if (node != null) {
        this.lineCooldown = CONFIG.ally.sightLine.cooldown;
        this.orderMove(node, this.orderKind === 'cover' || this.orderKind === 'clear' ? 'hold' : this.orderKind || 'hold');
      } else this.duckT = 1.5;
      return;
    }
    if (att && att.position) {
      this.lastKnown.copy(att.position);
      this.aware = true;
      if (!this.hasLOS) this.target = att;
    }
    if (this.state === S.COVER) {
      this.coverPhase = 'hide';
      this.phaseT = R.range(1.2, 2.2);
    }
    if (this.squad && R.chance(0.4)) this.squad.callout(this, line('allyHurt'));
  }

  onDeath() {
    super.onDeath();
    if (this.squad) this.squad.onMemberDown(this);
  }
}
