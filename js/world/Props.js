// 소품 — 불탄 차량, 모래주머니, 바리케이드, 잔해 더미, 포탄 구덩이, 가로등 등
// 반복 오브젝트(모래주머니·잔해 조각)는 InstancedMesh, 나머지는 정적 병합
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

function withInterior(geo) {
  const n = geo.attributes.position.count;
  geo.setAttribute('aInterior', new THREE.Float32BufferAttribute(new Float32Array(n), 1));
  return geo;
}

// 모래주머니 한 개: 가운데가 부푼 상자
function sandbagGeometry() {
  const g = new THREE.BoxGeometry(0.5, 0.17, 0.4, 3, 1, 3);
  const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = pos.getY(i);
    const bulge = (1 - Math.abs(x) / 0.25) * 0.04 + (1 - Math.abs(z) / 0.2) * 0.02;
    pos.setY(i, y * (1 + bulge * 3));
    pos.setX(i, x * (1 - Math.abs(y) * 0.6));
    pos.setZ(i, z * (1 - Math.abs(y) * 0.8));
  }
  g.computeVertexNormals();
  return withInterior(g);
}

// 차량 측면 윤곽 압출
function extrudeProfile(points, depth) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false });
  g.translate(0, 0, -depth / 2);
  return g;
}

export class PropBuilder {
  constructor(ctx, materials) {
    this.ctx = ctx;
    this.materials = materials;
    this.sandbags = [];
    this.debris = [];
    this.planks = [];
    this.wires = [];
    this.fires = [];
    this.lampLights = [];

    this.carBody = extrudeProfile([[-2.1, 0.32], [2.1, 0.32], [2.17, 0.6], [2.05, 0.86], [0.95, 0.94], [-1.4, 0.96], [-2.1, 0.9], [-2.17, 0.55]], 1.72);
    this.carCabin = extrudeProfile([[0.95, 0.92], [0.42, 1.38], [-0.85, 1.42], [-1.4, 0.94]], 1.52);
    this.wheel = new THREE.CylinderGeometry(0.33, 0.33, 0.22, 10).rotateX(Math.PI / 2);
    this.busBody = extrudeProfile([[-5, 0.4], [5, 0.4], [5.1, 0.9], [5.05, 2.9], [-5, 2.95], [-5.1, 0.8]], 2.45);
    this.jerseyGeo = (() => {
      const s = new THREE.Shape([new THREE.Vector2(-0.31, 0), new THREE.Vector2(0.31, 0), new THREE.Vector2(0.2, 0.32), new THREE.Vector2(0.11, 1.25), new THREE.Vector2(-0.11, 1.25), new THREE.Vector2(-0.2, 0.32)]);
      const g = new THREE.ExtrudeGeometry(s, { depth: 2.0, bevelEnabled: false });
      g.translate(0, 0, -1.0);
      g.rotateY(Math.PI / 2); // 길이 방향을 로컬 x 로
      return g;
    })();
    this.beam = new THREE.BoxGeometry(1.7, 0.13, 0.13);
    this.pole = new THREE.CylinderGeometry(0.08, 0.11, 6, 6);
    this.arm = new THREE.BoxGeometry(1.4, 0.08, 0.08);
  }

  _mat(x, y, z, rotY, rx = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    _e.set(rx, rotY, rz, 'YXZ');
    _q.setFromEuler(_e);
    return new THREE.Matrix4().compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
  }

  _cover(x, z, rotY, localX, localZ, dirX, dirZ, kind) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const wx = x + localX * c + localZ * s;
    const wz = z - localX * s + localZ * c;
    const dx = dirX * c + dirZ * s;
    const dz = -dirX * s + dirZ * c;
    this.ctx.coverSpots.push({ x: wx, z: wz, dir: { x: dx, z: dz }, kind });
  }

  // ------------------------------------------------------------------
  car(x, z, rotY, opts = {}) {
    const { batcher, occupancy, rng } = this.ctx;
    const sink = opts.noWheels ? -0.22 : 0;
    const m = this._mat(x, sink, z, rotY);
    batcher.addGeometry('metal', this.carBody, m, { worldUV: true, uvScale: 1 });
    batcher.addGeometry('char', this.carCabin, m, { worldUV: true });
    if (!opts.noWheels) {
      for (const [wx, wz] of [[1.35, 0.78], [-1.35, 0.78], [1.35, -0.78], [-1.35, -0.78]]) {
        const c = Math.cos(rotY);
        const s = Math.sin(rotY);
        batcher.addGeometry('char', this.wheel, this._mat(x + wx * c + wz * s, 0.33, z - wx * s + wz * c, rotY), {});
      }
    }
    // 충돌: 차체 + 지붕
    batcher.collision.addBox(x, (0.95 + sink) / 2, z, 4.3, 0.95 + sink, 1.74, rotY, 'metal', true);
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    batcher.collision.addBox(x - 0.2 * c, 1.17 + sink, z + 0.2 * s, 2.3, 0.5, 1.52, rotY, 'metal');
    occupancy.markRect(x, z, 4.3, 1.75, rotY, CONFIG.map.agentRadius);
    this._cover(x, z, rotY, 0.9, 1.65, 0, -1, 'car');
    this._cover(x, z, rotY, -0.9, 1.65, 0, -1, 'car');
    this._cover(x, z, rotY, 0.9, -1.65, 0, 1, 'car');
    this._cover(x, z, rotY, -0.9, -1.65, 0, 1, 'car');
    if (opts.burning) this.fires.push({ x, y: 1.0 + sink, z, size: rng.range(0.9, 1.4), smoke: rng.chance(0.6), kind: 'car' });
  }

  bus(x, z, rotY) {
    const { batcher, occupancy } = this.ctx;
    const m = this._mat(x, -0.15, z, rotY);
    batcher.addGeometry('metal', this.busBody, m, { worldUV: true });
    batcher.collision.addBox(x, 1.4, z, 10.2, 2.8, 2.5, rotY, 'metal', true);
    occupancy.markRect(x, z, 10.2, 2.5, rotY, CONFIG.map.agentRadius);
    this._cover(x, z, rotY, 2.5, 2.0, 0, -1, 'car');
    this._cover(x, z, rotY, -2.5, 2.0, 0, -1, 'car');
    this._cover(x, z, rotY, 2.5, -2.0, 0, 1, 'car');
    this._cover(x, z, rotY, -2.5, -2.0, 0, 1, 'car');
  }

  container(x, z, rotY) {
    const { batcher, occupancy } = this.ctx;
    batcher.addBox({ cx: x, cy: 1.25, cz: z, sx: 6.0, sy: 2.5, sz: 2.4, rotY, mat: 'metal', collide: true, surface: 'metal' });
    occupancy.markRect(x, z, 6.0, 2.4, rotY, CONFIG.map.agentRadius);
  }

  // ------------------------------------------------------------------
  // 8단 ≈ 1.32m: 웅크린 적의 머리 끝(≈1.15m)이 완전히 가려지는 높이
  sandbagWall(x, z, rotY, L, rows = 8, cover = true) {
    const { batcher, occupancy, rng } = this.ctx;
    const bagL = 0.48;
    const bagH = 0.165;
    const n = Math.max(2, Math.round(L / bagL));
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bagL / 2 : 0;
      const count = r % 2 ? n - 1 : n;
      for (let i = 0; i < count; i++) {
        const lx = -L / 2 + bagL / 2 + i * bagL + off;
        const ly = bagH / 2 + r * bagH;
        const jit = rng.range(-0.04, 0.04);
        this.sandbags.push(this._mat(x + lx * c + jit * s, ly, z - lx * s + jit * c, rotY + rng.range(-0.08, 0.08), 0, rng.range(-0.05, 0.05), rng.range(0.92, 1.05), 1, rng.range(0.95, 1.05)));
      }
    }
    const h = rows * bagH;
    batcher.collision.addBox(x, h / 2, z, L, h, 0.42, rotY, 'sand', true);
    occupancy.markRect(x, z, L, 0.45, rotY, CONFIG.map.agentRadius);
    if (cover && h > 1.2) {
      const k = Math.max(1, Math.round(L / 1.8));
      for (let i = 0; i < k; i++) {
        const lx = -L / 2 + (L / k) * (i + 0.5);
        this._cover(x, z, rotY, lx, 0.95, 0, -1, 'sandbag');
        this._cover(x, z, rotY, lx, -0.95, 0, 1, 'sandbag');
      }
    }
  }

  // ㄷ자 모래주머니 진지
  sandbagNest(x, z, rotY) {
    const c = Math.cos(rotY);
    const s = Math.sin(rotY);
    const at = (lx, lz) => [x + lx * c + lz * s, z - lx * s + lz * c];
    let [px, pz] = at(0, -1.5);
    this.sandbagWall(px, pz, rotY, 3.4);
    [px, pz] = at(-1.75, 0);
    this.sandbagWall(px, pz, rotY + Math.PI / 2, 2.4);
    [px, pz] = at(1.75, 0);
    this.sandbagWall(px, pz, rotY + Math.PI / 2, 2.4);
  }

  jersey(x, z, rotY) {
    const { batcher, occupancy } = this.ctx;
    batcher.addGeometry('concrete', this.jerseyGeo, this._mat(x, 0, z, rotY), { worldUV: true, collide: false });
    batcher.collision.addBox(x, 0.625, z, 2.0, 1.25, 0.62, rotY, 'concrete', true);
    occupancy.markRect(x, z, 2.0, 0.62, rotY, CONFIG.map.agentRadius);
    this._cover(x, z, rotY, 0, 0.95, 0, -1, 'barrier');
    this._cover(x, z, rotY, 0, -0.95, 0, 1, 'barrier');
  }

  hedgehog(x, z, rotY) {
    const { batcher, occupancy } = this.ctx;
    const rots = [[0, 0, 0.62], [0, Math.PI / 2, -0.62], [0.62, Math.PI / 4, 0]];
    for (const [rx, ry, rz] of rots) {
      batcher.addGeometry('metal', this.beam, this._mat(x, 0.55, z, rotY + ry, rx, rz), { worldUV: true });
    }
    batcher.collision.addBox(x, 0.5, z, 1.1, 1.0, 1.1, rotY, 'metal', true);
    occupancy.markRect(x, z, 1.2, 1.2, rotY, CONFIG.map.agentRadius);
  }

  crates(x, z, rotY) {
    const { batcher, occupancy, rng } = this.ctx;
    const s = rng.range(1.0, 1.2);
    batcher.addBox({ cx: x, cy: s / 2, cz: z, sx: s, sy: s, sz: s, rotY, mat: 'wood', collide: true, surface: 'wood' });
    const stacked = rng.chance(0.55);
    if (stacked) {
      const s2 = s * 0.8;
      batcher.addBox({ cx: x + rng.range(-0.1, 0.1), cy: s + s2 / 2, cz: z, sx: s2, sy: s2, sz: s2, rotY: rotY + rng.range(-0.4, 0.4), mat: 'wood', collide: true, surface: 'wood' });
    }
    occupancy.markRect(x, z, s, s, rotY, CONFIG.map.agentRadius);
    if (stacked) {
      this._cover(x, z, rotY, 0, s / 2 + 0.75, 0, -1, 'crate');
      this._cover(x, z, rotY, 0, -s / 2 - 0.75, 0, 1, 'crate');
    }
  }

  dumpster(x, z, rotY) {
    const { batcher, occupancy } = this.ctx;
    batcher.addBox({ cx: x, cy: 0.65, cz: z, sx: 1.9, sy: 1.3, sz: 1.15, rotY, mat: 'metal', collide: true, surface: 'metal' });
    occupancy.markRect(x, z, 1.9, 1.15, rotY, CONFIG.map.agentRadius);
    this._cover(x, z, rotY, 0, 1.35, 0, -1, 'crate');
    this._cover(x, z, rotY, 0, -1.35, 0, 1, 'crate');
  }

  // ------------------------------------------------------------------
  // 잔해 더미: 노이즈를 준 원뿔형 지형 (올라설 수 있음)
  rubbleMound(ctx, cx, cz, radius, height, opts = {}) {
    const { batcher, rng, occupancy } = this.ctx;
    const rings = 4;
    const segs = 12;
    const verts = [[0, height, 0]];
    for (let r = 1; r <= rings; r++) {
      const t = r / rings;
      for (let s = 0; s < segs; s++) {
        const a = (s / segs) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const rr = radius * t * rng.range(0.82, 1.15);
        const h = r === rings ? 0 : height * (1 - t * t) * rng.range(0.75, 1.15);
        verts.push([Math.cos(a) * rr, h, Math.sin(a) * rr]);
      }
    }
    const idx = [];
    for (let s = 0; s < segs; s++) idx.push(0, 1 + ((s + 1) % segs), 1 + s);
    for (let r = 1; r < rings; r++) {
      const a0 = 1 + (r - 1) * segs;
      const b0 = 1 + r * segs;
      for (let s = 0; s < segs; s++) {
        const s1 = (s + 1) % segs;
        idx.push(a0 + s, a0 + s1, b0 + s1, a0 + s, b0 + s1, b0 + s);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts.flat(), 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    const m = this._mat(cx, 0, cz, rng.range(0, Math.PI * 2));
    batcher.addGeometry('rubble', g, m, { worldUV: true, collide: opts.collide !== false, surface: 'rubble' });
    if (opts.mark !== false) occupancy.markCircle(cx, cz, radius * 0.8 + CONFIG.map.agentRadius);
    // 주변에 큰 조각
    const chunks = Math.round(radius * 4);
    for (let i = 0; i < chunks; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = radius * rng.range(0.3, 1.25);
      this.debrisChunk(cx + Math.cos(a) * d, cz + Math.sin(a) * d, rng.range(0.25, 0.6), height * 0.3 * (1 - d / (radius * 1.3)));
    }
    if (opts.cover !== false && height > 1.25 && height < 2.4) {
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + rng.range(-0.3, 0.3);
        const d = radius * 0.8 + 0.9;
        this.ctx.coverSpots.push({ x: cx + Math.cos(a) * d, z: cz + Math.sin(a) * d, dir: { x: -Math.cos(a), z: -Math.sin(a) }, kind: 'rubble' });
      }
    }
    g.dispose();
  }

  rebar(ctx, cx, cz, r) {
    const { batcher, rng } = this.ctx;
    const bar = new THREE.BoxGeometry(0.03, 1.6, 0.03);
    for (let i = 0; i < rng.int(3, 7); i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, r * 0.7);
      batcher.addGeometry('char', bar, this._mat(cx + Math.cos(a) * d, 0.9, cz + Math.sin(a) * d, rng.range(0, 6), rng.range(-0.7, 0.7), rng.range(-0.7, 0.7)), {});
    }
    bar.dispose();
  }

  // 작은 파편 (인스턴스, 충돌 없음)
  debrisChunk(x, z, size, y = 0) {
    const { rng } = this.ctx;
    this.debris.push(this._mat(x, Math.max(0, y) + size * 0.25, z, rng.range(0, 6.28), rng.range(-0.5, 0.5), rng.range(-0.5, 0.5), size * rng.range(0.7, 1.4), size * rng.range(0.4, 0.8), size * rng.range(0.7, 1.3)));
  }

  plank(x, z, rotY) {
    const { rng } = this.ctx;
    this.planks.push(this._mat(x, 0.03, z, rotY, 0, rng.range(-0.1, 0.1), rng.range(0.8, 1.4), 1, 1));
  }

  // 포탄 구덩이: 그을린 자국 + 둘레 파편
  crater(x, z, r) {
    const { batcher, rng } = this.ctx;
    batcher.addBox({ cx: x, cy: 0.035, cz: z, sx: r * 2.6, sy: 0.001, sz: r * 2.6, rotY: rng.range(0, 6), faces: { py: 'scorch', px: null, nx: null, pz: null, nz: null, ny: null } });
    const n = Math.round(r * 7);
    for (let i = 0; i < n; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = r * rng.range(0.85, 1.25);
      this.debrisChunk(x + Math.cos(a) * d, z + Math.sin(a) * d, rng.range(0.15, 0.45));
    }
  }

  lampPost(x, z, rotY, state) {
    const { batcher, occupancy } = this.ctx;
    if (state === 'fallen') {
      batcher.addGeometry('metal', this.pole, this._mat(x + Math.cos(rotY) * 3, 0.12, z - Math.sin(rotY) * 3, rotY, 0, Math.PI / 2 - 0.04), { worldUV: true });
      return;
    }
    const tilt = state === 'bent' ? 0.35 : 0;
    const m = this._mat(x, 3, z, rotY, tilt, 0);
    batcher.addGeometry('metal', this.pole, m, { worldUV: true });
    if (!tilt) {
      batcher.addGeometry('metal', this.arm, this._mat(x + Math.cos(rotY) * 0.6, 5.95, z - Math.sin(rotY) * 0.6, rotY), { worldUV: true });
      batcher.collision.addBox(x, 3, z, 0.22, 6, 0.22, 0, 'metal', true);
      occupancy.markRect(x, z, 0.3, 0.3, 0, 0.2);
    }
  }

  utilityPole(x, z) {
    const { batcher, occupancy } = this.ctx;
    const g = new THREE.CylinderGeometry(0.12, 0.16, 8.5, 6);
    batcher.addGeometry('wood', g, this._mat(x, 4.25, z, 0), { worldUV: true });
    batcher.addGeometry('wood', new THREE.BoxGeometry(1.6, 0.1, 0.1), this._mat(x, 7.9, z, 0), { worldUV: true });
    batcher.collision.addBox(x, 4.25, z, 0.3, 8.5, 0.3, 0, 'wood', true);
    occupancy.markRect(x, z, 0.35, 0.35, 0, 0.2);
    g.dispose();
    return [x, 7.9, z];
  }

  wire(a, b, sag, broken = false) {
    const pts = [];
    const n = 10;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (broken && t > 0.55) break;
      const y = a[1] + (b[1] - a[1]) * t - Math.sin(t * Math.PI) * sag - (broken ? t * t * 6 : 0);
      pts.push(a[0] + (b[0] - a[0]) * t, y, a[2] + (b[2] - a[2]) * t);
    }
    for (let i = 0; i + 5 < pts.length; i += 3) this.wires.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3], pts[i + 4], pts[i + 5]);
  }

  fire(x, y, z, size, smoke, kind = 'debris') {
    this.fires.push({ x, y, z, size, smoke, kind });
  }

  // ------------------------------------------------------------------
  // 인스턴스 메시 생성
  finalize(group) {
    const M = this.materials;
    const mk = (geo, mat, list, castShadow = true) => {
      if (!list.length) return;
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      for (let i = 0; i < list.length; i++) im.setMatrixAt(i, list[i]);
      im.instanceMatrix.needsUpdate = true;
      im.castShadow = castShadow;
      im.receiveShadow = true;
      im.computeBoundingSphere();
      group.add(im);
    };
    const bagMat = M.sandbagSolid;
    mk(sandbagGeometry(), bagMat, this.sandbags);
    mk(withInterior(new THREE.DodecahedronGeometry(0.5, 0)), M.rubble, this.debris);
    mk(withInterior(new THREE.BoxGeometry(1.2, 0.04, 0.2)), M.wood, this.planks, false);
    if (this.wires.length) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(this.wires, 3));
      const lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0x16120f }));
      group.add(lines);
    }
  }
}
