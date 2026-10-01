// 돌격소총 로직 — 히트스캔 연사, 탄창 30발, 재장전(중 사격 불가), 정조준, 반동, 탄퍼짐
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { gameRand as R } from '../core/Random.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();

export class Weapon {
  constructor(game) {
    this.game = game;
    this.cfg = CONFIG.weapon;
    this.interval = 60 / this.cfg.rpm;
    this.reset();
  }

  reset() {
    this.ammo = this.cfg.magSize;
    this.reloading = false;
    this.reloadT = 0;
    this._reloadStage = 0;
    this.adsT = 0;
    this.bloom = 0;
    this.cooldown = 0;
    this.timeSinceShot = 99;
    this.shotsFired = 0;
    this.shotsHit = 0;
  }

  get reloadProgress() {
    return this.reloading ? this.reloadT / this.cfg.reloadTime : 0;
  }

  startReload() {
    if (this.reloading || this.ammo >= this.cfg.magSize) return;
    this.reloading = true;
    this.reloadT = 0;
    this._reloadStage = 0;
    this.game.events.emit(Events.WEAPON_RELOAD, {});
  }

  update(dt, input, player) {
    const cfg = this.cfg;
    const game = this.game;
    this.timeSinceShot += dt;
    this.cooldown = Math.max(-this.interval, this.cooldown - dt);

    // 정조준
    const wantAds = input.isAim() && player.alive && !player.sprinting;
    const step = dt / cfg.adsTime;
    this.adsT = THREE.MathUtils.clamp(this.adsT + (wantAds ? step : -step), 0, 1);

    // 재장전
    if (input.wasAction('reload')) this.startReload();
    if (this.reloading) {
      this.reloadT += dt;
      const f = this.reloadT / cfg.reloadTime;
      if (this._reloadStage === 0 && f > 0.18) { game.audio.reload('out'); this._reloadStage = 1; }
      if (this._reloadStage === 1 && f > 0.58) { game.audio.reload('in'); this._reloadStage = 2; }
      if (this._reloadStage === 2 && f > 0.8) { game.audio.reload('bolt'); this._reloadStage = 3; }
      if (this.reloadT >= cfg.reloadTime) {
        this.reloading = false;
        this.ammo = cfg.magSize;
      }
    }

    // 사격
    if (player.alive && input.isFire() && !this.reloading) {
      if (this.ammo > 0) {
        while (this.cooldown <= 0 && this.ammo > 0) {
          this.fire(player);
          this.cooldown += this.interval;
        }
      } else if (input.wasFire()) {
        game.audio.dryFire();
        this.startReload();
      }
    }

    // 탄퍼짐 회복
    this.bloom = Math.max(0, this.bloom - cfg.spread.bloomRecovery * dt);
  }

  // 현재 탄퍼짐 (도) — 크로스헤어 크기에도 사용
  currentSpread(player) {
    const S = this.cfg.spread;
    const a = this.adsT;
    let s = S.hip + (S.ads - S.hip) * a;
    const moveFrac = Math.min(1, player.speed / CONFIG.player.walkSpeed);
    s += S.move * moveFrac * (1 - a * 0.75);
    if (player.sprinting) s += S.sprint;
    if (!player.onFloor) s += S.air;
    if (player.crouching) s *= S.crouchMul;
    s += this.bloom * (1 - a * (1 - S.adsBloomMul));
    return s;
  }

  fire(player) {
    const cfg = this.cfg;
    const game = this.game;
    this.ammo--;
    this.shotsFired++;
    this.timeSinceShot = 0;

    // 탄퍼짐 원뿔 안 무작위 방향 (가운데로 몰리는 분포)
    const spread = THREE.MathUtils.degToRad(this.currentSpread(player));
    player.getAimDirection(_dir);
    _right.set(1, 0, 0).applyQuaternion(game.camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(game.camera.quaternion);
    const r = Math.tan(spread) * Math.sqrt(R.next()) * (0.55 + 0.45 * R.next());
    const a = R.next() * Math.PI * 2;
    _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();

    const origin = game.camera.position.clone();
    const result = game.combat.playerShot(origin, _dir.clone());
    if (result.npc) this.shotsHit++;

    // 반동
    const rc = cfg.recoil;
    const mul = (1 - this.adsT * (1 - rc.adsMul)) * (player.crouching ? rc.crouchMul : 1);
    player.addRecoil(rc.pitch * mul * R.range(0.85, 1.15), rc.yaw * mul * R.range(-1, 1));
    this.bloom = Math.min(cfg.spread.bloomMax, this.bloom + cfg.spread.bloomPerShot);

    // 연출
    game.audio.playerGunshot();
    game.weaponView.onFire();
    game.weaponView.getMuzzleWorld(_muzzle);
    game.effects.playerMuzzleLight(_muzzle);
    if (this.shotsFired % cfg.tracerEvery === 0) game.effects.tracer(_muzzle, result.point, false);
    game.events.emit(Events.WEAPON_FIRED, { shooter: 'player', isPlayer: true, position: origin, direction: _dir.clone() });
  }
}
