// 전투 이펙트 — 피탄(먼지·불꽃 + 탄흔, 오브젝트 풀링), 예광탄, 피, 적 총구 화염, 플레이어 총구 섬광
import * as THREE from 'three';
import { ParticleSystem } from './Particles.js';
import { gameRand as R } from '../core/Random.js';

const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _z = new THREE.Vector3(0, 0, 1);
const _p = new THREE.Vector3();

const DUST = {
  concrete: [0.42, 0.4, 0.37],
  rubble: [0.4, 0.37, 0.33],
  dirt: [0.36, 0.3, 0.24],
  sand: [0.48, 0.42, 0.3],
  wood: [0.32, 0.22, 0.14],
  metal: [0.25, 0.24, 0.23],
};

export class Effects {
  constructor(scene, textures, fog) {
    this.scene = scene;
    this.dust = new ParticleSystem({ capacity: 500, texture: textures.smoke, fog, renderOrder: 5 });
    this.sparks = new ParticleSystem({ capacity: 400, texture: textures.spark, additive: true, fog, renderOrder: 6 });
    this.flashes = new ParticleSystem({ capacity: 60, texture: textures.muzzle, additive: true, fog, renderOrder: 6 });
    scene.add(this.dust.mesh, this.sparks.mesh, this.flashes.mesh);

    // 탄흔 데칼 풀
    this.decalCap = 180;
    const dg = new THREE.PlaneGeometry(1, 1);
    const dm = new THREE.MeshBasicMaterial({
      map: textures.bulletHole, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, color: 0xbbbbbb,
    });
    this.decals = new THREE.InstancedMesh(dg, dm, this.decalCap);
    this.decals.frustumCulled = false;
    this.decals.renderOrder = 1;
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.decalCap; i++) this.decals.setMatrixAt(i, _m);
    this.decals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.decalCursor = 0;
    scene.add(this.decals);

    // 예광탄 풀
    this.tracers = [];
    const tg = new THREE.BoxGeometry(0.022, 0.022, 1);
    tg.translate(0, 0, -0.5);
    const tm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.75, 0.4), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    const tmEnemy = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.0, 0.55, 0.3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 40; i++) {
      const mesh = new THREE.Mesh(tg, i % 2 ? tmEnemy : tm);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 6;
      scene.add(mesh);
      this.tracers.push({ mesh, active: false, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, travelled: 0, speed: 380 });
    }
    this.tracerCursor = 0;

    // 플레이어 총구 섬광 점광원 (항상 존재, 세기만 조절)
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 9, 2);
    scene.add(this.muzzleLight);
    this._muzzleT = 0;
  }

  impact(point, normal, surface = 'concrete', withDecal = true) {
    const col = DUST[surface] || DUST.concrete;
    const n = surface === 'metal' ? 2 : 4;
    for (let i = 0; i < n; i++) {
      this.dust.emit({
        x: point.x + normal.x * 0.05, y: point.y + normal.y * 0.05, z: point.z + normal.z * 0.05,
        vx: normal.x * R.range(0.6, 1.8) + R.range(-0.4, 0.4),
        vy: normal.y * R.range(0.6, 1.8) + R.range(0.0, 0.6),
        vz: normal.z * R.range(0.6, 1.8) + R.range(-0.4, 0.4),
        life: R.range(0.5, 1.1), size: R.range(0.12, 0.22), sizeEnd: R.range(0.5, 0.9),
        color: col, alpha: 0.7, fadeIn: 0.05, drag: 2.5, gravity: 0.4,
      });
    }
    const sparkN = surface === 'metal' ? R.int(6, 10) : surface === 'concrete' || surface === 'rubble' ? R.int(0, 3) : 0;
    for (let i = 0; i < sparkN; i++) {
      this.sparks.emit({
        x: point.x, y: point.y, z: point.z,
        vx: normal.x * 3 + R.range(-3, 3), vy: normal.y * 3 + R.range(-1, 3.5), vz: normal.z * 3 + R.range(-3, 3),
        life: R.range(0.12, 0.35), size: R.range(0.04, 0.07), sizeEnd: 0.01, color: [1, 0.75, 0.4], alpha: 1, fadeIn: 0.01, gravity: 9, drag: 0.5,
      });
    }
    // 튀는 파편 조각 (작은 어두운 입자)
    for (let i = 0; i < 3; i++) {
      this.dust.emit({
        x: point.x, y: point.y, z: point.z,
        vx: normal.x * 2.5 + R.range(-1.5, 1.5), vy: normal.y * 2 + R.range(0.5, 3), vz: normal.z * 2.5 + R.range(-1.5, 1.5),
        life: R.range(0.4, 0.7), size: 0.035, sizeEnd: 0.03, color: [col[0] * 0.5, col[1] * 0.5, col[2] * 0.5], alpha: 1, fadeIn: 0.01, gravity: 12, drag: 0.2,
      });
    }
    if (withDecal) this.addDecal(point, normal, R.range(0.09, 0.14));
  }

  addDecal(point, normal, size) {
    _p.copy(point).addScaledVector(normal, 0.012);
    _q.setFromUnitVectors(_z, normal);
    const spin = new THREE.Quaternion().setFromAxisAngle(_z, R.range(0, Math.PI * 2));
    _q.multiply(spin);
    _s.set(size, size, size);
    _m.compose(_p, _q, _s);
    this.decals.setMatrixAt(this.decalCursor, _m);
    this.decalCursor = (this.decalCursor + 1) % this.decalCap;
    this.decals.instanceMatrix.needsUpdate = true;
  }

  blood(point, dir) {
    for (let i = 0; i < 6; i++) {
      this.dust.emit({
        x: point.x, y: point.y, z: point.z,
        vx: dir.x * R.range(0.5, 2) + R.range(-0.6, 0.6), vy: R.range(-0.2, 1.2), vz: dir.z * R.range(0.5, 2) + R.range(-0.6, 0.6),
        life: R.range(0.25, 0.5), size: R.range(0.06, 0.12), sizeEnd: R.range(0.18, 0.3),
        color: [0.32, 0.03, 0.02], alpha: 0.8, fadeIn: 0.02, gravity: 5, drag: 2,
      });
    }
  }

  tracer(from, to, enemy = false) {
    // 짝수/홀수 인덱스로 아군/적 색 구분
    let t = null;
    for (let k = 0; k < this.tracers.length; k++) {
      const i = (this.tracerCursor + k) % this.tracers.length;
      if ((i % 2 === 1) === enemy && !this.tracers[i].active) {
        t = this.tracers[i];
        this.tracerCursor = (i + 1) % this.tracers.length;
        break;
      }
    }
    if (!t) return;
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 1.5) return;
    t.dir.divideScalar(t.dist);
    t.travelled = 0;
    t.active = true;
    t.speed = enemy ? 260 : 400;
    t.mesh.visible = true;
    t.mesh.position.copy(from);
    // 상자는 로컬 -z 로 뻗어 있으므로 +z 가 진행 방향을 보게 하면 꼬리가 뒤로 늘어진다
    t.mesh.lookAt(_p.copy(from).add(t.dir));
  }

  // 적 총구 화염 (빛 없이 스프라이트만)
  enemyMuzzle(pos, dir) {
    this.flashes.emit({ x: pos.x + dir.x * 0.1, y: pos.y + dir.y * 0.1, z: pos.z + dir.z * 0.1, life: 0.06, size: R.range(0.35, 0.5), sizeEnd: 0.2, color: [1, 0.8, 0.5], alpha: 1, fadeIn: 0.01 });
  }

  playerMuzzleLight(pos) {
    this.muzzleLight.position.copy(pos);
    this._muzzleT = 0.05;
  }

  update(dt, wind) {
    this.dust.update(dt, wind);
    this.sparks.update(dt, null);
    this.flashes.update(dt, null);
    for (const t of this.tracers) {
      if (!t.active) continue;
      t.travelled += t.speed * dt;
      const head = Math.min(t.travelled, t.dist);
      const tail = Math.max(0, t.travelled - 4.5);
      if (tail >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      t.mesh.position.copy(t.from).addScaledVector(t.dir, head);
      t.mesh.scale.set(1, 1, Math.max(0.05, head - tail));
    }
    if (this._muzzleT > 0) {
      this._muzzleT -= dt;
      this.muzzleLight.intensity = this._muzzleT > 0 ? 45 * R.range(0.7, 1.1) : 0;
    }
  }

  dispose() {
    const s = this.scene;
    s.remove(this.dust.mesh, this.sparks.mesh, this.flashes.mesh, this.decals, this.muzzleLight);
    for (const t of this.tracers) s.remove(t.mesh);
    this.decals.dispose();
  }

  clear() {
    this.dust.clear();
    this.sparks.clear();
    this.flashes.clear();
    for (const t of this.tracers) {
      t.active = false;
      t.mesh.visible = false;
    }
    _m.makeScale(0, 0, 0);
    for (let i = 0; i < this.decalCap; i++) this.decals.setMatrixAt(i, _m);
    this.decals.instanceMatrix.needsUpdate = true;
  }
}
