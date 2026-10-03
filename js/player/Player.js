// 플레이어 — 포인터 락 시점, WASD 이동, 달리기·앉기·점프, Octree + Capsule 충돌, 시점 흔들림, 체력·회복
import * as THREE from 'three';
import { Capsule } from 'three/addons/math/Capsule.js';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';

const _v = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _wish = new THREE.Vector3();
const _tmpCap = new Capsule();
const _aimEuler = new THREE.Euler(0, 0, 0, 'YXZ');

export class Player {
  constructor(game) {
    this.game = game;
    const P = CONFIG.player;
    this.radius = P.radius;
    this.collider = new Capsule(new THREE.Vector3(0, P.radius, 0), new THREE.Vector3(0, P.standHeight - P.radius, 0), P.radius);
    this.velocity = new THREE.Vector3();
    this.onFloor = false;
    this.yaw = 0;
    this.pitch = 0;
    this.recoilPitch = 0;
    this.recoilYaw = 0;
    this.height = P.standHeight;
    this.crouching = false;
    this.sprinting = false;
    this.health = P.maxHealth;
    this.alive = true;
    this.lastHitTime = -100;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.shake = 0;
    this.speed = 0;
    this.eye = new THREE.Vector3();
    this.lastSafe = new THREE.Vector3();
    this.deathT = 0;
    this.flashlightOn = false;
    this.stepCount = 0;
  }

  get position() {
    return this.collider.start; // 캡슐 하단 구 중심 (발 + 반경)
  }

  get feet() {
    return _v.set(this.collider.start.x, this.collider.start.y - this.radius, this.collider.start.z);
  }

  reset(spawn, yaw = 0) {
    const P = CONFIG.player;
    this.collider.start.set(spawn.x, spawn.y + P.radius + 0.05, spawn.z);
    this.collider.end.set(spawn.x, spawn.y + P.standHeight - P.radius + 0.05, spawn.z);
    this.velocity.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.recoilPitch = this.recoilYaw = 0;
    this.height = P.standHeight;
    this.crouching = false;
    this.health = P.maxHealth;
    this.alive = true;
    this.lastHitTime = -100;
    this.shake = 0;
    this.deathT = 0;
    this.lastSafe.copy(this.collider.start);
    this.flashlightOn = false;
    // 5단계: 재시작 시 이동·흔들림 상태도 완전히 초기화
    this.sprinting = false;
    this.speed = 0;
    this.bobPhase = 0;
    this.bobAmount = 0;
    this.landDip = 0;
    this.onFloor = false;
  }

  // 위치만 옮김 (디버그·테스트용)
  teleport(x, y, z) {
    const h = this.collider.end.y - this.collider.start.y;
    this.collider.start.set(x, y + this.radius + 0.05, z);
    this.collider.end.set(x, y + this.radius + 0.05 + h, z);
    this.velocity.set(0, 0, 0);
    this.lastSafe.copy(this.collider.start);
  }

  addRecoil(pitchDeg, yawDeg) {
    this.recoilPitch += THREE.MathUtils.degToRad(pitchDeg);
    this.recoilYaw += THREE.MathUtils.degToRad(yawDeg);
  }

  addShake(a) {
    this.shake = Math.min(1, this.shake + a);
  }

  // 조준 방향 (반동 포함)
  getAimDirection(target) {
    _aimEuler.set(this.pitch + this.recoilPitch, this.yaw + this.recoilYaw, 0, 'YXZ');
    return target.set(0, 0, -1).applyEuler(_aimEuler);
  }

  takeDamage(amount, sourcePos, attacker) {
    if (!this.alive) return;
    this.health = Math.max(0, this.health - amount);
    this.lastHitTime = this.game.time;
    this.addShake(0.25);
    this.game.events.emit(Events.PLAYER_DAMAGED, { amount, health: this.health, sourcePosition: sourcePos ? sourcePos.clone() : null, attacker });
    if (this.health <= 0) {
      this.alive = false;
      this.deathT = 0;
      this.game.events.emit(Events.PLAYER_DIED, { attacker });
    }
  }

  update(dt, input, weapon) {
    const P = CONFIG.player;
    const game = this.game;

    if (!this.alive) {
      this.deathT += dt;
      this._updateCamera(dt);
      return;
    }

    // --- 시점 ---
    const ads = weapon ? weapon.adsT : 0;
    const obs = game.observation ? game.observation.t : 0; // 관찰 모드(확대) 중엔 감도·이동 속도 감소
    const adsMul = game.settings.adsSensitivity ?? P.adsSensitivityMul; // 5단계: 정조준 감도 설정
    const sens = P.baseSensitivity * game.settings.sensitivity * (1 - ads * (1 - adsMul)) * (1 - obs * (1 - CONFIG.observe.sensitivityMul));
    const m = input.consumeMouse();
    this.yaw -= m.x * sens;
    this.pitch -= m.y * sens;
    const lim = THREE.MathUtils.degToRad(88);
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
    this.lookDelta = m;

    // 반동 복귀 (연사 중엔 천천히, 멈추면 빠르게)
    const firing = weapon && weapon.timeSinceShot < 0.15;
    const rec = CONFIG.weapon.recoil.recovery * (firing ? 0.45 : 1);
    const k = Math.min(1, rec * dt);
    this.recoilPitch -= this.recoilPitch * k;
    this.recoilYaw -= this.recoilYaw * k;

    // --- 입력 ---
    _fwd.set(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    _right.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    _wish.set(0, 0, 0);
    if (input.isAction('forward')) _wish.add(_fwd);
    if (input.isAction('back')) _wish.sub(_fwd);
    if (input.isAction('right')) _wish.add(_right);
    if (input.isAction('left')) _wish.sub(_right);
    const moving = _wish.lengthSq() > 0;
    if (moving) _wish.normalize();

    if (input.wasAction('crouch')) this.crouching = !this.crouching;
    if (input.isAction('sprint') && this.crouching && moving) this.crouching = false; // 달리면 일어섬
    const wantSprint = input.isAction('sprint') && input.isAction('forward') && !this.crouching && ads < 0.2 && obs < 0.2 && !(weapon && weapon.timeSinceShot < 0.25);
    this.sprinting = wantSprint && this.onFloor;

    let speed = P.walkSpeed;
    if (this.sprinting) speed = P.sprintSpeed;
    if (this.crouching) speed = P.crouchSpeed;
    speed *= 1 - ads * (1 - P.adsSpeedMul);
    speed *= 1 - obs * (1 - CONFIG.observe.moveMul);

    if (input.wasAction('jump') && this.onFloor) {
      if (this.crouching) this.crouching = false;
      else {
        this.velocity.y = P.jumpSpeed;
        this.onFloor = false;
        this._jumped = true;
      }
    }
    if (input.wasAction('flashlight')) {
      this.flashlightOn = !this.flashlightOn;
      game.audio.dryFire();
    }

    // --- 앉기 높이 전환 (머리 위 공간 확인) ---
    const targetH = this.crouching ? P.crouchHeight : P.standHeight;
    if (targetH > this.height && !this._headroom(targetH)) this.crouching = true;
    else this.height += (targetH - this.height) * Math.min(1, P.crouchTransition * dt);
    this.collider.end.y = this.collider.start.y + this.height - this.radius * 2;

    // --- 물리 (하위 스텝) ---
    const steps = P.physicsSteps;
    const sdt = dt / steps;
    const wasOnFloor = this.onFloor;
    const vyBefore = this.velocity.y;
    for (let i = 0; i < steps; i++) {
      const accel = this.onFloor ? P.groundAccel : P.airAccel;
      const a = 1 - Math.exp(-accel * sdt);
      const tx = _wish.x * speed;
      const tz = _wish.z * speed;
      this.velocity.x += (tx - this.velocity.x) * a;
      this.velocity.z += (tz - this.velocity.z) * a;
      if (this.onFloor && !this._jumped) {
        this.velocity.y = -2.5; // 경사·계단을 내려갈 때 바닥에 붙어 있도록
      } else {
        this.velocity.y -= P.gravity * sdt;
      }
      this._jumped = false;
      _v.copy(this.velocity).multiplyScalar(sdt);
      this.collider.translate(_v);
      this._collide();
    }
    this._pushOutOfNPCs();

    // 착지
    if (!wasOnFloor && this.onFloor && vyBefore < -4) {
      this.landDip = Math.min(0.12, -vyBefore * 0.012);
      game.audio.footstep(null, { player: true, surface: 'concrete', volume: 1.4 });
    }

    // 맵 밖 낙하 안전장치
    if (this.collider.start.y < -6) {
      const d = _v.copy(this.lastSafe).sub(this.collider.start);
      this.collider.translate(d);
      this.velocity.set(0, 0, 0);
    } else if (this.onFloor) {
      this.lastSafe.copy(this.collider.start);
    }

    // --- 시점 흔들림·발소리 ---
    const hs = Math.hypot(this.velocity.x, this.velocity.z);
    this.speed = hs;
    if (this.onFloor && hs > 0.5) {
      const prev = this.bobPhase;
      this.bobPhase += (hs * dt) / P.bob.stepLength * Math.PI;
      if (Math.floor(prev / Math.PI) !== Math.floor(this.bobPhase / Math.PI)) {
        this.stepCount++;
        const indoor = game.world.isIndoors(this.collider.start);
        const surface = indoor ? 'concrete' : (this.stepCount % 3 === 0 ? 'rubble' : 'concrete');
        game.audio.footstep(null, { player: true, surface, volume: this.crouching ? 0.45 : this.sprinting ? 1.2 : 0.85, run: this.sprinting });
      }
      const amp = this.crouching ? P.bob.crouchAmp : this.sprinting ? P.bob.sprintAmp : P.bob.walkAmp;
      this.bobAmount += (amp * (1 - ads * 0.7) - this.bobAmount) * Math.min(1, 8 * dt);
    } else {
      this.bobAmount += (0 - this.bobAmount) * Math.min(1, 6 * dt);
    }

    // --- 체력 회복 ---
    if (game.time - this.lastHitTime > P.regenDelay && this.health < P.maxHealth) {
      this.health = Math.min(P.maxHealth, this.health + P.regenRate * dt);
    }

    this._updateCamera(dt);
  }

  _headroom(targetH) {
    _tmpCap.start.copy(this.collider.start);
    _tmpCap.end.copy(this.collider.start);
    _tmpCap.end.y += targetH - this.radius * 2;
    _tmpCap.start.y = this.collider.end.y + 0.05;
    if (_tmpCap.end.y <= _tmpCap.start.y) return true;
    _tmpCap.radius = this.radius * 0.95;
    const r = this.game.world.collision.capsuleIntersect(_tmpCap);
    return !r;
  }

  _collide() {
    const result = this.game.world.collision.capsuleIntersect(this.collider);
    this.onFloor = false;
    if (result) {
      this.onFloor = result.normal.y > 0.3;
      if (!this.onFloor) {
        this.velocity.addScaledVector(result.normal, -result.normal.dot(this.velocity));
      }
      if (result.depth >= 1e-10) this.collider.translate(result.normal.multiplyScalar(Math.min(result.depth, 0.5)));
    }
  }

  // NPC 와 겹치지 않게 수평으로 밀어냄
  _pushOutOfNPCs() {
    const npcs = this.game.npcs ? this.game.npcs.list : [];
    const p = this.collider.start;
    for (const n of npcs) {
      if (!n.alive) continue;
      const dy = n.position.y - (p.y - this.radius);
      if (Math.abs(dy) > 1.6) continue;
      const dx = p.x - n.position.x;
      const dz = p.z - n.position.z;
      const d = Math.hypot(dx, dz);
      const minD = this.radius + 0.32;
      if (d < minD && d > 1e-4) {
        const push = (minD - d) / d;
        this.collider.translate(_v.set(dx * push, 0, dz * push));
      }
    }
  }

  _updateCamera(dt) {
    const P = CONFIG.player;
    const cam = this.game.camera;
    const time = this.game.time;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    this.landDip += (0 - this.landDip) * Math.min(1, 10 * dt);

    // 5단계 접근성: '화면 흔들림 줄이기' — 피격·탄착 흔들림과 걸음 흔들림을 크게 줄임
    const calm = this.game.settings.reduceShake ? 0.3 : 1;
    const bobY = (Math.abs(Math.sin(this.bobPhase)) * this.bobAmount - this.bobAmount * 0.5) * calm;
    const bobX = Math.cos(this.bobPhase) * this.bobAmount * 0.6 * calm;
    const roll = Math.cos(this.bobPhase) * P.bob.roll * (this.bobAmount / P.bob.walkAmp) * calm;

    const eyeY = this.collider.end.y + this.radius - P.eyeOffset;
    this.eye.set(this.collider.end.x, eyeY, this.collider.end.z);

    const s2 = this.shake * this.shake * calm * calm;
    const sx = (Math.sin(time * 37) + Math.sin(time * 53)) * 0.012 * s2;
    const sy = (Math.sin(time * 41 + 1) + Math.sin(time * 61)) * 0.012 * s2;

    cam.position.copy(this.eye);
    cam.position.y += bobY - this.landDip;
    cam.position.x += Math.cos(this.yaw) * bobX;
    cam.position.z -= Math.sin(this.yaw) * bobX;

    let deathRoll = 0;
    let deathPitch = 0;
    if (!this.alive) {
      const t = Math.min(1, this.deathT / 1.1);
      const e = t * t * (3 - 2 * t);
      cam.position.y -= e * (eyeY - this.collider.start.y + this.radius - 0.25);
      deathRoll = e * 1.2;
      deathPitch = e * 0.3;
    }
    cam.rotation.order = 'YXZ';
    cam.rotation.set(this.pitch + this.recoilPitch + sy + deathPitch, this.yaw + this.recoilYaw + sx, roll + deathRoll);
    cam.updateMatrixWorld();
  }

  // 실내 여부 (그림 조명·소리 등에서 사용)
  isIndoors() {
    return this.game.world.isIndoors(this.collider.start);
  }
}

