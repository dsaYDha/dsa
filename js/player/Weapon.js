// 돌격소총 로직 — 히트스캔 연사, 탄창 30발, 재장전(중 사격 불가), 정조준, 반동, 탄퍼짐
// 3단계: 관찰 모드 중(총을 내림)과 다시 드는 0.3초 동안은 사격·정조준 불가
// v1.1: 맞히기 어렵게 — 허리 사격·이동·점프 퍼짐 확대, 연사 퍼짐(bloom)이 연사 중엔 회복되지 않고 쌓임,
//       연사할수록 세로 반동이 커지고(growth) 좌우로 흔들림(sway). 정조준 + 정지 + 짧은 점사만 정확
//       난이도 프리셋 handling 이 퍼짐·반동 증가 폭을 줄일 수 있음 (쉬움 = 절반 안팎)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { gameRand as R } from '../core/Random.js';

const _dir = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const HANDLING_NONE = { spreadMul: 1, bloomMul: 1, recoilGrowthMul: 1, swayMul: 1 };

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
    this.sprayN = 0; // 지금 연사의 몇 번째 발인지 (쉬는 동안 recoil.sprayDecay 만큼 줄어듦)
    this.swayPhase = 0;
  }

  // 난이도 프리셋의 무기 다루기 배율 (쉬움은 퍼짐·반동 증가가 절반 안팎)
  get handling() {
    const d = this.game.difficulty;
    return d ? d.handling : HANDLING_NONE;
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
    // 연사 중엔 프레임 경계로 잃는 시간을 다음 발로 넘기되(최대 한 발), 방아쇠를 놓고 있으면 쌓지 않음
    // (v1.1 수정: 예전엔 쉬는 동안 한 발 분량이 쌓여 클릭할 때마다 같은 프레임에 두 발이 나갔음)
    this.cooldown = Math.max(input.isFire() ? -this.interval : 0, this.cooldown - dt);

    const down = game.observation && game.observation.weaponDown;
    // 정조준
    const wantAds = input.isAim() && player.alive && !player.sprinting && !down;
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
    if (player.alive && input.isFire() && !this.reloading && !down) {
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

    // 탄퍼짐 회복 — 마지막 발사 뒤 bloomDelay 가 지나야 (연사 중엔 쌓이기만 한다)
    if (this.timeSinceShot > cfg.spread.bloomDelay) this.bloom = Math.max(0, this.bloom - cfg.spread.bloomRecovery * dt);
  }

  // 현재 탄퍼짐 (도) — 크로스헤어 크기에도 사용
  currentSpread(player) {
    const S = this.cfg.spread;
    const k = this.handling.spreadMul;
    const a = this.adsT;
    let s = S.hip * k + (S.ads - S.hip * k) * a;
    const moveFrac = Math.min(1, player.speed / CONFIG.player.walkSpeed);
    s += S.move * k * moveFrac * (1 - a * (1 - S.adsMoveMul));
    if (player.sprinting) s += S.sprint * k;
    if (!player.onFloor) s += S.air * k;
    if (player.crouching) s *= S.crouchMul;
    s += this.bloom * (1 - a * (1 - S.adsBloomMul));
    return s;
  }

  fire(player) {
    const cfg = this.cfg;
    const game = this.game;
    this.ammo--;
    this.shotsFired++;
    // 연사 발수 — 쉬는 만큼(연사 간격을 넘는 시간) 줄어든다: 끊어 쏘면 반동이 쌓이지 않고, 길게 당기면 계속 커짐
    const gap = Math.max(0, this.timeSinceShot - this.interval * 1.15);
    this.sprayN = Math.max(0, this.sprayN - gap * cfg.recoil.sprayDecay);
    if (this.sprayN < 1) this.swayPhase = R.range(0, Math.PI * 2);
    this.sprayN += 1;
    this.timeSinceShot = 0;

    // 탄퍼짐 원뿔 안 무작위 방향 — centerBias 만큼 가운데로 몰림 (0 이면 원 안 균등)
    const spread = THREE.MathUtils.degToRad(this.currentSpread(player));
    player.getAimDirection(_dir);
    _right.set(1, 0, 0).applyQuaternion(game.camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(game.camera.quaternion);
    const r = Math.tan(spread) * Math.sqrt(R.next()) * (1 - cfg.spread.centerBias * R.next());
    const a = R.next() * Math.PI * 2;
    _dir.addScaledVector(_right, Math.cos(a) * r).addScaledVector(_up, Math.sin(a) * r).normalize();

    const origin = game.camera.position.clone();
    const result = game.combat.playerShot(origin, _dir.clone());
    if (result.npc) this.shotsHit++;

    // 반동 — 연사할수록 세로 반동이 커지고(growth), swayFrom 발부터 좌우로 흔들림(sway, 점점 커짐)
    const rc = cfg.recoil;
    const h = this.handling;
    const mul = (1 - this.adsT * (1 - rc.adsMul)) * (player.crouching ? rc.crouchMul : 1);
    const n = Math.min(Math.max(0, this.sprayN - 1), rc.sprayCap);
    const pitch = rc.pitch * (1 + rc.growth * h.recoilGrowthMul * n);
    const swayK = Math.min(1, Math.max(0, (this.sprayN - rc.swayFrom + 1) / 4));
    const sway = rc.sway * h.swayMul * swayK * Math.sin(this.sprayN * 0.85 + this.swayPhase);
    player.addRecoil(pitch * mul * R.range(0.85, 1.15), (rc.yaw * R.range(-1, 1) + sway) * mul);
    this.bloom = Math.min(cfg.spread.bloomMax, this.bloom + cfg.spread.bloomPerShot * h.bloomMul);

    // 연출
    game.audio.playerGunshot();
    game.weaponView.onFire();
    game.weaponView.getMuzzleWorld(_muzzle);
    game.effects.playerMuzzleLight(_muzzle);
    if (R.chance(0.6)) game.effects.muzzleSmoke(_muzzle, _dir, 1);
    if (this.shotsFired % cfg.tracerEvery === 0) game.effects.tracer(_muzzle, result.point, false);
    game.events.emit(Events.WEAPON_FIRED, { shooter: 'player', isPlayer: true, position: origin, direction: _dir.clone() });
  }
}
