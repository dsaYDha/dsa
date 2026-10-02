// 1인칭 총기 모델 — 별도 씬/카메라로 그려 벽에 파묻히지 않음
// 흔들림(이동·마우스), 반동, 정조준, 재장전, 달리기 자세 애니메이션, 관찰 모드(총을 내림)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { gameRand as R } from '../core/Random.js';

const SIGHT_Y = 0.066; // 가늠자·가늠쇠 윗선 높이 (총 로컬)
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();

export class WeaponView {
  constructor(game, textures) {
    this.game = game;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CONFIG.render.viewModelFov, 1, 0.01, 10);
    this.scene.add(this.camera);

    // 조명 (월드 조명과 동기화)
    this.hemi = new THREE.HemisphereLight(0xb3a49c, 0x3b3029, 2.2);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffa060, 1.6);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 2, 2);
    this.flashLight.position.set(0.05, -0.02, -0.75);
    this.camera.add(this.flashLight);
    this.torch = new THREE.PointLight(0xfff2dd, 0, 1.5, 2);
    this.torch.position.set(0.1, -0.05, -0.2);
    this.camera.add(this.torch);

    this.root = new THREE.Group(); // 카메라 기준 위치
    this.camera.add(this.root);
    this.gun = new THREE.Group();
    this.root.add(this.gun);
    this._build(textures);

    this.hip = new THREE.Vector3(0.15, -0.175, -0.43);
    this.adsPos = new THREE.Vector3(0, -SIGHT_Y, -0.3);
    this.sway = new THREE.Vector2();
    this.swayVel = new THREE.Vector2();
    this.kick = 0;
    this.kickRot = 0;
    this.kickSide = 0;
    this.flashT = 0;
    this.sprintT = 0;
    this.lowerT = 0;
    this.visible = true;
  }

  _build(textures) {
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.55, metalness: 0.6 });
    const metalDark = new THREE.MeshStandardMaterial({ color: 0x18191a, roughness: 0.6, metalness: 0.5 });
    const woodTex = textures.wood.clone();
    woodTex.needsUpdate = true;
    woodTex.repeat.set(0.5, 0.5);
    const wood = new THREE.MeshStandardMaterial({ color: 0x5e4634, map: woodTex, roughness: 0.8, metalness: 0 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x23211f, roughness: 0.9 });
    const sleeve = new THREE.MeshStandardMaterial({ color: CONFIG.factions.ally.uniform, roughness: 0.95 });
    const B = (w, h, d, mat, x, y, z, rx = 0, ry = 0, rz = 0, parent = this.gun) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, rz);
      parent.add(m);
      return m;
    };
    const Cy = (r, len, mat, x, y, z, parent = this.gun, seg = 10) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, seg), mat);
      m.rotation.x = Math.PI / 2;
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    // 본체
    B(0.052, 0.07, 0.36, metal, 0, 0, 0);
    B(0.046, 0.022, 0.3, metalDark, 0, 0.044, 0.01);
    B(0.012, 0.012, 0.06, metalDark, 0.032, 0.02, 0.05); // 장전 손잡이
    Cy(0.011, 0.38, metalDark, 0, 0.012, -0.36);
    Cy(0.017, 0.055, metalDark, 0, 0.012, -0.565);
    B(0.062, 0.062, 0.2, wood, 0, 0.0, -0.28); // 총열 덮개
    Cy(0.011, 0.17, metal, 0, 0.042, -0.29); // 가스관
    // 가늠쇠·가늠자
    B(0.007, 0.05, 0.008, metalDark, 0, 0.04, -0.505);
    B(0.03, 0.012, 0.012, metalDark, 0, 0.022, -0.505);
    B(0.009, 0.022, 0.03, metalDark, -0.011, SIGHT_Y - 0.011, -0.06);
    B(0.009, 0.022, 0.03, metalDark, 0.011, SIGHT_Y - 0.011, -0.06);
    // 손잡이·개머리판
    B(0.034, 0.1, 0.045, wood, 0, -0.075, 0.075, -0.32);
    B(0.044, 0.072, 0.27, wood, 0, -0.024, 0.31, 0.06);
    B(0.048, 0.1, 0.02, metalDark, 0, -0.03, 0.445);
    // 방아쇠울
    B(0.006, 0.006, 0.06, metalDark, 0, -0.045, 0.02);
    // 탄창 (재장전 애니메이션을 위해 별도 그룹)
    this.mag = new THREE.Group();
    this.mag.position.set(0, -0.035, -0.07);
    this.gun.add(this.mag);
    B(0.034, 0.11, 0.068, metal, 0, -0.05, 0, 0.12, 0, 0, this.mag);
    B(0.032, 0.1, 0.064, metal, 0, -0.14, -0.025, 0.4, 0, 0, this.mag);
    this.magHome = this.mag.position.clone();
    // 손·팔
    this.rightArm = new THREE.Group();
    this.gun.add(this.rightArm);
    B(0.055, 0.075, 0.09, glove, 0.005, -0.075, 0.08, -0.3, 0, 0, this.rightArm);
    B(0.085, 0.085, 0.38, sleeve, 0.05, -0.16, 0.27, -0.55, 0.15, 0, this.rightArm);
    this.leftArm = new THREE.Group();
    this.gun.add(this.leftArm);
    B(0.075, 0.05, 0.1, glove, -0.012, -0.035, -0.29, 0, 0, 0.25, this.leftArm);
    B(0.085, 0.085, 0.42, sleeve, -0.09, -0.15, -0.12, -0.42, -0.55, 0, this.leftArm);
    this.leftHome = this.leftArm.position.clone();

    // 총구 화염 (정면 + 측면 십자)
    const fm = new THREE.MeshBasicMaterial({ map: textures.muzzle, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffd9a0 });
    this.flash = new THREE.Group();
    this.flash.position.set(0, 0.012, -0.62);
    const f1 = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), fm);
    const f2 = new THREE.Mesh(new THREE.PlaneGeometry(0.14, 0.3), fm);
    f2.rotation.x = Math.PI / 2;
    f2.position.z = -0.06;
    const f3 = f2.clone();
    f3.rotation.set(Math.PI / 2, Math.PI / 2, 0);
    this.flash.add(f1, f2, f3);
    this.flash.visible = false;
    this.gun.add(this.flash);
    this.muzzleLocal = new THREE.Vector3(0, 0.012, -0.6);

    this.gun.traverse((o) => {
      if (o.isMesh) o.frustumCulled = false;
    });
  }

  setAspect(a) {
    this.camera.aspect = a;
    this.camera.updateProjectionMatrix();
  }

  onFire() {
    this.kick += 0.028;
    this.kickRot += 0.055;
    this.kickSide += R.range(-0.012, 0.012);
    this.flashT = 0.045;
    this.flash.rotation.z = R.range(0, Math.PI * 2);
    this.flash.scale.setScalar(R.range(0.8, 1.2));
  }

  // 총구의 월드 좌표 (예광탄·총구 섬광 위치)
  getMuzzleWorld(target) {
    this.gun.updateWorldMatrix(true, false);
    target.copy(this.muzzleLocal);
    this.gun.localToWorld(target); // 무기 카메라 공간(카메라는 원점, 회전 없음)
    // 무기 카메라 공간 → 메인 카메라 월드
    return target.applyMatrix4(this.game.camera.matrixWorld);
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    const w = game.weapon;
    const ads = w.adsT;
    const adsE = ads * ads * (3 - 2 * ads);

    // 마우스 흔들림 (스프링)
    const look = p.lookDelta || { x: 0, y: 0 };
    const k = 1 - adsE * 0.8;
    this.swayVel.x += (-look.x * 0.00006 * k - this.sway.x * 60) * dt;
    this.swayVel.y += (look.y * 0.00006 * k - this.sway.y * 60) * dt;
    this.swayVel.multiplyScalar(Math.exp(-12 * dt));
    this.sway.x += this.swayVel.x;
    this.sway.y += this.swayVel.y;
    this.sway.clampScalar(-0.04, 0.04);

    // 반동 복귀
    this.kick += (0 - this.kick) * Math.min(1, 16 * dt);
    this.kickRot += (0 - this.kickRot) * Math.min(1, 12 * dt);
    this.kickSide += (0 - this.kickSide) * Math.min(1, 10 * dt);

    // 달리기 자세
    this.sprintT += ((p.sprinting ? 1 : 0) - this.sprintT) * Math.min(1, 8 * dt);

    // 기본 위치 = 허리 ↔ 정조준
    const pos = _v.copy(this.hip).lerp(this.adsPos, adsE);
    // 이동 흔들림
    const bob = p.bobAmount * (1 - adsE * 0.85);
    pos.x += Math.cos(p.bobPhase) * bob * 0.35 + this.sway.x;
    pos.y += -Math.abs(Math.sin(p.bobPhase)) * bob * 0.45 + this.sway.y - (p.crouching ? 0.008 : 0);
    pos.z += this.kick;
    pos.x += this.kickSide * (1 - adsE * 0.6);
    // 달리기: 아래로 내리고 비틂
    pos.y -= this.sprintT * 0.05;
    pos.x -= this.sprintT * 0.03;

    let rx = this.kickRot * (1 - adsE * 0.5) - this.sprintT * 0.35;
    let ry = (1 - adsE) * 0.04 + this.sprintT * 0.6 + this.sway.x * 2;
    let rz = this.sprintT * 0.25 + this.sway.x * 1.5;

    // 재장전 애니메이션
    const rp = w.reloadProgress;
    this.mag.position.copy(this.magHome);
    this.mag.rotation.set(0, 0, 0);
    this.mag.visible = true;
    this.leftArm.position.copy(this.leftHome);
    if (w.reloading) {
      const tilt = Math.sin(Math.min(1, rp / 0.95) * Math.PI);
      rz += tilt * 0.55;
      rx += tilt * 0.18;
      pos.y -= tilt * 0.03;
      if (rp > 0.15 && rp < 0.6) {
        const t = (rp - 0.15) / 0.45;
        this.mag.position.y -= t * 0.35;
        this.mag.position.z += t * 0.05;
        this.mag.rotation.x = t * 0.6;
        this.mag.visible = t < 0.7;
        this.leftArm.position.y -= t * 0.25;
        this.leftArm.position.z += t * 0.15;
      } else if (rp >= 0.6 && rp < 0.8) {
        const t = 1 - (rp - 0.6) / 0.2;
        this.mag.position.y -= t * 0.18;
        this.mag.rotation.x = t * 0.3;
        this.leftArm.position.y -= t * 0.12;
        this.leftArm.position.z += t * 0.06;
      } else if (rp >= 0.8) {
        const t = Math.sin(((rp - 0.8) / 0.2) * Math.PI);
        pos.z += t * 0.02;
        rz += t * 0.1;
      }
    }

    // 관찰 모드: 총을 아래로 내림 (Q 를 떼면 0.3초에 걸쳐 다시 듦)
    const obs = game.observation;
    const lowerWant = obs && obs.active ? 1 : 0;
    const raise = CONFIG.observe.raiseTime;
    this.lowerT += (lowerWant - this.lowerT) * Math.min(1, dt * (lowerWant ? 14 : 1 / raise * 3.2));
    if (this.lowerT > 0.001) {
      const e = this.lowerT * this.lowerT * (3 - 2 * this.lowerT);
      pos.y -= e * 0.26;
      pos.x += e * 0.05;
      rx -= e * 0.75;
      rz += e * 0.35;
    }

    // 사망: 아래로 떨어짐
    if (!p.alive) {
      const t = Math.min(1, p.deathT / 0.8);
      pos.y -= t * 0.4;
      rx -= t * 0.8;
    }

    this.gun.position.copy(pos);
    this.gun.rotation.set(rx, ry, rz);

    // 총구 화염
    this.flashT -= dt;
    this.flash.visible = this.flashT > 0;
    this.flashLight.intensity = this.flashT > 0 ? 3.5 : 0;

    // 조명 동기화 (실내에서는 어둡게)
    const atmo = game.world.atmosphere;
    const indoor = atmo ? atmo.indoorFactor : 0;
    this.hemi.intensity = (atmo ? atmo.hemi.intensity : 2) * 0.75 * (1 - indoor * 0.5);
    this.sun.intensity = (atmo ? atmo.sun.intensity : 2) * 0.55 * (1 - indoor);
    if (atmo) {
      _q.copy(game.camera.quaternion).invert();
      this.sun.position.copy(atmo.sunDir).applyQuaternion(_q).multiplyScalar(5);
    }
    this.torch.intensity = p.flashlightOn ? 0.6 : 0;
    this.root.visible = this.visible;
  }

  render(renderer) {
    if (!this.visible) return;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
