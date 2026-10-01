// 정적 지오메트리 병합기
// 상자·임의 지오메트리를 (청크, 재질) 단위로 하나의 BufferGeometry 로 합쳐 드로우콜을 줄인다.
// 동시에 충돌용 삼각형을 CollisionWorld(Octree) 에 등록한다.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

// 면 정의: 바깥 방향 법선, 면 위 u/v 축 (로컬 기준)
const FACES = {
  px: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  nx: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  py: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  ny: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  pz: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  nz: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
};
const FACE_KEYS = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

class Bucket {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.uv = [];
    this.inr = [];
    this.idx = [];
    this.count = 0;
  }
}

export class GeometryBatcher {
  constructor(materialSet, collision) {
    this.materials = materialSet.materials;
    this.info = materialSet.info;
    this.collision = collision;
    this.buckets = new Map();
    this.chunkSize = CONFIG.render.chunkSize;
    this.half = CONFIG.map.size / 2;
    this.chunksPerSide = Math.ceil(CONFIG.map.size / this.chunkSize);
    this.boxCount = 0;
  }

  _chunkKey(x, z) {
    const n = this.chunksPerSide;
    const cx = Math.min(n - 1, Math.max(0, Math.floor((x + this.half) / this.chunkSize)));
    const cz = Math.min(n - 1, Math.max(0, Math.floor((z + this.half) / this.chunkSize)));
    return cx + cz * n;
  }

  _bucket(chunk, mat) {
    const key = chunk + '|' + mat;
    let b = this.buckets.get(key);
    if (!b) {
      b = new Bucket();
      b.chunk = chunk;
      b.mat = mat;
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * 상자 추가
   * @param {object} o
   *  cx,cy,cz: 중심 / sx,sy,sz: 크기 / rotY: Y축 회전(라디안)
   *  mat: 모든 면 재질 키, faces: { px: 키|null, ... } 면별 재질(null 이면 면 생략)
   *  interior: 0~1 숫자 또는 { px: 값 ... } 면별 실내도
   *  collide: 충돌 등록 여부, surface: 표면 종류
   *  facade: { floorH } — facade UV 모드에서 사용
   */
  addBox(o) {
    const rotY = o.rotY || 0;
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const hx = o.sx / 2;
    const hy = o.sy / 2;
    const hz = o.sz / 2;
    const chunk = this._chunkKey(o.cx, o.cz);
    this.boxCount++;

    for (const fk of FACE_KEYS) {
      let mat = o.faces && fk in o.faces ? o.faces[fk] : o.mat;
      if (!mat) continue;
      const F = FACES[fk];
      const interior = typeof o.interior === 'object' && o.interior ? (o.interior[fk] ?? 0) : (o.interior || 0);
      const b = this._bucket(chunk, mat);
      const info = this.info[mat] || { uv: 'world', tile: 1 };

      // 면의 4 꼭짓점 (로컬)
      const n = F.n;
      const u = F.u;
      const v = F.v;
      const ext = [hx, hy, hz];
      const du = Math.abs(u[0]) * hx + Math.abs(u[1]) * hy + Math.abs(u[2]) * hz;
      const dv = Math.abs(v[0]) * hx + Math.abs(v[1]) * hy + Math.abs(v[2]) * hz;
      const cxL = n[0] * ext[0];
      const cyL = n[1] * ext[1];
      const czL = n[2] * ext[2];
      const corners = [
        [-1, -1], [1, -1], [1, 1], [-1, 1],
      ];
      const base = b.count;
      // 월드 법선
      const nwx = n[0] * cos + n[2] * sin;
      const nwz = -n[0] * sin + n[2] * cos;
      for (const [su, sv] of corners) {
        const lx = cxL + u[0] * du * su + v[0] * dv * sv;
        const ly = cyL + u[1] * du * su + v[1] * dv * sv;
        const lz = czL + u[2] * du * su + v[2] * dv * sv;
        const wx = o.cx + lx * cos + lz * sin;
        const wy = o.cy + ly;
        const wz = o.cz - lx * sin + lz * cos;
        b.pos.push(wx, wy, wz);
        b.nrm.push(nwx, n[1], nwz);
        // UV
        let U;
        let V;
        if (info.uv === 'facade' && fk !== 'py' && fk !== 'ny') {
          // 창문 베이 수를 정수로 맞춤 (아틀라스 4베이 × 4층)
          const faceW = du * 2;
          const bays = Math.max(1, Math.round(faceW / 3.0));
          U = ((su + 1) / 2) * bays / 4;
          const floorH = (o.facade && o.facade.floorH) || CONFIG.map.floorHeight;
          V = wy / (floorH * 4);
        } else if (info.uv === 'unit') {
          U = (su + 1) / 2;
          V = (sv + 1) / 2;
        } else {
          // 월드 좌표 기반 (회전 없는 상자는 벽 조각끼리 무늬가 이어짐)
          const uwx = u[0] * cos + u[2] * sin;
          const uwz = -u[0] * sin + u[2] * cos;
          const vwx = v[0] * cos + v[2] * sin;
          const vwz = -v[0] * sin + v[2] * cos;
          U = wx * uwx + wy * u[1] + wz * uwz;
          V = wx * vwx + wy * v[1] + wz * vwz;
        }
        b.uv.push(U, V);
        b.inr.push(interior);
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
      b.count += 4;
    }

    if (o.collide && this.collision) {
      this.collision.addBox(o.cx, o.cy, o.cz, o.sx, o.sy, o.sz, rotY, o.surface || 'concrete', o.cy - hy <= 0.02);
    }
  }

  // 축 정렬 상자를 최소/최대 좌표로 지정
  addAABB(minX, minY, minZ, maxX, maxY, maxZ, opts) {
    this.addBox({
      ...opts,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
      cz: (minZ + maxZ) / 2,
      sx: Math.max(0.001, maxX - minX),
      sy: Math.max(0.001, maxY - minY),
      sz: Math.max(0.001, maxZ - minZ),
    });
  }

  // 임의 지오메트리 병합 (matrix 로 월드 변환). uvScale: UV 배율
  addGeometry(mat, geometry, matrix, opts = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = g.attributes.position;
    let nrm = g.attributes.normal;
    if (!nrm) {
      g.computeVertexNormals();
      nrm = g.attributes.normal;
    }
    const uv = g.attributes.uv;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
    const center = new THREE.Vector3();
    if (!g.boundingSphere) g.computeBoundingSphere();
    center.copy(g.boundingSphere.center).applyMatrix4(matrix);
    const chunk = this._chunkKey(center.x, center.z);
    const b = this._bucket(chunk, mat);
    const p = new THREE.Vector3();
    const nn = new THREE.Vector3();
    const base = b.count;
    const interior = opts.interior || 0;
    const uvScale = opts.uvScale || 1;
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      nn.fromBufferAttribute(nrm, i).applyMatrix3(normalMatrix).normalize();
      b.pos.push(p.x, p.y, p.z);
      b.nrm.push(nn.x, nn.y, nn.z);
      if (opts.worldUV || !uv) {
        // 법선 주축에 따라 월드 평면 투영
        const ax = Math.abs(nn.x);
        const ay = Math.abs(nn.y);
        const az = Math.abs(nn.z);
        if (ay >= ax && ay >= az) b.uv.push(p.x * uvScale, p.z * uvScale);
        else if (ax >= az) b.uv.push(p.z * uvScale, p.y * uvScale);
        else b.uv.push(p.x * uvScale, p.y * uvScale);
      } else {
        b.uv.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale);
      }
      b.inr.push(interior);
    }
    for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    b.count += pos.count;

    if (opts.collide && this.collision) {
      this.collision.addGeometry(g, matrix, opts.surface || 'concrete');
    }
    if (g !== geometry) g.dispose();
  }

  // 수평 사각형(바닥 장식용, 충돌 없음)
  addFlatQuad(mat, minX, minZ, maxX, maxZ, y, interior = 0) {
    this.addBox({
      cx: (minX + maxX) / 2, cy: y, cz: (minZ + maxZ) / 2,
      sx: maxX - minX, sy: 0.001, sz: maxZ - minZ,
      faces: { py: mat, px: null, nx: null, ny: null, pz: null, nz: null },
      interior,
    });
  }

  build() {
    const group = new THREE.Group();
    group.name = 'StaticWorld';
    let tris = 0;
    for (const b of this.buckets.values()) {
      if (b.count === 0) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(b.nrm, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      geo.setAttribute('aInterior', new THREE.Float32BufferAttribute(b.inr, 1));
      geo.setIndex(b.count > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
      const mesh = new THREE.Mesh(geo, this.materials[b.mat]);
      const info = this.info[b.mat] || {};
      mesh.castShadow = info.castShadow !== false;
      mesh.receiveShadow = info.receiveShadow !== false;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      mesh.name = `chunk${b.chunk}:${b.mat}`;
      if (this.materials[b.mat].transparent) mesh.renderOrder = 1;
      group.add(mesh);
      tris += b.idx.length / 3;
    }
    this.triangleCount = tris;
    this.buckets.clear();
    return group;
  }
}
