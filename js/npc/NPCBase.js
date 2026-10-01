// 모든 인물 NPC 의 공통 베이스
// trueFaction: 실제 소속 (enemy / ally / civilian) — 점수·페널티·AI 적대 판정은 이것 기준
// apparentFaction: 겉보기 소속 (표식·복장) — 지금은 항상 같지만 3단계 위장 적에서 달라진다
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { HumanoidRig, defaultOutfit } from './HumanoidRig.js';
import { Insignia } from './Insignia.js';

let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class NPCBase {
  constructor(game, opts) {
    this.id = NEXT_ID++;
    this.game = game;
    this.trueFaction = opts.trueFaction;
    this.apparentFaction = opts.apparentFaction || opts.trueFaction;
    this.kind = opts.kind || 'npc';
    this.maxHealth = opts.maxHealth || CONFIG.npc.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.dying = false;
    this.removed = false;

    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;

    const fac = CONFIG.factions[this.apparentFaction];
    this.rig = new HumanoidRig(opts.outfit || defaultOutfit(fac));
    this.insignia = new Insignia(fac.insignia);
    this.insignia.attach(this.rig);
    this.root = this.rig.root;
    this.root.userData.npc = this;

    this.spawnTime = game.time;
    this.firstSeenAt = null; // 플레이어 화면에 처음 보인 시각 (즉응 사살·판단 통계용)
    this.lastSeenAt = -1;
    this.visibleToPlayer = false;

    // 이동
    this.path = null;
    this.pathIdx = 0;
    this.navNode = opts.nodeId ?? null;
    this.heading = null; // 지금 향하고 있는 노드
    this.moveSpeed = 0;
    this.curSpeed = 0;
    this.segFrom = new THREE.Vector3();
    this._stuckT = 0;
    this._lastPos = new THREE.Vector3();
    this._stepT = 0;

    // 자세
    this.crouch = 0;
    this.crouchTarget = 0;
    this.aim = 0;
    this.aimTarget = 0;
    this.aimPitch = 0;
    this.deathT = 0;
    this.lastDamage = null;
  }

  // 3단계: 겉보기 소속 변경 (표식 색·형태 교체, 필요하면 복장도 교체)
  setApparentFaction(faction, outfit = null) {
    this.apparentFaction = faction;
    const fac = CONFIG.factions[faction];
    if (outfit) {
      this.rig.applyOutfit(outfit);
      this.insignia.attach(this.rig);
    }
    if (fac.insignia) {
      this.insignia.setColor(fac.insignia.color);
      this.insignia.setShape(fac.insignia.shape);
    } else {
      this.insignia.setShape('none');
    }
  }

  placeAt(x, y, z, yaw = 0) {
    this.position.set(x, y, z);
    this.yaw = this.targetYaw = yaw;
    this.root.position.copy(this.position);
    this.root.rotation.y = yaw;
    this._lastPos.copy(this.position);
  }

  getEyePosition(target) {
    const h = 1.62 - this.crouch * 0.62; // 웅크림 눈높이 ≈1.0m
    return target.set(this.position.x, this.position.y + h, this.position.z);
  }

  getChestPosition(target) {
    return target.set(this.position.x, this.position.y + 1.25 - this.crouch * 0.55, this.position.z);
  }

  getHeadPosition(target) {
    return this.rig.getHeadWorld(target);
  }

  // ------------------------------------------------------------------
  // 경로 이동
  // ------------------------------------------------------------------
  setPath(path) {
    this.path = path && path.length ? path : null;
    this.pathIdx = 0;
    this.segFrom.copy(this.position);
    // 첫 노드(마지막으로 지난 노드)를 건너뛸지: 이미 그 위에 있거나, 지금 향하던 노드가 경로의 다음 노드면
    // (경로 재계산 때 뒤로 돌아가는 왕복 방지)
    if (this.path && this.path.length > 1) {
      const n0 = this.game.world.nav.get(this.path[0]);
      const onFirst = Math.hypot(n0.x - this.position.x, n0.z - this.position.z) < 0.6;
      if (onFirst || this.path[1] === this.heading) this.pathIdx = 1;
    }
    this._stuckT = 0;
  }

  get pathDone() {
    return !this.path || this.pathIdx >= this.path.length;
  }

  get remainingPath() {
    if (!this.path) return 0;
    const nav = this.game.world.nav;
    let d = 0;
    let px = this.position.x;
    let pz = this.position.z;
    for (let i = this.pathIdx; i < this.path.length; i++) {
      const n = nav.get(this.path[i]);
      d += Math.hypot(n.x - px, n.z - pz);
      px = n.x;
      pz = n.z;
    }
    return d;
  }

  _followPath(dt, speed) {
    if (this.pathDone) {
      this.curSpeed = 0;
      this.heading = null;
      return true;
    }
    const nav = this.game.world.nav;
    const target = nav.get(this.path[this.pathIdx]);
    this.heading = target.id;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    const step = speed * dt;
    // 높이: 구간 시작점 → 목표 노드 사이를 수평 진행률로 보간 (계단 경사와 일치)
    const segLen = Math.max(0.01, Math.hypot(target.x - this.segFrom.x, target.z - this.segFrom.z));
    if (dist <= step + 0.05) {
      this.position.set(target.x, target.y, target.z);
      this.navNode = target.id;
      this.pathIdx++;
      this.segFrom.copy(this.position);
    } else {
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
      const prog = 1 - (dist - step) / segLen;
      this.position.y = this.segFrom.y + (target.y - this.segFrom.y) * THREE.MathUtils.clamp(prog, 0, 1);
      this.targetYaw = Math.atan2(dx, dz);
    }
    this.curSpeed = speed;
    // 걸음 소리
    this._stepT -= dt;
    if (this._stepT <= 0) {
      this._stepT = speed > 3 ? 0.34 : 0.5;
      this.game.audio.footstep(this.position, { surface: Math.random() < 0.3 ? 'rubble' : 'concrete', volume: speed > 3 ? 1.1 : 0.7, run: speed > 3 });
    }
    // 끼임 감지
    this._stuckT += dt;
    if (this._stuckT > 1.5) {
      const moved = this.position.distanceTo(this._lastPos);
      this._lastPos.copy(this.position);
      this._stuckT = 0;
      if (moved < 0.3 && speed > 0.5) this.onStuck();
    }
    return this.pathDone;
  }

  onStuck() {
    // 다음 노드로 순간 보정 (드문 경우의 안전장치)
    if (this.path && this.pathIdx < this.path.length) {
      const n = this.game.world.nav.get(this.path[this.pathIdx]);
      this.position.set(n.x, n.y, n.z);
      this.segFrom.copy(this.position);
      this.pathIdx++;
    }
  }

  faceTowards(x, z) {
    this.targetYaw = Math.atan2(x - this.position.x, z - this.position.z);
  }

  // ------------------------------------------------------------------
  // 피해·사망 — 이벤트 발행 (2단계 페널티, 3·4단계 판단 통계가 구독)
  // ------------------------------------------------------------------
  takeDamage(info) {
    if (!this.alive) return;
    const dmg = info.amount;
    this.health -= dmg;
    const headshot = info.zone === 'head';
    const payload = {
      attacker: info.attacker,
      victim: this,
      trueFaction: this.trueFaction,
      apparentFaction: this.apparentFaction,
      zone: info.zone,
      headshot,
      damage: dmg,
      distance: info.distance,
      timeSinceFirstSeen: this.firstSeenAt != null ? this.game.time - this.firstSeenAt : null,
      position: info.point ? info.point.clone() : this.position.clone(),
      time: this.game.time,
    };
    this.lastDamage = payload;
    if (this.health <= 0) {
      this.die(info, payload);
      this.game.events.emit(Events.NPC_KILLED, payload);
    } else {
      // 피격 방향에 따라 움찔
      let side = 0;
      if (info.direction) {
        _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        side = Math.sign(_v.dot(info.direction)) || 1;
      }
      this.rig.onHit(side);
      this.onDamaged(info);
      this.game.events.emit(Events.NPC_DAMAGED, payload);
    }
  }

  onDamaged() {}

  die(info) {
    this.alive = false;
    this.dying = true;
    this.health = 0;
    this.deathT = 0;
    // 총알이 온 방향으로 넘어짐: 앞에서 맞으면 뒤로
    let dir = 1;
    if (info && info.direction) {
      _w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir = _w.dot(info.direction) < 0 ? 1 : -1;
    }
    this.rig.startDeath(dir);
    this.onDeath();
  }

  onDeath() {}

  // ------------------------------------------------------------------
  update(dt) {
    if (this.dying) {
      this.deathT += dt;
      const C = CONFIG.npc;
      if (this.deathT > C.corpseTime) {
        const t = (this.deathT - C.corpseTime) / C.sinkTime;
        this.root.position.y = this.position.y - t * 0.6;
        if (t >= 1) this.removed = true;
      }
      this.rig.animate(dt, {});
      return;
    }
    this.think(dt);
    // 회전 보간
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = CONFIG.npc.turnSpeed * dt;
    this.yaw += Math.abs(d) < turn ? d : Math.sign(d) * turn;
    // 자세 보간
    this.crouch += (this.crouchTarget - this.crouch) * Math.min(1, dt * 7);
    this.aim += (this.aimTarget - this.aim) * Math.min(1, dt * 6);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    this.rig.animate(dt, { speed: this.curSpeed, aim: this.aim, aimPitch: this.aimPitch, crouch: this.crouch });
  }

  think() {}

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.insignia.dispose();
    this.rig.dispose();
  }
}
