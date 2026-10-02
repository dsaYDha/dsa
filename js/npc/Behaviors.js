// 공통 행동 보조 — 진짜 아군·민간인과 위장 적이 "같은 코드"로 움직이고 같은 기준으로 행동이 기록된다
// (낙오병·동행 아군·도움을 청하는 민간인과 위장 적이 행동만으로는 구분되지 않게)
// · 이동: moveToward(목표 위치로 내비 경로 이동), escortTarget(플레이어 뒤 비스듬히 약 4~5m), pickApproachNode(플레이어 주변 접근 지점)
// · 행동 기록: trackApproach(다가옴·응시), trackSquad(분대와 함께/혼자), trackFightFire(교전 중 사격 여부)
import * as THREE from 'three';
import { gameRand as R } from '../core/Random.js';

const _e = new THREE.Vector3();
const _t = new THREE.Vector3();

// 플레이어 수평 기준 벡터 (시선 앞 f, 오른쪽 r)
export function playerBasis(game) {
  const yaw = game.player.yaw;
  return { fx: -Math.sin(yaw), fz: -Math.cos(yaw), rx: Math.cos(yaw), rz: -Math.sin(yaw) };
}

// NPC 의 yaw (atan2(x, z) 규약)로 플레이어 시선 방향을 바라보는 각
export function yawOfPlayerForward(game) {
  const b = playerBasis(game);
  return Math.atan2(b.fx, b.fz);
}

/**
 * 목표 위치(tx, tz)까지 내비 경로로 이동 (상태를 바꾸지 않는 이동 — 각자 상태 머신 안에서 사용)
 * o: { walk, run, runDist=9, stopDist=1.2, repath=1.0, y }
 * @returns {boolean} 도착(또는 더 갈 수 없음)
 */
export function moveToward(npc, dt, tx, tz, o) {
  const game = npc.game;
  const nav = game.world.nav;
  const d = Math.hypot(tx - npc.position.x, tz - npc.position.z);
  npc._mvT = (npc._mvT ?? 0) - dt;
  if (d <= (o.stopDist ?? 1.2)) {
    npc.path = null;
    npc.curSpeed = 0;
    return true;
  }
  if (npc._mvT <= 0 || npc.pathDone) {
    npc._mvT = o.repath ?? 1.0;
    const fy = o.y ?? game.player.feet.y;
    const goal = nav.nearest(tx, fy, tz, (n) => Math.abs(n.y - fy) < 1.6, 8);
    if (goal && goal.id !== npc.navNode && npc.navNode != null) {
      const path = nav.findPath(npc.navNode, goal.id, { maxIter: 2500 });
      if (path) npc.setPath(path);
      else npc.path = null;
    } else npc.path = null;
  }
  if (!npc.path || npc.pathDone) {
    npc.curSpeed = 0;
    return true;
  }
  npc._followPath(dt, d > (o.runDist ?? 9) ? o.run : o.walk);
  return false;
}

/**
 * 동행 위치 — 지금 자리가 플레이어에서 3.5~7.5m 이고 조준선(정면 ±35°) 밖이면 그대로(null),
 * 아니면 지금 있는 쪽 옆을 유지한 채 플레이어 뒤 dist m (플레이어가 돌아서도 조준선을 가로질러 뛰지 않게)
 */
export function escortTarget(game, npc, dist = 4.2, side = 2.2) {
  const f = game.player.feet;
  const b = playerBasis(game);
  const dx = npc.position.x - f.x;
  const dz = npc.position.z - f.z;
  const d = Math.hypot(dx, dz);
  const front = d > 0.01 ? (dx * b.fx + dz * b.fz) / d : 0;
  if (d > 3.5 && d < 7.5 && front < 0.82) return null;
  const lat = dx * b.rx + dz * b.rz;
  const s = (Math.abs(lat) > 0.3 ? Math.sign(lat) : Math.sign(side) || 1) * Math.max(1.5, Math.abs(side));
  return { x: f.x - b.fx * dist + b.rx * s, z: f.z - b.fz * dist + b.rz * s };
}

/**
 * 플레이어 주변 접근 지점 (같은 층, [min, max] m 고리). preferBehind 면 플레이어 등 뒤·옆 선호
 * @returns {object|null} 내비 노드
 */
export function pickApproachNode(game, npc, range, preferBehind = true) {
  const f = game.player.feet;
  const nav = game.world.nav;
  const b = playerBasis(game);
  const cands = nav.inRadius(f.x, f.y, f.z, range[1], (n) => Math.abs(n.y - f.y) < 1.6);
  let best = null;
  let bestScore = -Infinity;
  for (const n of cands) {
    const dx = n.x - f.x;
    const dz = n.z - f.z;
    const d = Math.hypot(dx, dz);
    if (d < range[0]) continue;
    const front = (dx * b.fx + dz * b.fz) / (d || 1);
    let s = -Math.hypot(n.x - npc.position.x, n.z - npc.position.z) * 0.12 + R.range(0, 2);
    if (preferBehind) s -= front * 2.5;
    for (const o of game.npcs.list) if (o !== npc && o.alive && Math.hypot(o.position.x - n.x, o.position.z - n.z) < 1.4) s -= 3;
    if (s > bestScore) {
      bestScore = s;
      best = n;
    }
  }
  return best;
}

// 플레이어 쪽을 바라보는 yaw
export function yawToPlayer(npc) {
  const p = npc.game.player.feet;
  return Math.atan2(p.x - npc.position.x, p.z - npc.position.z);
}

function angDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/**
 * 다가옴 기록: 플레이어 쪽으로 움직이며(range m 안) — needFacing 이면 플레이어를 바라보며 — need 초 이상이면 key 기록
 * 진짜 낙오병·도움 청하는 민간인도 똑같이 기록된다
 */
export function trackApproach(npc, dt, { key = 'stare', needFacing = true, need = 2.5, range = 25 } = {}) {
  const p = npc.game.player.feet;
  const dx = p.x - npc.position.x;
  const dz = p.z - npc.position.z;
  const d = Math.hypot(dx, dz);
  let ok = false;
  if (d < range && d > 2.2 && npc.curSpeed > 0.4 && npc.heading != null) {
    const mv = npc.game.world.nav.get(npc.heading);
    if (mv) {
      const mx = mv.x - npc.position.x;
      const mz = mv.z - npc.position.z;
      const ml = Math.hypot(mx, mz) || 1;
      const toward = (mx * dx + mz * dz) / (ml * d) > 0.45;
      const facing = angDiff(npc.yaw, Math.atan2(dx, dz)) < 0.55;
      ok = toward && (!needFacing || facing);
    }
  }
  npc._apT = ok ? (npc._apT || 0) + dt : Math.max(0, (npc._apT || 0) - dt * 0.5);
  if (npc._apT > need) {
    npc.noteBehavior(key);
    npc._apT = 0;
  }
}

/**
 * 분대 기록 (아군처럼 보이는 인물): 15m 안에 다른 아군 표식 인물이 있으면 '분대와 함께', 5초 넘게 없으면 '혼자'
 * 동행 중인 진짜 아군·낙오병도 '혼자'로 기록된다
 */
export function trackSquad(npc, dt) {
  let near = false;
  for (const o of npc.game.npcs.byApparent('ally')) {
    if (o === npc) continue;
    if (o.position.distanceToSquared(npc.position) < 15 * 15) {
      near = true;
      break;
    }
  }
  if (near) {
    npc._aloneT = 0;
    npc._withT = (npc._withT || 0) + dt;
    if (npc._withT > 3) {
      npc._withT = 0;
      npc.noteBehavior('withSquad');
    }
  } else {
    npc._withT = 0;
    npc._aloneT = (npc._aloneT || 0) + dt;
    if (npc._aloneT > 5) {
      npc._aloneT = 0;
      npc.noteBehavior('loner');
    }
  }
}

/**
 * 교전 중 사격 기록: 적(빨간 표식)이 보이는데 4초 넘게 쏘지 않으면 '교전 중인데 적에게 쏘지 않음'
 * seesEnemy: 지금 적이 보이는지, lastFireT: 마지막으로 적 쪽에 쏜 시각
 */
export function trackFightFire(npc, dt, seesEnemy, lastFireT) {
  const t = npc.game.time;
  if (seesEnemy && t - (lastFireT ?? -99) > 4) {
    npc._noFireT = (npc._noFireT || 0) + dt;
    if (npc._noFireT > 4) {
      npc._noFireT = 0;
      npc.noteBehavior('noFireInFight');
    }
  } else npc._noFireT = Math.max(0, (npc._noFireT || 0) - dt);
}

/** NPC 눈 → 대상 가슴 시야 (가림 판정) */
export function npcSees(npc, target) {
  npc.getEyePosition(_e);
  target.getChestPosition(_t);
  return npc.game.world.hasLineOfSight(_e, _t);
}

/** 겉보기 적(빨간 표식) 중 range 안에서 가장 가까운, 보이는 대상 (가까운 순 2명까지만 시야 검사) */
export function nearestVisibleHostile(npc, range = 35) {
  const near = [];
  const r2 = range * range;
  for (const e of npc.game.npcs.byApparent('enemy')) {
    const d2 = e.position.distanceToSquared(npc.position);
    if (d2 < r2) near.push({ e, d2 });
  }
  near.sort((a, b) => a.d2 - b.d2);
  for (let i = 0; i < Math.min(2, near.length); i++) if (npcSees(npc, near[i].e)) return near[i].e;
  return null;
}
