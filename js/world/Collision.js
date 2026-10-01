// 충돌 월드 — three/addons 의 Octree + Capsule (공식 games_fps 방식)
// Octree 에는 정적 지형만 넣는다. 총알·시야 레이 판정은 거리 제한 순회로 빠르게 처리.
import * as THREE from 'three';
import { Octree } from 'three/addons/math/Octree.js';

const MAX_DEPTH = 9;
const MAX_TRIS = 10;
const MIN_HALF = 0.6;

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();

// 분할 깊이·최소 크기 제한을 둔 Octree (큰 삼각형이 많은 도시 지형용)
class CityOctree extends Octree {
  split(level) {
    if (!this.box) return this;
    const subTrees = [];
    const halfsize = _v2.copy(this.box.max).sub(this.box.min).multiplyScalar(0.5);
    for (let x = 0; x < 2; x++) {
      for (let y = 0; y < 2; y++) {
        for (let z = 0; z < 2; z++) {
          const box = new THREE.Box3();
          const v = _v1.set(x, y, z);
          box.min.copy(this.box.min).add(v.multiply(halfsize));
          box.max.copy(box.min).add(halfsize);
          subTrees.push(new CityOctree(box));
        }
      }
    }
    let triangle;
    while ((triangle = this.triangles.pop())) {
      for (let i = 0; i < subTrees.length; i++) {
        if (subTrees[i].box.intersectsTriangle(triangle)) subTrees[i].triangles.push(triangle);
      }
    }
    const canSplit = Math.max(halfsize.x, halfsize.z) > MIN_HALF;
    for (let i = 0; i < subTrees.length; i++) {
      const len = subTrees[i].triangles.length;
      if (len > MAX_TRIS && level < MAX_DEPTH && canSplit) subTrees[i].split(level + 1);
      if (len !== 0) this.subTrees.push(subTrees[i]);
    }
    return this;
  }
}

const _ray = new THREE.Ray();
const _hit = new THREE.Vector3();
const _boxHit = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

// 상자 8 꼭짓점 → 12 삼각형 (바깥 법선, CCW)
const BOX_FACES = [
  // [꼭짓점 인덱스 4개], 꼭짓점 비트: x(1) y(2) z(4)
  [1, 3, 7, 5], // +x
  [0, 4, 6, 2], // -x
  [2, 6, 7, 3], // +y
  [0, 1, 5, 4], // -y
  [4, 5, 7, 6], // +z
  [0, 2, 3, 1], // -z
];

export class CollisionWorld {
  constructor() {
    this.octree = new CityOctree();
    this.triCount = 0;
    this.built = false;
  }

  addTriangle(a, b, c, surface) {
    const t = new THREE.Triangle(a.clone(), b.clone(), c.clone());
    if (t.getArea() < 1e-6) return;
    t.surface = surface;
    t.normal = t.getNormal(new THREE.Vector3());
    this.octree.addTriangle(t);
    this.triCount++;
  }

  // 회전 가능한 상자 (rotY). skipBottom: 지면에 붙은 상자의 아랫면 생략
  addBox(cx, cy, cz, sx, sy, sz, rotY, surface, skipBottom = false) {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const pts = [];
    for (let i = 0; i < 8; i++) {
      const lx = (i & 1 ? 0.5 : -0.5) * sx;
      const ly = (i & 2 ? 0.5 : -0.5) * sy;
      const lz = (i & 4 ? 0.5 : -0.5) * sz;
      pts.push(new THREE.Vector3(cx + lx * cos + lz * sin, cy + ly, cz - lx * sin + lz * cos));
    }
    for (let f = 0; f < 6; f++) {
      if (skipBottom && f === 3) continue;
      const [i0, i1, i2, i3] = BOX_FACES[f];
      this.addTriangle(pts[i0], pts[i1], pts[i2], surface);
      this.addTriangle(pts[i0], pts[i2], pts[i3], surface);
    }
  }

  addGeometry(geometry, matrix, surface) {
    const pos = geometry.attributes.position;
    const index = geometry.index;
    const count = index ? index.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = index ? index.getX(i) : i;
      const i1 = index ? index.getX(i + 1) : i + 1;
      const i2 = index ? index.getX(i + 2) : i + 2;
      _a.fromBufferAttribute(pos, i0).applyMatrix4(matrix);
      _b.fromBufferAttribute(pos, i1).applyMatrix4(matrix);
      _c.fromBufferAttribute(pos, i2).applyMatrix4(matrix);
      this.addTriangle(_a, _b, _c, surface);
    }
  }

  // 바깥 방향을 지정한 사각형 (와인딩 자동 보정)
  addQuad(p0, p1, p2, p3, outward, surface) {
    _a.subVectors(p1, p0);
    _b.subVectors(p2, p0);
    _c.crossVectors(_a, _b);
    if (_c.dot(outward) >= 0) {
      this.addTriangle(p0, p1, p2, surface);
      this.addTriangle(p0, p2, p3, surface);
    } else {
      this.addTriangle(p0, p2, p1, surface);
      this.addTriangle(p0, p3, p2, surface);
    }
  }

  addTri(p0, p1, p2, outward, surface) {
    _a.subVectors(p1, p0);
    _b.subVectors(p2, p0);
    _c.crossVectors(_a, _b);
    if (_c.dot(outward) >= 0) this.addTriangle(p0, p1, p2, surface);
    else this.addTriangle(p0, p2, p1, surface);
  }

  build() {
    const t0 = performance.now();
    this.octree.build();
    this.built = true;
    this.buildMs = performance.now() - t0;
  }

  capsuleIntersect(capsule) {
    return this.octree.capsuleIntersect(capsule);
  }

  /**
   * 거리 제한 레이캐스트. 앞면만 판정(닫힌 상자 안에서 시작한 레이는 빠져나감)
   * @returns {null | {distance, point, normal, surface}}
   */
  raycast(origin, dir, maxDist, out) {
    _ray.origin.copy(origin);
    _ray.direction.copy(dir);
    let best = maxDist;
    let bestTri = null;
    const stack = [this.octree];
    while (stack.length) {
      const node = stack.pop();
      const subs = node.subTrees;
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        // 원점이 상자 안이면 진입 거리 0 (intersectBox 는 이 경우 출구 지점을 돌려줌)
        if (!sub.box.containsPoint(origin)) {
          const p = _ray.intersectBox(sub.box, _boxHit);
          if (!p || p.distanceToSquared(origin) > best * best) continue;
        }
        const tris = sub.triangles;
        if (tris.length > 0) {
          for (let j = 0; j < tris.length; j++) {
            const t = tris[j];
            const h = _ray.intersectTriangle(t.a, t.b, t.c, true, _hit);
            if (h) {
              const d = h.distanceTo(origin);
              if (d < best) {
                best = d;
                bestTri = t;
              }
            }
          }
        } else {
          stack.push(sub);
        }
      }
    }
    if (!bestTri) return null;
    const res = out || { point: new THREE.Vector3(), normal: new THREE.Vector3() };
    res.distance = best;
    res.point.copy(dir).multiplyScalar(best).add(origin);
    res.normal.copy(bestTri.normal);
    res.surface = bestTri.surface;
    return res;
  }

  // 두 점 사이가 막혀 있는지 (시야 판정용, 할당 없음)
  segmentBlocked(a, b) {
    const dir = _v1.subVectors(b, a);
    const len = dir.length();
    if (len < 1e-4) return false;
    dir.divideScalar(len);
    _ray.origin.copy(a);
    _ray.direction.copy(dir);
    const maxD2 = len * len;
    const stack = [this.octree];
    while (stack.length) {
      const node = stack.pop();
      const subs = node.subTrees;
      for (let i = 0; i < subs.length; i++) {
        const sub = subs[i];
        if (!sub.box.containsPoint(a)) {
          const p = _ray.intersectBox(sub.box, _boxHit);
          if (!p || p.distanceToSquared(a) > maxD2) continue;
        }
        const tris = sub.triangles;
        if (tris.length > 0) {
          for (let j = 0; j < tris.length; j++) {
            const t = tris[j];
            const h = _ray.intersectTriangle(t.a, t.b, t.c, true, _hit);
            if (h && h.distanceToSquared(a) < maxD2) return true;
          }
        } else {
          stack.push(sub);
        }
      }
    }
    return false;
  }

  // 아래로 레이를 쏴서 지면 높이 (없으면 null)
  groundHeight(x, y, z, maxDrop = 50) {
    const r = this.raycast(_a.set(x, y, z), _b.set(0, -1, 0), maxDrop);
    return r ? r.point.y : null;
  }
}

