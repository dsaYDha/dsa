// 건물 생성 — 진입 가능 건물(방·계단·창문), 진입 불가 건물, 무너진 건물
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const snap = (v, s = 0.1) => Math.round(v / s) * s;

// ---------------------------------------------------------------------
// 건물 로컬 좌표계 (u: 정면 폭 방향, v: 깊이 방향, v=0 이 정면/도로 쪽)
// rot: 0 정면이 -z, 1 정면이 +x, 2 정면이 +z, 3 정면이 -x
// ---------------------------------------------------------------------
export class LocalFrame {
  constructor(ox, oz, rot) {
    this.ox = ox;
    this.oz = oz;
    this.rot = rot;
    const U = [[1, 0], [0, 1], [-1, 0], [0, -1]][rot];
    const V = [[0, 1], [-1, 0], [0, -1], [1, 0]][rot];
    this.U = U;
    this.V = V;
  }

  toWorld(u, v) {
    return [this.ox + this.U[0] * u + this.V[0] * v, this.oz + this.U[1] * u + this.V[1] * v];
  }

  // 로컬 면 → 월드 면 키
  worldFace(lf) {
    if (lf === 'y+') return 'py';
    if (lf === 'y-') return 'ny';
    const sgn = lf[1] === '+' ? 1 : -1;
    const d = lf[0] === 'u' ? this.U : this.V;
    const dx = d[0] * sgn;
    const dz = d[1] * sgn;
    if (dx > 0) return 'px';
    if (dx < 0) return 'nx';
    if (dz > 0) return 'pz';
    return 'nz';
  }

  worldDir(lu, lv) {
    return [this.U[0] * lu + this.V[0] * lv, this.U[1] * lu + this.V[1] * lv];
  }

  // 로컬 축정렬 상자 → 월드 AABB
  aabb(u0, u1, v0, v1) {
    const [x0, z0] = this.toWorld(u0, v0);
    const [x1, z1] = this.toWorld(u1, v1);
    return [Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)];
  }

  box(batcher, u0, u1, y0, y1, v0, v1, o = {}) {
    if (u1 - u0 < 0.005 || v1 - v0 < 0.005 || y1 - y0 < 0.005) return;
    const [minX, minZ, maxX, maxZ] = this.aabb(u0, u1, v0, v1);
    const faces = {};
    const interior = {};
    const lfs = ['u+', 'u-', 'v+', 'v-', 'y+', 'y-'];
    for (const lf of lfs) {
      const wf = this.worldFace(lf);
      faces[wf] = o.faces && lf in o.faces ? o.faces[lf] : o.mat;
      interior[wf] = o.interior && typeof o.interior === 'object' ? (o.interior[lf] ?? o.interiorDefault ?? 0) : (o.interior || 0);
    }
    batcher.addAABB(minX, y0, minZ, maxX, y1, maxZ, {
      faces,
      interior,
      collide: o.collide !== false,
      surface: o.surface || 'concrete',
    });
  }
}

// ---------------------------------------------------------------------
// 개구부가 있는 벽
// axis: 'u' 면 u 방향으로 뻗는 벽(두께는 v), 'v' 면 v 방향
// openings: [{ a0, a1, b, t }] — b/t: 바닥에서 개구부 아래/위 높이
// ---------------------------------------------------------------------
function wall(F, batcher, w) {
  const { axis, a0, a1, t0, t1, y0, y1 } = w;
  const ops = (w.openings || []).filter((o) => o.a1 > a0 && o.a0 < a1).sort((p, q) => p.a0 - q.a0);
  const extF = w.extFace;
  const intF = w.intFace;
  const faces = {};
  const interior = {};
  for (const lf of ['u+', 'u-', 'v+', 'v-', 'y+', 'y-']) {
    faces[lf] = w.revealMat;
    interior[lf] = w.revealInterior ?? 0.5;
  }
  faces[extF] = w.extMat;
  faces[intF] = w.intMat;
  interior[extF] = w.extInterior ?? 0;
  interior[intF] = w.intInterior ?? 1;
  const opts = { faces, interior, surface: w.surface || 'concrete', collide: w.collide !== false };

  const piece = (p0, p1, q0, q1) => {
    if (axis === 'u') F.box(batcher, p0, p1, q0, q1, t0, t1, opts);
    else F.box(batcher, t0, t1, q0, q1, p0, p1, opts);
  };
  let cur = a0;
  for (const o of ops) {
    const oa0 = Math.max(a0, o.a0);
    const oa1 = Math.min(a1, o.a1);
    if (oa0 > cur) piece(cur, oa0, y0, y1);
    if (o.b > 0.001) piece(oa0, oa1, y0, y0 + o.b);
    if (y0 + o.t < y1 - 0.001) piece(oa0, oa1, y0 + o.t, y1);
    cur = Math.max(cur, oa1);
  }
  if (cur < a1) piece(cur, a1, y0, y1);
}

// 구간 안에 창문 배치 (blocked 구간은 피함)
function placeWindows(s0, s1, blocked, cfgW) {
  const out = [];
  const ww = cfgW.width;
  const len = s1 - s0;
  if (len < ww + 0.4) return out;
  const n = Math.max(1, Math.floor(len / cfgW.spacing));
  const step = len / n;
  for (let i = 0; i < n; i++) {
    const c = s0 + step * (i + 0.5);
    const a0 = c - ww / 2;
    const a1 = c + ww / 2;
    if (blocked.some(([b0, b1]) => a1 > b0 - 0.35 && a0 < b1 + 0.35)) continue;
    out.push({ a0, a1, c });
  }
  return out;
}

// 수직 사각형이 2D 사각형과 겹치는지 (로컬)
function segHitsRect(u0, v0, u1, v1, r) {
  const steps = 12;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const u = u0 + (u1 - u0) * t;
    const v = v0 + (v1 - v0) * t;
    if (u > r[0] && u < r[1] && v > r[2] && v < r[3]) return true;
  }
  return false;
}

// =====================================================================
// 진입 가능 건물
// =====================================================================
export function buildEnterable(ctx, spec) {
  const { batcher, collision, nav, rng } = ctx;
  const C = CONFIG.map;
  const T = C.wallThickness;
  const H = C.floorHeight;
  const ST = C.slabThickness;
  const PH = C.parapetHeight;
  const { W, D } = spec;
  const F = spec.floors;
  const roofAccess = spec.roofAccess;
  const Fr = new LocalFrame(spec.ox, spec.oz, spec.rot);
  const extMat = spec.facadeMat;
  const bid = spec.id;

  // --- 평면 배치 ---
  const laneW = C.stair.laneWidth;
  const run = C.stair.run;
  const land = C.stair.landing;
  const uA1 = W - T;
  const uA0 = uA1 - laneW;
  const uB0 = uA0 - laneW;
  const vb = D - T - land;
  const va = vb - run;
  const uSplit = snap(Math.min(uB0 - 2.2, W * rng.range(0.38, 0.46)));
  const vSplit = snap(D * rng.range(0.42, 0.55));
  const uCorr = (uSplit + uB0) / 2;
  const laneAc = (uA0 + uA1) / 2;
  const laneBc = (uB0 + uA0) / 2;
  const hallFrontV = (T + va - land) / 2;
  const hallFrontU = Math.min((uSplit + W - T) / 2, uB0 - 0.45);
  const vD1 = snap((T + vSplit) / 2);
  const vD2 = snap((vSplit + D - T) / 2);
  const hasP2 = rng.chance(0.6);
  const uD3 = snap((T + uSplit) / 2);
  const dw = C.door.width;
  const dh = C.door.height;
  const fdw = C.door.frontWidth;
  const uFD = snap(Math.min((uSplit + W - T) / 2, W - T - fdw / 2 - 0.5));
  const sideDoor = rng.weighted({ left: 0.45, back: 0.35, none: 0.2 });
  const winCfg = C.window;

  const building = {
    id: bid,
    kind: 'enterable',
    frame: Fr,
    W, D, floors: F, floorHeight: H,
    roofY: F * H,
    roofAccess,
    rooms: [],
    windowNodes: [],
    roofNodes: [],
    doorInsideNodes: [],
    doorOutsideNodes: [],
    roomNodes: [],
    stairTopRoof: null,
  };
  const [bx0, bz0, bx1, bz1] = Fr.aabb(0, W, 0, D);
  building.minX = bx0; building.maxX = bx1; building.minZ = bz0; building.maxZ = bz1;
  const [ix0, iz0, ix1, iz1] = Fr.aabb(T, W - T, T, D - T);
  building.inner = { minX: ix0, maxX: ix1, minZ: iz0, maxZ: iz1 };

  // --- 외벽 (층별, 개구부 포함) ---
  const windowsByFloor = [];
  for (let k = 0; k < F; k++) {
    const y0 = k * H;
    const y1 = (k + 1) * H + (k === F - 1 ? PH : 0); // 꼭대기 층 벽은 난간벽까지 연장
    const wins = [];
    const bigSill = k === 0 && rng.chance(0.4);
    const sill = bigSill ? 0.6 : winCfg.sill;
    const mk = (side, list, room) => {
      for (const w of list) wins.push({ side, a0: w.a0, a1: w.a1, c: w.c, b: sill, t: winCfg.top, room });
    };
    // 정면 (v=0)
    const frontBlocked = k === 0 ? [[uFD - fdw / 2, uFD + fdw / 2]] : [];
    mk('front', placeWindows(T + 0.3, uSplit - 0.3, [], winCfg), 'R0');
    mk('front', placeWindows(uSplit + 0.3, W - T - 0.3, frontBlocked, winCfg), 'H');
    // 뒷면 (v=D)
    const backBlocked = k === 0 && sideDoor === 'back' ? [[uD3 - dw / 2, uD3 + dw / 2]] : [];
    mk('back', placeWindows(T + 0.3, uSplit - 0.3, backBlocked, winCfg), 'R1');
    mk('back', placeWindows(uSplit + 0.3, uB0 - 0.3, [], winCfg), 'C');
    // 왼쪽 (u=0)
    const leftBlocked = k === 0 && sideDoor === 'left' ? [[vD2 - dw / 2, vD2 + dw / 2]] : [];
    mk('left', placeWindows(T + 0.3, vSplit - 0.3, [], winCfg), 'R0');
    mk('left', placeWindows(vSplit + 0.3, D - T - 0.3, leftBlocked, winCfg), 'R1');
    // 오른쪽 (u=W) — 계단실 앞쪽만
    mk('right', placeWindows(T + 0.3, va - land - 0.3, [], winCfg), 'H');
    windowsByFloor.push(wins);

    const ops = (side) => wins.filter((w) => w.side === side).map((w) => ({ a0: w.a0, a1: w.a1, b: w.b, t: w.t }));
    const frontOps = ops('front');
    const backOps = ops('back');
    const leftOps = ops('left');
    if (k === 0) {
      frontOps.push({ a0: uFD - fdw / 2, a1: uFD + fdw / 2, b: 0, t: C.door.frontHeight });
      if (sideDoor === 'back') backOps.push({ a0: uD3 - dw / 2, a1: uD3 + dw / 2, b: 0, t: dh });
      if (sideDoor === 'left') leftOps.push({ a0: vD2 - dw / 2, a1: vD2 + dw / 2, b: 0, t: dh });
    }
    const base = { extMat, intMat: 'interior', revealMat: 'reveal', y0, y1 };
    wall(Fr, batcher, { ...base, axis: 'u', a0: 0, a1: W, t0: 0, t1: T, extFace: 'v-', intFace: 'v+', openings: frontOps });
    wall(Fr, batcher, { ...base, axis: 'u', a0: 0, a1: W, t0: D - T, t1: D, extFace: 'v+', intFace: 'v-', openings: backOps });
    wall(Fr, batcher, { ...base, axis: 'v', a0: T, a1: D - T, t0: 0, t1: T, extFace: 'u-', intFace: 'u+', openings: leftOps });
    wall(Fr, batcher, { ...base, axis: 'v', a0: T, a1: D - T, t0: W - T, t1: W, extFace: 'u+', intFace: 'u-', openings: ops('right') });

    // 창턱 (바깥으로 살짝 돌출, 장식)
    for (const w of wins) {
      const sy = y0 + w.b;
      const o = { mat: 'reveal', collide: false };
      if (w.side === 'front') Fr.box(batcher, w.a0 - 0.08, w.a1 + 0.08, sy - 0.07, sy, -0.09, 0.02, o);
      else if (w.side === 'back') Fr.box(batcher, w.a0 - 0.08, w.a1 + 0.08, sy - 0.07, sy, D - 0.02, D + 0.09, o);
      else if (w.side === 'left') Fr.box(batcher, -0.09, 0.02, sy - 0.07, sy, w.a0 - 0.08, w.a1 + 0.08, o);
      else Fr.box(batcher, W - 0.02, W + 0.09, sy - 0.07, sy, w.a0 - 0.08, w.a1 + 0.08, o);
    }
  }
  // 난간벽 상단 갓돌
  Fr.box(batcher, -0.05, W + 0.05, F * H + PH, F * H + PH + 0.08, -0.05, D + 0.05, { mat: 'concrete', collide: false, faces: { 'y-': null } });

  // --- 바닥 슬래브 (k=1..F, F=옥상) + 계단 구멍 ---
  const laneRange = (L) => (L === 'A' ? [uA0, uA1] : [uB0, uA0]);
  const rampLane = (k) => (k % 2 === 0 ? 'A' : 'B');
  const lastRamp = roofAccess ? F - 1 : F - 2;
  for (let k = 1; k <= F; k++) {
    const y1 = k * H;
    const y0 = y1 - ST;
    const isRoof = k === F;
    const holeRamp = k - 1;
    const hasHole = holeRamp <= lastRamp;
    const top = isRoof ? 'roof' : 'floor';
    const so = {
      faces: { 'y+': top, 'y-': 'ceiling', 'u+': 'concrete', 'u-': 'concrete', 'v+': 'concrete', 'v-': 'concrete' },
      interior: { 'y+': isRoof ? 0 : 1, 'y-': 1, 'u+': 1, 'u-': 1, 'v+': 1, 'v-': 1 },
    };
    if (!hasHole) {
      Fr.box(batcher, T, W - T, y0, y1, T, D - T, so);
    } else {
      const [h0, h1] = laneRange(rampLane(holeRamp));
      Fr.box(batcher, T, W - T, y0, y1, T, va, so);
      Fr.box(batcher, T, W - T, y0, y1, vb, D - T, so);
      Fr.box(batcher, T, h0, y0, y1, va, vb, so);
      if (h1 < W - T - 0.01) Fr.box(batcher, h1, W - T, y0, y1, va, vb, so);
    }
  }
  // 1층 바닥 마감 (충돌 없음 — 지면 충돌 사용)
  {
    const [x0, z0, x1, z1] = Fr.aabb(T, W - T, T, D - T);
    batcher.addFlatQuad('floor', x0, z0, x1, z1, 0.02, 1);
  }

  // --- 계단 (충돌용 쐐기 + 보이는 계단) ---
  const steps = C.stair.steps;
  for (let k = 0; k <= lastRamp; k++) {
    const L = rampLane(k);
    const [lu0, lu1] = laneRange(L);
    const dir = L === 'A' ? 1 : -1;
    const vs = dir > 0 ? va : vb;
    const ve = dir > 0 ? vb : va;
    const y0 = k * H;
    const y1 = (k + 1) * H;
    const h = (y1 - y0) / steps;
    const r = run / steps;
    const so = { mat: 'concrete', faces: { 'y+': 'floor' }, interior: 1, collide: false };
    for (let i = 0; i < steps; i++) {
      const s0 = vs + dir * r * i;
      const s1 = vs + dir * r * (i + 1);
      const topY = y0 + (i + 0.5) * h;
      Fr.box(batcher, lu0 + 0.02, lu1 - 0.02, y0, topY, Math.min(s0, s1), Math.max(s0, s1), so);
    }
    // 쐐기 충돌 (경사면 + 끝면 + 양옆)
    const P = (u, y, v) => {
      const [x, z] = Fr.toWorld(u, v);
      return new THREE.Vector3(x, y, z);
    };
    const A0 = P(lu0, y0, vs);
    const A1 = P(lu1, y0, vs);
    const B0 = P(lu0, y0, ve);
    const B1 = P(lu1, y0, ve);
    const C0 = P(lu0, y1, ve);
    const C1 = P(lu1, y1, ve);
    const [rdx, rdz] = Fr.worldDir(0, dir);
    const [udx, udz] = Fr.worldDir(1, 0);
    collision.addQuad(A0, A1, C1, C0, new THREE.Vector3(-rdx * 0.3, 1, -rdz * 0.3), 'concrete');
    collision.addQuad(B0, B1, C1, C0, new THREE.Vector3(rdx, 0, rdz), 'concrete');
    collision.addTri(A0, B0, C0, new THREE.Vector3(-udx, 0, -udz), 'concrete');
    collision.addTri(A1, B1, C1, new THREE.Vector3(udx, 0, udz), 'concrete');
  }

  // --- 계단실 중앙벽 (층마다) ---
  for (let k = 0; k < F; k++) {
    Fr.box(batcher, uA0 - 0.08, uA0 + 0.08, k * H, (k + 1) * H - ST, va, vb, { mat: 'interior', interior: 1 });
  }
  // --- 구멍 난간 ---
  const railH = 1.0;
  const railO = { mat: 'concrete', interior: 1, surface: 'concrete' };
  for (let k = 1; k <= F; k++) {
    const holeRamp = k - 1;
    if (holeRamp > lastRamp) continue;
    const isRoof = k === F;
    const L = rampLane(holeRamp);
    const [h0, h1] = laneRange(L);
    const y = k * H;
    const ro = { ...railO, interior: isRoof ? 0 : 1 };
    const vStart = L === 'A' ? va : vb;
    // 시작 끝 (낙하 위험 쪽)
    Fr.box(batcher, h0, h1, y, y + railH, vStart - 0.05, vStart + 0.05, ro);
    if (L === 'B') Fr.box(batcher, uB0 - 0.05, uB0 + 0.05, y, y + railH, va, vb, ro);
    if (isRoof) Fr.box(batcher, uA0 - 0.05, uA0 + 0.05, y, y + railH, va, vb, ro);
  }

  // --- 칸막이벽 (층마다) ---
  for (let k = 0; k < F; k++) {
    const y0 = k * H;
    const y1 = (k + 1) * H - ST;
    const pb = { extMat: 'interior', intMat: 'interior', revealMat: 'interior', extInterior: 1, intInterior: 1, revealInterior: 1, y0, y1 };
    wall(Fr, batcher, {
      ...pb, axis: 'v', a0: T, a1: D - T, t0: uSplit - 0.1, t1: uSplit + 0.1, extFace: 'u-', intFace: 'u+',
      openings: [
        { a0: vD1 - dw / 2, a1: vD1 + dw / 2, b: 0, t: dh },
        { a0: vD2 - dw / 2, a1: vD2 + dw / 2, b: 0, t: dh },
      ],
    });
    wall(Fr, batcher, {
      ...pb, axis: 'u', a0: T, a1: uSplit - 0.1, t0: vSplit - 0.1, t1: vSplit + 0.1, extFace: 'v-', intFace: 'v+',
      openings: hasP2 ? [{ a0: uD3 - dw / 2, a1: uD3 + dw / 2, b: 0, t: dh }] : [],
    });
  }

  // --- 실내 가구 (엄폐용) ---
  const furn = [];
  for (let k = 0; k < F; k++) {
    for (const [ru0, ru1, rv0, rv1] of [[T, uSplit - 0.1, T, vSplit - 0.1], [T, uSplit - 0.1, vSplit + 0.1, D - T]]) {
      if (!rng.chance(0.75)) continue;
      const kind = rng.weighted({ table: 0.45, cabinet: 0.3, debris: 0.25 });
      const corners = [[ru0 + 0.9, rv0 + 0.9], [ru0 + 0.9, rv1 - 0.9], [ru1 - 0.9, rv0 + 0.9], [ru1 - 0.9, rv1 - 0.9]];
      const [cu, cv] = rng.pick(corners);
      // 문 근처면 생략
      const nearDoor = Math.abs(cu - uSplit) < 1.6 && (Math.abs(cv - vD1) < 1.6 || Math.abs(cv - vD2) < 1.6);
      if (nearDoor) continue;
      if (hasP2 && Math.abs(cv - vSplit) < 1.6 && Math.abs(cu - uD3) < 1.6) continue;
      const y0 = k * H;
      if (kind === 'table') {
        Fr.box(batcher, cu - 0.6, cu + 0.6, y0 + 0.7, y0 + 0.78, cv - 0.4, cv + 0.4, { mat: 'wood', interior: 1, surface: 'wood' });
        Fr.box(batcher, cu - 0.55, cu + 0.55, y0, y0 + 0.7, cv - 0.35, cv + 0.35, { mat: 'wood', interior: 1, surface: 'wood', faces: { 'y+': null } });
      } else if (kind === 'cabinet') {
        Fr.box(batcher, cu - 0.5, cu + 0.5, y0, y0 + 1.15, cv - 0.3, cv + 0.3, { mat: 'wood', interior: 1, surface: 'wood' });
      } else {
        Fr.box(batcher, cu - 0.6, cu + 0.6, y0, y0 + 0.55, cv - 0.5, cv + 0.5, { mat: 'rubble', interior: 1, surface: 'rubble' });
      }
      furn.push([k, cu, cv]);
    }
  }

  // 가구 위치 (민간인이 가구 옆에 웅크려 숨는 지점 계산용)
  building.furniture = furn.map(([k, cu, cv]) => {
    const [x, z] = Fr.toWorld(cu, cv);
    return { x, y: k * H, z, floor: k };
  });

  // --- 옥상 잡동사니 ---
  if (rng.chance(0.7)) {
    const y = F * H;
    const tu = W * 0.3;
    const tv = D * 0.62;
    Fr.box(batcher, tu - 0.6, tu + 0.6, y, y + 1.3, tv - 0.6, tv + 0.6, { mat: 'metal', surface: 'metal' });
  }

  // =================================================================
  // 내비 노드
  // =================================================================
  const toW = (u, v) => Fr.toWorld(u, v);
  const addN = (u, v, y, props) => {
    const [x, z] = toW(u, v);
    return nav.addNode({ x, y, z, indoor: true, buildingId: bid, ...props });
  };
  const outDir = (side) => {
    const m = { front: [0, -1], back: [0, 1], left: [-1, 0], right: [1, 0] }[side];
    const [x, z] = Fr.worldDir(m[0], m[1]);
    return { x, z };
  };
  const floorNodes = [];
  for (let k = 0; k <= F; k++) {
    const y = k * H;
    const fn = {};
    if (k < F) {
      fn.R0 = addN((T + uSplit) / 2, (T + vSplit) / 2, y, { type: 'room', floor: k, room: `${bid}-${k}-R0` });
      fn.R1 = addN((T + uSplit) / 2, (vSplit + D - T) / 2, y, { type: 'room', floor: k, room: `${bid}-${k}-R1` });
      fn.H = addN(hallFrontU, hallFrontV, y, { type: 'hall', floor: k, room: `${bid}-${k}-H` });
      fn.Cf = addN(uCorr, va - land / 2, y, { type: 'hall', floor: k, room: `${bid}-${k}-H` });
      fn.Cb = addN(uCorr, vb + land / 2, y, { type: 'hall', floor: k, room: `${bid}-${k}-H` });
      fn.d1 = addN(uSplit, vD1, y, { type: 'door', floor: k });
      fn.d2 = addN(uSplit, vD2, y, { type: 'door', floor: k });
      fn.h1 = addN(uSplit + 0.75, vD1, y, { type: 'hall', floor: k, room: `${bid}-${k}-H` });
      fn.h2 = addN(uSplit + 0.75, vD2, y, { type: 'hall', floor: k, room: `${bid}-${k}-H` });
      nav.addEdge(fn.R0, fn.d1);
      nav.addEdge(fn.d1, fn.h1);
      nav.addEdge(fn.R1, fn.d2);
      nav.addEdge(fn.d2, fn.h2);
      if (hasP2) {
        fn.d3 = addN(uD3, vSplit, y, { type: 'door', floor: k });
        nav.addEdge(fn.R0, fn.d3);
        nav.addEdge(fn.d3, fn.R1);
      }
      const hall = [fn.H, fn.Cf, fn.Cb, fn.h1, fn.h2];
      for (let i = 0; i < hall.length; i++) for (let j = i + 1; j < hall.length; j++) nav.addEdge(hall[i], hall[j]);
      building.roomNodes.push(fn.R0, fn.R1, fn.H);
      for (const [rk, rect] of [['R0', [T, uSplit, T, vSplit]], ['R1', [T, uSplit, vSplit, D - T]], ['H', [uSplit, W - T, T, D - T]]]) {
        const [x0, z0, x1, z1] = Fr.aabb(rect[0], rect[1], rect[2], rect[3]);
        building.rooms.push({ id: `${bid}-${k}-${rk}`, floor: k, minX: x0, maxX: x1, minZ: z0, maxZ: z1, nodeId: fn[rk] });
      }
    }
    // 계단참 노드 (옥상 포함, 해당 층에 연결될 때만)
    fn.lAf = addN(laneAc, va - land / 2, y, { type: 'landing', floor: k });
    fn.lBf = addN(laneBc, va - land / 2, y, { type: 'landing', floor: k });
    fn.lAb = addN(laneAc, vb + land / 2, y, { type: 'landing', floor: k });
    fn.lBb = addN(laneBc, vb + land / 2, y, { type: 'landing', floor: k });
    nav.addEdge(fn.lAf, fn.lBf);
    nav.addEdge(fn.lAb, fn.lBb);
    if (k < F) {
      nav.addEdge(fn.lBf, fn.Cf);
      nav.addEdge(fn.lBb, fn.Cb);
    }
    floorNodes.push(fn);
  }
  // 계단 간선 (계단참 → 경사 시작 → 경사 끝 → 위층 계단참) — NPC 높이 보간이 경사면과 일치하도록
  for (let k = 0; k <= lastRamp; k++) {
    const L = rampLane(k);
    const lo = floorNodes[k];
    const hi = floorNodes[k + 1];
    const lu = L === 'A' ? laneAc : laneBc;
    const vs = L === 'A' ? va : vb;
    const ve = L === 'A' ? vb : va;
    const s0 = addN(lu, vs, k * H, { type: 'stair', floor: k });
    const s1 = addN(lu, ve, (k + 1) * H, { type: 'stair', floor: k + 1 });
    nav.addEdge(s0, s1, 1.2);
    if (L === 'A') {
      nav.addEdge(lo.lAf, s0);
      nav.addEdge(s1, hi.lAb);
    } else {
      nav.addEdge(lo.lBb, s0);
      nav.addEdge(s1, hi.lBf);
    }
  }

  // 창가 노드
  for (let k = 0; k < F; k++) {
    const y = k * H;
    const fn = floorNodes[k];
    for (const w of windowsByFloor[k]) {
      let u;
      let v;
      const inset = T + 0.75;
      if (w.side === 'front') { u = w.c; v = inset; }
      else if (w.side === 'back') { u = w.c; v = D - inset; }
      else if (w.side === 'left') { u = inset; v = w.c; }
      else { u = W - inset; v = w.c; }
      // 가구와 겹치면 생략
      if (furn.some(([fk, fu, fv]) => fk === k && Math.abs(fu - u) < 1.2 && Math.abs(fv - v) < 1.2)) continue;
      const id = addN(u, v, y, { type: 'window', floor: k, out: outDir(w.side), room: `${bid}-${k}-${w.room === 'C' ? 'H' : w.room}` });
      let link;
      if (w.room === 'R0') link = fn.R0;
      else if (w.room === 'R1') link = fn.R1;
      else if (w.room === 'C') link = fn.Cb;
      else link = fn.H;
      nav.addEdge(id, link);
      if (w.room === 'C') nav.addEdge(id, fn.Cf);
      building.windowNodes.push({ id, roomNode: link, floor: k });
    }
  }

  // 출입구 노드 (안·밖)
  const doorNodes = [];
  const fn0 = floorNodes[0];
  {
    const inside = addN(uFD, T + 0.9, 0, { type: 'door', floor: 0, room: `${bid}-0-H` });
    const [ox, oz] = toW(uFD, -1.1);
    const outside = nav.addNode({ x: ox, y: 0, z: oz, type: 'doorOut', buildingId: bid, indoor: false });
    nav.addEdge(inside, fn0.H);
    nav.addEdge(inside, outside);
    doorNodes.push({ inside, outside, side: 'front' });
  }
  if (sideDoor === 'left') {
    const inside = addN(T + 0.9, vD2, 0, { type: 'door', floor: 0, room: `${bid}-0-R1` });
    const [ox, oz] = toW(-1.1, vD2);
    const outside = nav.addNode({ x: ox, y: 0, z: oz, type: 'doorOut', buildingId: bid, indoor: false });
    nav.addEdge(inside, fn0.R1);
    nav.addEdge(inside, outside);
    doorNodes.push({ inside, outside, side: 'left' });
  } else if (sideDoor === 'back') {
    const inside = addN(uD3, D - T - 0.9, 0, { type: 'door', floor: 0, room: `${bid}-0-R1` });
    const [ox, oz] = toW(uD3, D + 1.1);
    const outside = nav.addNode({ x: ox, y: 0, z: oz, type: 'doorOut', buildingId: bid, indoor: false });
    nav.addEdge(inside, fn0.R1);
    nav.addEdge(inside, outside);
    doorNodes.push({ inside, outside, side: 'back' });
  }
  building.doors = doorNodes;

  // 옥상 노드 (난간 안쪽 둘레)
  if (roofAccess) {
    const y = F * H;
    const L = rampLane(lastRamp);
    const [h0, h1] = laneRange(L);
    const holeRect = [h0 - 0.7, h1 + 0.7, va - 0.7, vb + 0.7];
    const topNode = L === 'A' ? floorNodes[F].lAb : floorNodes[F].lBf;
    building.stairTopRoof = topNode;
    building.roofStairBottom = L === 'A' ? floorNodes[F - 1].lAf : floorNodes[F - 1].lBb;
    const ins = T + 0.8;
    const pts = [];
    const along = (u0, v0, u1, v1, out) => {
      const len = Math.hypot(u1 - u0, v1 - v0);
      const n = Math.max(1, Math.round(len / 3.2));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push({ u: u0 + (u1 - u0) * t, v: v0 + (v1 - v0) * t, out });
      }
    };
    along(ins, ins, W - ins, ins, 'front');
    along(ins, ins, ins, D - ins, 'left');
    along(ins, D - ins, W - ins, D - ins, 'back');
    along(W - ins, ins, W - ins, D - ins, 'right');
    const ids = [];
    for (const p of pts) {
      if (p.u > holeRect[0] - 0.3 && p.u < holeRect[1] + 0.3 && p.v > holeRect[2] - 0.3 && p.v < holeRect[3] + 0.3) continue;
      if (ids.some((q) => Math.hypot(q.u - p.u, q.v - p.v) < 1.0)) continue;
      const id = addN(p.u, p.v, y, { type: 'roof', floor: F, out: outDir(p.out), indoor: false });
      ids.push({ id, u: p.u, v: p.v });
    }
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = ids[i];
        const b = ids[j];
        if (Math.hypot(a.u - b.u, a.v - b.v) > 4.6) continue;
        if (segHitsRect(a.u, a.v, b.u, b.v, holeRect)) continue;
        nav.addEdge(a.id, b.id);
      }
    }
    const tu = L === 'A' ? laneAc : laneBc;
    const tv = L === 'A' ? vb + land / 2 : va - land / 2;
    // 계단 출구에서 가까운 옥상 노드로 연결
    const sorted = ids.map((q) => ({ ...q, d: Math.hypot(q.u - tu, q.v - tv) })).sort((p, q) => p.d - q.d);
    let linked = 0;
    for (const q of sorted) {
      if (linked >= 3) break;
      if (segHitsRect(tu + (q.u - tu) * 0.15, tv + (q.v - tv) * 0.15, q.u, q.v, [h0 - 0.1, h1 + 0.1, va + 0.05, vb - 0.05])) continue;
      nav.addEdge(topNode, q.id);
      linked++;
    }
    building.roofNodes = ids.map((q) => q.id);
  }

  building.floorNodes = floorNodes;
  return building;
}

// =====================================================================
// 진입 불가 건물 (외벽 텍스처에 창문이 그려진 덩어리)
// =====================================================================
export function buildSolid(ctx, spec) {
  const { batcher, rng } = ctx;
  const H = CONFIG.map.floorHeight;
  const { minX, minZ, maxX, maxZ } = spec;
  const h = spec.floors * H;
  const mat = spec.facadeMat;
  const sideFaces = (top) => ({ px: mat, nx: mat, pz: mat, nz: mat, py: top, ny: null });
  const damaged = spec.damaged;
  const bo = { facade: { floorH: H }, surface: 'concrete', collide: true };

  if (!damaged) {
    batcher.addAABB(minX, 0, minZ, maxX, h, maxZ, { ...bo, faces: sideFaces('roof') });
    // 난간
    const p = 0.25;
    const ph = 0.9;
    const pm = { mat: 'concrete', collide: false };
    batcher.addAABB(minX, h, minZ, maxX, h + ph, minZ + p, pm);
    batcher.addAABB(minX, h, maxZ - p, maxX, h + ph, maxZ, pm);
    batcher.addAABB(minX, h, minZ + p, minX + p, h + ph, maxZ - p, pm);
    batcher.addAABB(maxX - p, h, minZ + p, maxX, h + ph, maxZ - p, pm);
    // 옥상 물탱크·실외기
    for (let i = 0; i < rng.int(0, 3); i++) {
      const sx = rng.range(0.8, 2.2);
      const sz = rng.range(0.8, 2.2);
      const cx = rng.range(minX + 1.5, maxX - 1.5);
      const cz = rng.range(minZ + 1.5, maxZ - 1.5);
      batcher.addBox({ cx, cy: h + 0.6, cz, sx, sy: 1.2, sz, mat: rng.chance(0.5) ? 'metal' : 'concrete', collide: false });
    }
  } else {
    // 윗부분이 부서진 건물: 아랫부분 + 들쭉날쭉한 윗덩어리들
    const lowerFloors = Math.max(1, spec.floors - rng.int(1, 2));
    const hl = lowerFloors * H;
    batcher.addAABB(minX, 0, minZ, maxX, hl, maxZ, { ...bo, faces: sideFaces('rubble') });
    const cols = 3;
    const sx = (maxX - minX) / cols;
    const sz = (maxZ - minZ) / cols;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < cols; j++) {
        if (rng.chance(0.35)) continue;
        const extra = rng.range(0.4, h - hl + H * 0.6);
        const x0 = minX + i * sx;
        const z0 = minZ + j * sz;
        batcher.addAABB(x0, hl, z0, x0 + sx, hl + extra, z0 + sz, { ...bo, faces: sideFaces('rubble') });
      }
    }
    // 무너진 잔해 더미가 옆에 흘러내림
    ctx.props.rubbleMound(ctx, (minX + maxX) / 2 + rng.range(-2, 2), (minZ + maxZ) / 2 + rng.range(-2, 2), Math.min(maxX - minX, maxZ - minZ) * 0.35, rng.range(0.5, 1.2), { collide: false, mark: false });
  }
  ctx.occupancy.markAABB(minX, minZ, maxX, maxZ, CONFIG.map.agentRadius);
  return { id: spec.id, kind: 'solid', minX, minZ, maxX, maxZ, height: h, damaged };
}

// =====================================================================
// 무너진 건물 (남은 벽 조각 + 잔해 더미) — 좋은 엄폐 지대
// =====================================================================
export function buildRuin(ctx, spec) {
  const { batcher, rng, occupancy, coverSpots } = ctx;
  const { minX, minZ, maxX, maxZ } = spec;
  const T = 0.35;
  const sides = [
    ['x', minX, maxX, minZ, minZ + T],
    ['x', minX, maxX, maxZ - T, maxZ],
    ['z', minZ + T, maxZ - T, minX, minX + T],
    ['z', minZ + T, maxZ - T, maxX - T, maxX],
  ];
  const wallMat = spec.facadeMat;
  for (const [axis, a0, a1, b0, b1] of sides) {
    if (rng.chance(0.25)) continue;
    let a = a0;
    while (a < a1 - 0.5) {
      const segLen = Math.min(a1 - a, rng.range(1.2, 3.2));
      const hgt = rng.chance(0.25) ? 0 : rng.range(0.9, 6.5);
      if (hgt > 0) {
        const faces = { px: wallMat, nx: wallMat, pz: wallMat, nz: wallMat, py: 'rubble', ny: null };
        if (axis === 'x') batcher.addAABB(a, 0, b0, a + segLen, hgt, b1, { faces, collide: true, surface: 'concrete' });
        else batcher.addAABB(b0, 0, a, b1, hgt, a + segLen, { faces, collide: true, surface: 'concrete' });
        if (axis === 'x') occupancy.markAABB(a, b0, a + segLen, b1, CONFIG.map.agentRadius);
        else occupancy.markAABB(b0, a, b1, a + segLen, CONFIG.map.agentRadius);
        // 낮은 벽 조각은 엄폐 지점
        if (hgt > 1.25 && hgt < 1.9 && segLen > 1.3) {
          const mid = a + segLen / 2;
          if (axis === 'x') {
            const cz = (b0 + b1) / 2;
            coverSpots.push({ x: mid, z: cz - 0.9, dir: { x: 0, z: 1 } }, { x: mid, z: cz + 0.9, dir: { x: 0, z: -1 } });
          } else {
            const cx = (b0 + b1) / 2;
            coverSpots.push({ x: cx - 0.9, z: mid, dir: { x: 1, z: 0 } }, { x: cx + 0.9, z: mid, dir: { x: -1, z: 0 } });
          }
        }
      }
      a += segLen;
    }
  }
  // 가운데 잔해 더미 (올라갈 수 있음)
  const cx = (minX + maxX) / 2 + rng.range(-1.5, 1.5);
  const cz = (minZ + maxZ) / 2 + rng.range(-1.5, 1.5);
  const r = Math.min(maxX - minX, maxZ - minZ) * rng.range(0.28, 0.36);
  ctx.props.rubbleMound(ctx, cx, cz, r, rng.range(1.4, 2.8), { collide: true, mark: true });
  // 철근
  ctx.props.rebar(ctx, cx, cz, r);
  return { id: spec.id, kind: 'ruin', minX, minZ, maxX, maxZ };
}
