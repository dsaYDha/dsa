// 도심 시가지 생성 — 격자 도로·블록·필지·건물·소품·내비 그래프·출현 지점
// 같은 시드 → 같은 맵 (모든 무작위는 시드 RNG 사용)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { RNG } from '../core/Random.js';
import { buildEnterable, buildSolid, buildRuin } from './Buildings.js';
import { PropBuilder } from './Props.js';

const FACADES = ['facadePlaster', 'facadeBrick', 'facadeConcrete'];
const WIN_FACADES = ['winBrick', 'winPlaster', 'winConcrete'];

export function generateCity(seed, batcher, collision, nav, occupancy, materials) {
  const C = CONFIG.map;
  const rng = new RNG('city:' + seed);
  const half = C.size / 2;
  const inner = half - C.edgeMargin;
  const nb = C.blocksPerSide;
  const rw = C.roadWidth;
  const blockSize = (2 * inner - (nb - 1) * rw) / nb;
  const blockStart = (i) => -inner + i * (blockSize + rw);
  const roadCenters = [];
  for (let i = 0; i < nb - 1; i++) roadCenters.push(blockStart(i) + blockSize + rw / 2);

  const coverSpots = [];
  const ctx = { batcher, collision, nav, occupancy, rng, coverSpots };
  const props = new PropBuilder(ctx, materials.materials);
  ctx.props = props;

  const result = {
    seed,
    half,
    roadCenters,
    blockSize,
    buildings: [],
    enterable: [],
    alleys: [],
    fires: props.fires,
    spawnPoints: [],
    playerSpawn: null,
  };

  // -----------------------------------------------------------------
  // 1) 지면·도로
  // -----------------------------------------------------------------
  // 지면 (멀리까지) — 시각용 큰 판
  batcher.addBox({ cx: 0, cy: -0.05, cz: 0, sx: 420, sy: 0.1, sz: 420, faces: { py: 'ground', px: null, nx: null, pz: null, nz: null, ny: null } });
  // 지면 충돌: 10m 타일
  const tile = 10;
  for (let x = -half - 10; x < half + 10; x += tile) {
    for (let z = -half - 10; z < half + 10; z += tile) {
      const a = new THREE.Vector3(x, 0, z);
      const b = new THREE.Vector3(x + tile, 0, z);
      const c = new THREE.Vector3(x + tile, 0, z + tile);
      const d = new THREE.Vector3(x, 0, z + tile);
      collision.addQuad(a, b, c, d, new THREE.Vector3(0, 1, 0), 'dirt');
    }
  }
  // 차도 (가로·세로 전체 길이)
  for (const rc of roadCenters) {
    batcher.addFlatQuad('asphalt', -half - 2, rc - rw / 2, half + 2, rc + rw / 2, 0.012);
    batcher.addFlatQuad('asphalt', rc - rw / 2, -half - 2, rc + rw / 2, half + 2, 0.012);
    // 중앙선 점선
    for (let t = -half; t < half; t += 6) {
      if (roadCenters.some((r) => Math.abs(t + 1.5 - r) < rw / 2 + 1)) continue;
      batcher.addFlatQuad('lane', t, rc - 0.07, t + 3, rc + 0.07, 0.02);
      batcher.addFlatQuad('lane', rc - 0.07, t, rc + 0.07, t + 3, 0.02);
    }
  }
  // 인도 (블록 둘레)
  const sw = C.sidewalkWidth;
  const blocks = [];
  for (let i = 0; i < nb; i++) {
    for (let j = 0; j < nb; j++) {
      const x0 = blockStart(i);
      const z0 = blockStart(j);
      const blk = { i, j, minX: x0, minZ: z0, maxX: x0 + blockSize, maxZ: z0 + blockSize };
      blocks.push(blk);
      const y = 0.03;
      batcher.addFlatQuad('sidewalk', x0 - sw, z0 - sw, x0 + blockSize + sw, z0, y);
      batcher.addFlatQuad('sidewalk', x0 - sw, z0 + blockSize, x0 + blockSize + sw, z0 + blockSize + sw, y);
      batcher.addFlatQuad('sidewalk', x0 - sw, z0, x0, z0 + blockSize, y);
      batcher.addFlatQuad('sidewalk', x0 + blockSize, z0, x0 + blockSize + sw, z0 + blockSize, y);
    }
  }

  // -----------------------------------------------------------------
  // 2) 블록 → 필지
  // -----------------------------------------------------------------
  const aw = C.alleyWidth;
  const lots = [];
  for (const b of blocks) {
    const pattern = rng.weighted({ quad: 0.5, split: 0.38, single: 0.12 });
    // 도로에 접한 변 (맵 가장자리 쪽은 도로 없음)
    const roadSides = {
      nx: b.i > 0, px: b.i < nb - 1, nz: b.j > 0, pz: b.j < nb - 1,
    };
    const mid = blockSize / 2;
    const addLot = (minX, minZ, maxX, maxZ) => lots.push({ minX, minZ, maxX, maxZ, block: b, roadSides });
    if (pattern === 'quad') {
      const ox = b.minX + mid + rng.range(-2, 2);
      const oz = b.minZ + mid + rng.range(-2, 2);
      addLot(b.minX, b.minZ, ox - aw / 2, oz - aw / 2);
      addLot(ox + aw / 2, b.minZ, b.maxX, oz - aw / 2);
      addLot(b.minX, oz + aw / 2, ox - aw / 2, b.maxZ);
      addLot(ox + aw / 2, oz + aw / 2, b.maxX, b.maxZ);
      result.alleys.push({ minX: ox - aw / 2, maxX: ox + aw / 2, minZ: b.minZ, maxZ: b.maxZ });
      result.alleys.push({ minX: b.minX, maxX: b.maxX, minZ: oz - aw / 2, maxZ: oz + aw / 2 });
    } else if (pattern === 'split') {
      const alongX = rng.chance(0.5);
      const o = mid + rng.range(-2.5, 2.5);
      if (alongX) {
        const oz = b.minZ + o;
        // 긴 필지 → 둘로 나눔(붙은 건물)
        const cut = b.minX + mid + rng.range(-3, 3);
        addLot(b.minX, b.minZ, cut, oz - aw / 2);
        addLot(cut, b.minZ, b.maxX, oz - aw / 2);
        addLot(b.minX, oz + aw / 2, b.maxX, b.maxZ);
        result.alleys.push({ minX: b.minX, maxX: b.maxX, minZ: oz - aw / 2, maxZ: oz + aw / 2 });
      } else {
        const ox = b.minX + o;
        const cut = b.minZ + mid + rng.range(-3, 3);
        addLot(b.minX, b.minZ, ox - aw / 2, cut);
        addLot(b.minX, cut, ox - aw / 2, b.maxZ);
        addLot(ox + aw / 2, b.minZ, b.maxX, b.maxZ);
        result.alleys.push({ minX: ox - aw / 2, maxX: ox + aw / 2, minZ: b.minZ, maxZ: b.maxZ });
      }
    } else {
      const l = { minX: b.minX, minZ: b.minZ, maxX: b.maxX, maxZ: b.maxZ, block: b, roadSides, big: true };
      lots.push(l);
    }
  }

  // 필지 용도 결정
  for (const l of lots) {
    const w = l.maxX - l.minX;
    const d = l.maxZ - l.minZ;
    l.w = w;
    l.d = d;
    l.cx = (l.minX + l.maxX) / 2;
    l.cz = (l.minZ + l.maxZ) / 2;
    if (l.big) l.use = rng.weighted({ plaza: 0.45, solidYard: 0.35, ruin: 0.2 });
    else l.use = rng.weighted({ building: 0.72, ruin: 0.14, yard: 0.14 });
    // 정면 방향: 도로에 접한 변 중 하나
    const sides = [];
    const b = l.block;
    if (l.roadSides.nz && Math.abs(l.minZ - b.minZ) < 0.01) sides.push(0); // 정면 -z
    if (l.roadSides.px && Math.abs(l.maxX - b.maxX) < 0.01) sides.push(1); // 정면 +x
    if (l.roadSides.pz && Math.abs(l.maxZ - b.maxZ) < 0.01) sides.push(2); // 정면 +z
    if (l.roadSides.nx && Math.abs(l.minX - b.minX) < 0.01) sides.push(3); // 정면 -x
    l.frontOptions = sides;
  }

  // 진입 가능 건물 선택: 후보 중 서로 멀리 떨어지게
  const cands = lots.filter((l) => l.use === 'building' && l.frontOptions.length && Math.min(l.w, l.d) >= 10.4);
  const chosen = [];
  const target = Math.max(6, C.enterableCount);
  // 중앙 부근 하나 먼저
  cands.sort((a, b) => Math.hypot(a.cx, a.cz) - Math.hypot(b.cx, b.cz));
  if (cands.length) chosen.push(cands[rng.int(0, Math.min(2, cands.length - 1))]);
  while (chosen.length < target && chosen.length < cands.length) {
    let best = null;
    let bestScore = -Infinity;
    for (const c of cands) {
      if (chosen.includes(c)) continue;
      const dmin = Math.min(...chosen.map((o) => Math.hypot(o.cx - c.cx, o.cz - c.cz)));
      const score = dmin - Math.hypot(c.cx, c.cz) * 0.15 + rng.range(0, 6);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (!best) break;
    chosen.push(best);
  }
  for (const c of chosen) c.use = 'enterable';
  // 후보가 모자라면 마당/폐허 필지도 진입 가능 건물로 전환
  if (chosen.length < 6) {
    for (const l of lots) {
      if (chosen.length >= 6) break;
      if (l.use !== 'enterable' && !l.big && l.frontOptions.length && Math.min(l.w, l.d) >= 10.4) {
        l.use = 'enterable';
        chosen.push(l);
      }
    }
  }

  // -----------------------------------------------------------------
  // 3) 건물 생성
  // -----------------------------------------------------------------
  let bid = 0;
  for (const l of lots) {
    if (l.use === 'enterable') {
      const rot = rng.pick(l.frontOptions);
      // 정면 폭 W / 깊이 D
      const along = rot === 0 || rot === 2 ? l.w : l.d;
      const depth = rot === 0 || rot === 2 ? l.d : l.w;
      const W = Math.min(along, 12.6, Math.max(10.4, along - rng.range(0, 1.5)));
      const D = Math.min(depth, 12.6, Math.max(10.4, depth - rng.range(0, 1.5)));
      // 필지 안에서 정면을 도로 쪽으로 붙임
      let minX;
      let minZ;
      let maxX;
      let maxZ;
      if (rot === 0) { minX = l.cx - W / 2; maxX = l.cx + W / 2; minZ = l.minZ; maxZ = l.minZ + D; }
      else if (rot === 2) { minX = l.cx - W / 2; maxX = l.cx + W / 2; maxZ = l.maxZ; minZ = l.maxZ - D; }
      else if (rot === 1) { minZ = l.cz - W / 2; maxZ = l.cz + W / 2; maxX = l.maxX; minX = l.maxX - D; }
      else { minZ = l.cz - W / 2; maxZ = l.cz + W / 2; minX = l.minX; maxX = l.minX + D; }
      const origin = [[minX, minZ], [maxX, minZ], [maxX, maxZ], [minX, maxZ]][rot];
      const floors = rng.int(C.enterableFloors[0], C.enterableFloors[1]);
      const b = buildEnterable(ctx, {
        id: bid++, ox: origin[0], oz: origin[1], rot, W, D, floors,
        roofAccess: rng.chance(C.roofAccessChance),
        facadeMat: rng.pick(FACADES),
      });
      occupancy.markAABB(b.minX, b.minZ, b.maxX, b.maxZ, C.agentRadius);
      result.buildings.push(b);
      result.enterable.push(b);
      // 남는 공간에 잔해
      scatterYard(ctx, l, b);
    } else if (l.use === 'building') {
      // 긴 필지는 두 동으로
      const inset = () => rng.range(0, 1.2);
      const parts = [];
      if (Math.max(l.w, l.d) > 20 && rng.chance(0.6)) {
        if (l.w > l.d) {
          const cut = l.minX + l.w * rng.range(0.4, 0.6);
          parts.push([l.minX, l.minZ, cut, l.maxZ], [cut, l.minZ, l.maxX, l.maxZ]);
        } else {
          const cut = l.minZ + l.d * rng.range(0.4, 0.6);
          parts.push([l.minX, l.minZ, l.maxX, cut], [l.minX, cut, l.maxX, l.maxZ]);
        }
      } else parts.push([l.minX, l.minZ, l.maxX, l.maxZ]);
      for (const [x0, z0, x1, z1] of parts) {
        const b = buildSolid(ctx, {
          id: bid++, minX: x0 + inset() * 0.3, minZ: z0 + inset() * 0.3, maxX: x1 - inset() * 0.3, maxZ: z1 - inset() * 0.3,
          floors: rng.int(C.solidFloors[0], C.solidFloors[1]),
          facadeMat: rng.pick(WIN_FACADES),
          damaged: rng.chance(0.3),
        });
        result.buildings.push(b);
        // 일부 창문에서 불길
        if (rng.chance(0.18)) {
          const side = rng.int(0, 3);
          const fl = rng.int(1, Math.max(1, Math.floor(b.height / C.floorHeight) - 1));
          const y = fl * C.floorHeight + 1.4;
          const t = rng.range(0.2, 0.8);
          let fx;
          let fz;
          if (side === 0) { fx = b.minX + (b.maxX - b.minX) * t; fz = b.minZ - 0.3; }
          else if (side === 1) { fx = b.maxX + 0.3; fz = b.minZ + (b.maxZ - b.minZ) * t; }
          else if (side === 2) { fx = b.minX + (b.maxX - b.minX) * t; fz = b.maxZ + 0.3; }
          else { fx = b.minX - 0.3; fz = b.minZ + (b.maxZ - b.minZ) * t; }
          props.fire(fx, y, fz, rng.range(1.0, 1.6), true, 'window');
        }
      }
    } else if (l.use === 'ruin') {
      result.buildings.push(buildRuin(ctx, { id: bid++, minX: l.minX + 0.5, minZ: l.minZ + 0.5, maxX: l.maxX - 0.5, maxZ: l.maxZ - 0.5, facadeMat: rng.pick(FACADES) }));
      if (rng.chance(0.5)) props.fire(l.cx + rng.range(-3, 3), 0.4, l.cz + rng.range(-3, 3), rng.range(0.8, 1.3), rng.chance(0.5), 'debris');
    } else if (l.use === 'yard') {
      scatterYard(ctx, l, null);
    } else if (l.use === 'solidYard') {
      // 큰 블록: 큰 건물 하나 + 마당
      const w = rng.range(14, 18);
      const d = rng.range(14, 18);
      const x0 = rng.chance(0.5) ? l.minX : l.maxX - w;
      const z0 = rng.chance(0.5) ? l.minZ : l.maxZ - d;
      const b = buildSolid(ctx, { id: bid++, minX: x0, minZ: z0, maxX: x0 + w, maxZ: z0 + d, floors: rng.int(3, 5), facadeMat: rng.pick(WIN_FACADES), damaged: rng.chance(0.35) });
      result.buildings.push(b);
      scatterYard(ctx, l, b);
    } else if (l.use === 'plaza') {
      // 광장: 포탄 구덩이 + 진지 + 잔해 (개활지 교전 공간)
      props.crater(l.cx + rng.range(-4, 4), l.cz + rng.range(-4, 4), rng.range(2.2, 3.4));
      for (let i = 0; i < rng.int(2, 4); i++) {
        const x = rng.range(l.minX + 3, l.maxX - 3);
        const z = rng.range(l.minZ + 3, l.maxZ - 3);
        const kind = rng.weighted({ nest: 0.3, wall: 0.3, mound: 0.25, car: 0.15 });
        const r = rng.range(0, Math.PI);
        if (kind === 'nest' && occupancy.rectFree(x, z, 4, 4, r, 0.5)) props.sandbagNest(x, z, r);
        else if (kind === 'wall' && occupancy.rectFree(x, z, 3.5, 0.6, r, 0.5)) props.sandbagWall(x, z, r, rng.range(2.4, 3.8));
        else if (kind === 'mound' && occupancy.rectFree(x, z, 4, 4, 0, 0.3)) props.rubbleMound(ctx, x, z, rng.range(1.6, 2.4), rng.range(1.0, 1.6));
        else if (kind === 'car' && occupancy.rectFree(x, z, 4.4, 1.9, r, 0.5)) props.car(x, z, r, { burning: rng.chance(0.4), noWheels: rng.chance(0.5) });
      }
      // 쓰러진 가로등·나무 대신 철제 잔해
      for (let i = 0; i < 8; i++) props.debrisChunk(rng.range(l.minX + 1, l.maxX - 1), rng.range(l.minZ + 1, l.maxZ - 1), rng.range(0.2, 0.5));
    }
  }

  // -----------------------------------------------------------------
  // 4) 맵 가장자리: 잔해 둑 + 보이지 않는 벽 + 도로 끝 바리케이드
  // -----------------------------------------------------------------
  const wallPos = half - 2.6;
  for (const [cx, cz, sx, sz] of [[0, -wallPos - 0.5, C.size + 6, 1], [0, wallPos + 0.5, C.size + 6, 1], [-wallPos - 0.5, 0, 1, C.size + 6], [wallPos + 0.5, 0, 1, C.size + 6]]) {
    collision.addBox(cx, 20, cz, sx, 40, sz, 0, 'concrete');
    occupancy.markRect(cx, cz, sx, sz, 0, 2);
  }
  // 잔해 둑 (시각)
  for (let side = 0; side < 4; side++) {
    for (let t = -half; t <= half; t += rng.range(3.5, 6)) {
      const off = half - 1.0 + rng.range(-0.6, 0.8);
      const x = side === 0 ? t : side === 1 ? t : side === 2 ? -off : off;
      const z = side === 0 ? -off : side === 1 ? off : t;
      props.rubbleMound(ctx, x, z, rng.range(2.6, 4.2), rng.range(2.4, 4.0), { collide: false, mark: false, cover: false });
    }
  }
  // 도로 끝 바리케이드
  for (const rc of roadCenters) {
    for (const end of [-1, 1]) {
      for (const axis of ['x', 'z']) {
        const along = end * (inner - rng.range(2.5, 5));
        const x = axis === 'x' ? along : rc;
        const z = axis === 'x' ? rc : along;
        const across = axis === 'x' ? Math.PI / 2 : 0; // 도로를 가로지르는 방향
        const kind = rng.weighted({ bus: 0.3, container: 0.25, jersey: 0.45 });
        if (kind === 'bus' && occupancy.rectFree(x, z, 10, 2.6, across, 0.2)) props.bus(x, z, across + rng.range(-0.2, 0.2));
        else if (kind === 'container' && occupancy.rectFree(x, z, 6, 2.5, across, 0.2)) props.container(x, z, across + rng.range(-0.15, 0.15));
        else {
          for (let k = -2; k <= 2; k++) {
            const ox = axis === 'x' ? 0 : k * 2.05;
            const oz = axis === 'x' ? k * 2.05 : 0;
            if (occupancy.rectFree(x + ox, z + oz, 2, 0.6, across, 0.1)) props.jersey(x + ox, z + oz, across + rng.range(-0.1, 0.1));
          }
        }
        // 바리케이드 앞 철조망 대용 고슴도치
        const hx = axis === 'x' ? x - end * 3.2 : x + rng.range(-3, 3);
        const hz = axis === 'x' ? z + rng.range(-3, 3) : z - end * 3.2;
        if (occupancy.rectFree(hx, hz, 1.3, 1.3, 0, 0.3)) props.hedgehog(hx, hz, rng.range(0, 3));
      }
    }
  }

  // -----------------------------------------------------------------
  // 5) 도로 위 엄폐물·차량·구덩이
  // -----------------------------------------------------------------
  const density = C.propDensity;
  const roadSegments = [];
  for (const rc of roadCenters) {
    for (let i = 0; i < nb; i++) {
      const a0 = blockStart(i);
      roadSegments.push({ axis: 'x', c: rc, a0, a1: a0 + blockSize });
      roadSegments.push({ axis: 'z', c: rc, a0, a1: a0 + blockSize });
    }
  }
  const P = (seg, along, across) => (seg.axis === 'x' ? [along, seg.c + across] : [seg.c + across, along]);
  const segRot = (seg) => (seg.axis === 'x' ? 0 : Math.PI / 2); // 도로 방향을 로컬 x 로
  for (const seg of roadSegments) {
    const n = Math.round(rng.range(1.5, 3.5) * density);
    for (let k = 0; k < n; k++) {
      const along = rng.range(seg.a0 + 3, seg.a1 - 3);
      const kind = rng.weighted({ parkedCar: 0.28, wreck: 0.17, sandbag: 0.2, jersey: 0.15, crates: 0.08, dumpster: 0.06, mound: 0.06 });
      const side = rng.sign();
      const r0 = segRot(seg);
      if (kind === 'parkedCar') {
        const [x, z] = P(seg, along, side * (rw / 2 - sw - 1.2));
        const r = r0 + rng.range(-0.15, 0.15) + (rng.chance(0.5) ? Math.PI : 0);
        if (occupancy.rectFree(x, z, 4.4, 1.9, r, 0.3)) props.car(x, z, r, { burning: rng.chance(0.18), noWheels: rng.chance(0.4) });
      } else if (kind === 'wreck') {
        const [x, z] = P(seg, along, rng.range(-1.5, 1.5));
        const r = r0 + rng.range(-1.2, 1.2);
        if (occupancy.rectFree(x, z, 4.4, 1.9, r, 1.2)) props.car(x, z, r, { burning: rng.chance(0.35), noWheels: true });
      } else if (kind === 'sandbag') {
        // 도로를 반만 막는 모래주머니 벽
        const [x, z] = P(seg, along, side * rng.range(0.8, 2.2));
        const r = r0 + Math.PI / 2 + rng.range(-0.25, 0.25);
        const L = rng.range(2.4, 3.6);
        if (occupancy.rectFree(x, z, L, 0.5, r, 0.9)) props.sandbagWall(x, z, r, L);
      } else if (kind === 'jersey') {
        const [x, z] = P(seg, along, side * rng.range(0.5, 2.5));
        const r = r0 + (rng.chance(0.5) ? Math.PI / 2 : 0) + rng.range(-0.3, 0.3);
        if (occupancy.rectFree(x, z, 2.1, 0.7, r, 0.9)) props.jersey(x, z, r);
      } else if (kind === 'crates') {
        const [x, z] = P(seg, along, side * (rw / 2 - 0.9));
        if (occupancy.rectFree(x, z, 1.3, 1.3, r0, 0.4)) props.crates(x, z, r0 + rng.range(-0.3, 0.3));
      } else if (kind === 'dumpster') {
        const [x, z] = P(seg, along, side * (rw / 2 - 1.0));
        if (occupancy.rectFree(x, z, 2, 1.2, r0, 0.4)) props.dumpster(x, z, r0 + rng.range(-0.2, 0.2));
      } else {
        const [x, z] = P(seg, along, rng.range(-2, 2));
        if (occupancy.rectFree(x, z, 3.5, 3.5, 0, 1.0)) props.rubbleMound(ctx, x, z, rng.range(1.4, 2.0), rng.range(1.0, 1.5));
      }
    }
    // 가로등
    for (let t = seg.a0 + 4; t < seg.a1 - 2; t += rng.range(12, 18)) {
      const side = rng.sign();
      const [x, z] = P(seg, t, side * (rw / 2 - 0.35));
      if (!occupancy.isFree(x, z)) continue;
      const state = rng.weighted({ ok: 0.55, bent: 0.25, fallen: 0.2 });
      const facing = seg.axis === 'x' ? (side > 0 ? Math.PI / 2 : -Math.PI / 2) : side > 0 ? Math.PI : 0;
      props.lampPost(x, z, facing, state);
    }
    // 잔해 조각
    for (let i = 0; i < 10; i++) {
      const [x, z] = P(seg, rng.range(seg.a0, seg.a1), rng.range(-rw / 2, rw / 2));
      if (rng.chance(0.25)) props.plank(x, z, rng.range(0, 6.28));
      else props.debrisChunk(x, z, rng.range(0.08, 0.3));
    }
  }
  // 교차로: 진지·구덩이
  for (const rx of roadCenters) {
    for (const rz of roadCenters) {
      const roll = rng.next();
      if (roll < 0.35) {
        const r = rng.range(0, Math.PI);
        const x = rx + rng.range(-1.5, 1.5);
        const z = rz + rng.range(-1.5, 1.5);
        if (occupancy.rectFree(x, z, 4, 4, r, 1.0)) props.sandbagNest(x, z, r);
      } else if (roll < 0.7) {
        props.crater(rx + rng.range(-2, 2), rz + rng.range(-2, 2), rng.range(1.8, 3.0));
      }
    }
  }
  // 전신주와 전선 (몇몇 도로)
  for (const rc of roadCenters) {
    if (!rng.chance(0.6)) continue;
    const axis = rng.chance(0.5) ? 'x' : 'z';
    const side = rng.sign() * (rw / 2 - 0.5);
    let prev = null;
    for (let t = -inner + 6; t < inner - 6; t += rng.range(16, 22)) {
      const x = axis === 'x' ? t : rc + side;
      const z = axis === 'x' ? rc + side : t;
      if (!occupancy.isFree(x, z) || roadCenters.some((r) => Math.abs(t - r) < rw / 2 + 1)) {
        prev = null;
        continue;
      }
      const top = props.utilityPole(x, z);
      if (prev) {
        for (let w = -1; w <= 1; w++) {
          const off = w * 0.7;
          const a = axis === 'x' ? [prev[0], prev[1], prev[2] + off] : [prev[0] + off, prev[1], prev[2]];
          const b = axis === 'x' ? [top[0], top[1], top[2] + off] : [top[0] + off, top[1], top[2]];
          props.wire(a, b, rng.range(0.6, 1.3), rng.chance(0.12));
        }
      }
      prev = top;
    }
  }

  // -----------------------------------------------------------------
  // 6) 실외 내비 그래프
  // -----------------------------------------------------------------
  const outdoor = [];
  const sp = C.navSpacing;
  for (let x = -inner + 1; x <= inner - 1; x += sp) {
    for (let z = -inner + 1; z <= inner - 1; z += sp) {
      const f = occupancy.nearestFree(x, z, sp * 0.45);
      if (!f) continue;
      if (nav.inRadius(f[0], 0, f[1], 1.2, (n) => !n.indoor).length) continue;
      const inAlley = result.alleys.some((a) => f[0] > a.minX && f[0] < a.maxX && f[1] > a.minZ && f[1] < a.maxZ);
      const onRoad = roadCenters.some((r) => Math.abs(f[0] - r) < rw / 2 || Math.abs(f[1] - r) < rw / 2);
      const type = inAlley ? 'alley' : onRoad ? 'street' : 'yard';
      outdoor.push(nav.addNode({ x: f[0], y: 0, z: f[1], type }));
    }
  }
  // 골목 중심선 노드 (좁은 골목 연결 보장)
  for (const a of result.alleys) {
    const w = a.maxX - a.minX;
    const d = a.maxZ - a.minZ;
    const alongX = w > d;
    const len = alongX ? w : d;
    for (let t = 1.5; t < len - 1.5; t += 2.5) {
      const x = alongX ? a.minX + t : (a.minX + a.maxX) / 2;
      const z = alongX ? (a.minZ + a.maxZ) / 2 : a.minZ + t;
      if (!occupancy.isFree(x, z)) continue;
      outdoor.push(nav.addNode({ x, y: 0, z, type: 'alley' }));
    }
  }
  // 엄폐 지점 노드
  const coverIds = [];
  for (const cs of coverSpots) {
    if (Math.abs(cs.x) > inner - 1 || Math.abs(cs.z) > inner - 1) continue;
    if (!occupancy.isFree(cs.x, cs.z)) continue;
    const id = nav.addNode({ x: cs.x, y: 0, z: cs.z, type: 'cover', coverDir: cs.dir, tags: { kind: cs.kind } });
    outdoor.push(id);
    coverIds.push(id);
  }
  // 출입구 바깥 노드
  for (const b of result.enterable) for (const d of b.doors) outdoor.push(d.outside);
  // 가까운 실외 노드끼리 연결 (점유 격자로 통과 가능 판정)
  const R = C.navLinkRadius;
  for (const id of outdoor) {
    const n = nav.get(id);
    const near = nav.inRadius(n.x, 0, n.z, R, (m) => !m.indoor && m.id !== id && m.y < 0.5);
    for (const m of near) {
      if (m.edges.some((e) => e.to === id)) continue;
      // 문 바깥 노드는 문 쪽 벽 패딩 안에 있을 수 있어 끝점 검사 완화
      const ax = n.x + (m.x - n.x) * (n.type === 'doorOut' ? 0.3 : 0);
      const az = n.z + (m.z - n.z) * (n.type === 'doorOut' ? 0.3 : 0);
      const bx = m.x + (n.x - m.x) * (m.type === 'doorOut' ? 0.3 : 0);
      const bz = m.z + (n.z - m.z) * (m.type === 'doorOut' ? 0.3 : 0);
      if (occupancy.segmentFree(ax, az, bx, bz)) nav.addEdge(id, m.id);
    }
  }
  const pruned = nav.pruneToLargestComponent();
  result.navPruned = pruned;

  // -----------------------------------------------------------------
  // 7) 출현 지점 카탈로그
  // -----------------------------------------------------------------
  const sps = result.spawnPoints;
  const pushSP = (type, nodeId, extra = {}) => {
    const n = nav.get(nodeId);
    if (!n || n.removed) return;
    sps.push({ id: sps.length, type, nodeId, x: n.x, y: n.y, z: n.z, buildingId: n.buildingId, lastUsed: -999, ...extra });
  };
  for (const id of outdoor) {
    const n = nav.get(id);
    if (n.removed) continue;
    if (n.type === 'alley') pushSP('alleyEnd', id, { cue: 'footsteps' });
    else if (n.type === 'yard') pushSP('alleyEnd', id, { cue: 'rubble' });
    else if (n.type === 'street' && (Math.abs(n.x) > inner - 12 || Math.abs(n.z) > inner - 12)) pushSP('streetEnd', id, { cue: 'footsteps' });
  }
  for (const id of coverIds) {
    const n = nav.get(id);
    if (n.removed) continue;
    const kind = n.tags && n.tags.kind;
    pushSP('behindCover', id, { cue: kind === 'rubble' ? 'rubble' : 'footsteps', coverKind: kind });
  }
  for (const b of result.enterable) {
    for (const d of b.doors) pushSP('doorway', d.inside, { cue: 'door' });
    for (const rid of b.roomNodes) pushSP('room', rid, { cue: 'door' });
    for (const w of b.windowNodes) {
      const wn = nav.get(w.id);
      if (wn.removed) continue;
      pushSP('window', w.roomNode, { cue: 'glass', goalNode: w.id });
    }
    // 옥상 사수: 꼭대기 층 계단 아래에서 생성 → 계단을 올라 옥상 난간으로
    if (b.roofAccess && b.roofStairBottom != null && !nav.get(b.roofStairBottom).removed && b.roofNodes.length) {
      pushSP('roof', b.roofStairBottom, { cue: 'footsteps', goalNodes: b.roofNodes.filter((r) => !nav.get(r).removed) });
    }
  }

  // 플레이어 시작 위치: 중앙 교차로 근처 도로
  const start = nav.nearest(roadCenters[Math.floor(roadCenters.length / 2)] || 0, 0, roadCenters[Math.floor(roadCenters.length / 2)] || 0, (n) => !n.indoor && n.type === 'street');
  result.playerSpawn = start ? { x: start.x, y: 0, z: start.z } : { x: 0, y: 0, z: 0 };
  result.coverIds = coverIds;
  result.props = props;
  return result;
}

// 마당·빈 공간에 잔해·차량·불길 배치
function scatterYard(ctx, lot, building) {
  const { rng, occupancy, props } = ctx;
  const n = rng.int(1, 3);
  for (let i = 0; i < n; i++) {
    const x = rng.range(lot.minX + 2, lot.maxX - 2);
    const z = rng.range(lot.minZ + 2, lot.maxZ - 2);
    if (building && x > building.minX - 1 && x < building.maxX + 1 && z > building.minZ - 1 && z < building.maxZ + 1) continue;
    const kind = rng.weighted({ mound: 0.4, car: 0.25, crates: 0.2, dumpster: 0.15 });
    if (kind === 'mound' && occupancy.rectFree(x, z, 3.5, 3.5, 0, 0.6)) props.rubbleMound(ctx, x, z, rng.range(1.4, 2.2), rng.range(0.9, 1.6));
    else if (kind === 'car' && occupancy.rectFree(x, z, 4.4, 1.9, 0, 0.6)) props.car(x, z, rng.range(0, Math.PI * 2), { burning: rng.chance(0.25), noWheels: true });
    else if (kind === 'crates' && occupancy.rectFree(x, z, 1.4, 1.4, 0, 0.6)) props.crates(x, z, rng.range(0, 3));
    else if (kind === 'dumpster' && occupancy.rectFree(x, z, 2.1, 1.3, 0, 0.6)) props.dumpster(x, z, rng.range(0, 3));
  }
  for (let i = 0; i < 6; i++) props.debrisChunk(rng.range(lot.minX + 0.5, lot.maxX - 0.5), rng.range(lot.minZ + 0.5, lot.maxZ - 0.5), rng.range(0.1, 0.35));
}
