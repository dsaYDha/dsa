// NPC 관리 — 생성·갱신·제거, 부위별 히트박스 레이캐스트, 엄폐/창가 지점 선택,
// 플레이어 화면 노출 추적(firstSeenAt), 조준 중인 NPC 질의(4단계 말 걸기용)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { EnemySoldier } from './EnemySoldier.js';
import { ZONES } from './HumanoidRig.js';
import { gameRand as R } from '../core/Random.js';

const _ray = new THREE.Raycaster();
const _sphere = new THREE.Sphere();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _hits = [];

export class NPCManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.scene = game.scene;
    this._visCursor = 0;
    this._playerNode = null;
    this._playerNodeT = 0;
    game.events.on(Events.WEAPON_FIRED, (e) => {
      if (!e.isPlayer) return;
      const r2 = CONFIG.npc.hearingRadius ** 2;
      for (const n of this.list) {
        if (n.alive && n.trueFaction === 'enemy' && n.position.distanceToSquared(e.position) < r2) n.hearShot(e.position);
      }
    });
  }

  // ------------------------------------------------------------------
  // 생성
  // ------------------------------------------------------------------
  /**
   * 적 생성. 확장 시 같은 패턴으로 spawnCivilian / spawnAlly 를 추가하면 된다.
   * @param {object} o { type, spawnPoint, entrance, goalNode, goalNodes, threat, apparentFaction }
   */
  spawnEnemy(o) {
    const sp = o.spawnPoint;
    const npc = new EnemySoldier(this.game, {
      type: o.type,
      threat: o.threat,
      entrance: o.entrance,
      nodeId: sp.nodeId,
      goalNode: o.goalNode,
      goalNodes: o.goalNodes,
      buildingId: sp.buildingId,
      apparentFaction: o.apparentFaction,
    });
    // 플레이어 쪽을 대략 바라보며 등장
    const pp = this.game.player.feet;
    npc.placeAt(sp.x, sp.y, sp.z, Math.atan2(pp.x - sp.x, pp.z - sp.z));
    npc.lastKnown.copy(pp);
    this.scene.add(npc.root);
    this.list.push(npc);
    this.game.events.emit(Events.NPC_SPAWNED, { npc, spawnPoint: sp });
    return npc;
  }

  clear() {
    for (const n of this.list) {
      if (n.coverNode && n.coverNode.reservedBy === n) n.coverNode.reservedBy = null;
      n.dispose();
    }
    this.list.length = 0;
    for (const node of this.game.world.nav.nodes) node.reservedBy = null;
  }

  countActive(faction = 'enemy') {
    let c = 0;
    for (const n of this.list) if (n.alive && n.trueFaction === faction) c++;
    return c;
  }

  get aliveList() {
    return this.list.filter((n) => n.alive);
  }

  // ------------------------------------------------------------------
  update(dt) {
    const game = this.game;
    const pp = game.player.feet;
    for (const n of this.list) {
      n.update(dt);
      // 실내 음영 + 가까운 NPC 만 그림자
      const indoor = game.world.isIndoors(n.position) ? 1 : 0;
      n._indoor = (n._indoor ?? indoor) + (indoor - (n._indoor ?? indoor)) * Math.min(1, dt * 4);
      n.rig.setInterior(n._indoor);
      n.rig.setCastShadow(n.position.distanceToSquared(pp) < 30 * 30);
    }
    // 제거
    for (let i = this.list.length - 1; i >= 0; i--) {
      const n = this.list[i];
      if (n.removed) {
        n.dispose();
        this.list.splice(i, 1);
        game.events.emit(Events.NPC_REMOVED, { npc: n });
      }
    }
    this._updateVisibility();
  }

  // 플레이어 화면에 실제로 보이는지 (프러스텀 + 가림) — 매 프레임 일부 NPC 만 검사
  _updateVisibility() {
    const game = this.game;
    const cam = game.camera;
    const list = this.list;
    if (!list.length) return;
    _pm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    _frustum.setFromProjectionMatrix(_pm);
    const per = Math.max(1, Math.ceil(list.length / 3));
    for (let k = 0; k < per; k++) {
      const n = list[this._visCursor++ % list.length];
      if (!n.alive) {
        n.visibleToPlayer = false;
        continue;
      }
      n.getChestPosition(_v);
      _sphere.set(_v, 0.9);
      let vis = false;
      if (_frustum.intersectsSphere(_sphere) && _v.distanceTo(cam.position) < 140) {
        n.getHeadPosition(_w);
        vis = game.world.hasLineOfSight(cam.position, _w) || game.world.hasLineOfSight(cam.position, _v);
      }
      n.visibleToPlayer = vis;
      if (vis) {
        if (n.firstSeenAt == null) n.firstSeenAt = game.time;
        n.lastSeenAt = game.time;
      }
    }
  }

  // ------------------------------------------------------------------
  // 히트박스 레이캐스트 (머리/몸통/팔/다리)
  // ------------------------------------------------------------------
  raycast(origin, dir, maxDist) {
    _ray.set(origin, dir);
    _ray.near = 0;
    _ray.far = maxDist;
    let best = null;
    for (const n of this.list) {
      if (!n.alive) continue;
      // 1차: 경계 구
      n.getChestPosition(_v);
      _v.y -= 0.3;
      _sphere.set(_v, 1.25);
      if (!_ray.ray.intersectsSphere(_sphere)) continue;
      n.root.updateMatrixWorld(true);
      _hits.length = 0;
      const meshes = n.rig.hitMeshes.concat(n.insignia.hitMeshes());
      _ray.intersectObjects(meshes, false, _hits);
      for (const h of _hits) {
        // 소총 등 판정 없는 파츠는 통과
        const zones = h.object.geometry.userData.zones;
        const zone = zones && h.face ? ZONES[zones[h.face.a]] : 'torso';
        if (zone === 'none') continue;
        if (!best || h.distance < best.distance) best = { npc: n, zone, point: h.point.clone(), distance: h.distance };
        break;
      }
    }
    return best;
  }

  /**
   * 플레이어가 조준 중인 NPC 와 거리 (4단계 말 걸기용)
   * coneDeg > 0 이면 정확히 겨누지 않아도 원뿔 안의 가장 가까운 각도의 NPC 를 반환
   * @returns {null | { npc, distance }}
   */
  getAimedNPC({ maxDistance = 60, coneDeg = 0, includeDead = false } = {}) {
    const game = this.game;
    const cam = game.camera;
    const dir = cam.getWorldDirection(new THREE.Vector3());
    const world = game.world.raycast(cam.position, dir, maxDistance);
    const limit = world ? world.distance : maxDistance;
    const hit = this.raycast(cam.position, dir, limit);
    if (hit) return { npc: hit.npc, distance: hit.distance };
    if (coneDeg <= 0) return null;
    let best = null;
    let bestAng = THREE.MathUtils.degToRad(coneDeg);
    for (const n of this.list) {
      if (!includeDead && !n.alive) continue;
      n.getChestPosition(_v);
      const d = _v.distanceTo(cam.position);
      if (d > maxDistance) continue;
      _w.subVectors(_v, cam.position).normalize();
      const ang = Math.acos(THREE.MathUtils.clamp(_w.dot(dir), -1, 1));
      if (ang < bestAng && game.world.hasLineOfSight(cam.position, _v)) {
        bestAng = ang;
        best = { npc: n, distance: d };
      }
    }
    return best;
  }

  // ------------------------------------------------------------------
  // 전술 지점 선택
  // ------------------------------------------------------------------
  playerNode() {
    const game = this.game;
    if (game.time - this._playerNodeT > 0.5 || this._playerNode == null) {
      const f = game.player.feet;
      const n = game.world.nav.nearest(f.x, f.y, f.z, null, 24);
      this._playerNode = n ? n.id : null;
      this._playerNodeT = game.time;
    }
    return this._playerNode;
  }

  nearestNodeToPlayer(npc, dist) {
    const f = this.game.player.feet;
    const nav = this.game.world.nav;
    const cands = nav.inRadius(f.x, f.y, f.z, dist + 6, (n) => !n.indoor || n.buildingId === npc.buildingId);
    const good = cands.filter((n) => {
      const d = Math.hypot(n.x - f.x, n.z - f.z);
      return d > dist * 0.5 && d < dist + 6;
    });
    if (!good.length) return null;
    return R.pick(good).id;
  }

  /**
   * 엄폐 지점 찾기
   * advance: 플레이어에게 더 다가가는 쪽 선호, flank: 현재 각도에서 크게 벗어난 지점 선호(측면 우회)
   */
  findCover(npc, { advance = false, flank = false } = {}) {
    const game = this.game;
    const nav = game.world.nav;
    const pf = game.player.feet;
    const [minR, maxR] = npc.tcfg.preferredRange;
    const pref = advance ? minR + (maxR - minR) * 0.35 : (minR + maxR) / 2;
    const search = Math.max(30, npc.position.distanceTo(pf) + 6);
    const cands = nav.inRadius(npc.position.x, 0, npc.position.z, search, (n) => n.type === 'cover' && (n.reservedBy == null || n.reservedBy === npc));
    const npcAng = Math.atan2(npc.position.z - pf.z, npc.position.x - pf.x);
    const scored = [];
    for (const n of cands) {
      const dx = pf.x - n.x;
      const dz = pf.z - n.z;
      const d = Math.hypot(dx, dz);
      if (d < Math.max(5, minR * 0.6) || d > maxR + 8) continue;
      const prot = n.coverDir ? (n.coverDir.x * dx + n.coverDir.z * dz) / d : 0;
      if (prot < 0.45) continue;
      // 다른 NPC 와 너무 가까우면 감점
      let crowd = 0;
      for (const o of this.list) if (o !== npc && o.alive && Math.hypot(o.position.x - n.x, o.position.z - n.z) < 2.5) crowd++;
      let score = -Math.abs(d - pref) - npc.position.distanceTo(_v.set(n.x, n.y, n.z)) * 0.3 + prot * 4 + R.range(0, 3) - crowd * 5;
      if (flank) {
        const a = Math.atan2(n.z - pf.z, n.x - pf.x);
        let da = Math.abs(Math.atan2(Math.sin(a - npcAng), Math.cos(a - npcAng)));
        score += THREE.MathUtils.radToDeg(da) / 8;
        if (da < 0.7) score -= 10;
      }
      scored.push({ n, score });
    }
    scored.sort((a, b) => b.score - a.score);
    for (let i = 0; i < Math.min(4, scored.length); i++) {
      const n = scored[i].n;
      if (nav.findPath(npc.navNode, n.id, { maxIter: 3000 })) return n;
    }
    return null;
  }

  // 창가·옥상 자리 고르기 (같은 건물, 플레이어 쪽을 향한 곳)
  pickPostNode(npc, candidates) {
    const game = this.game;
    const nav = game.world.nav;
    const pf = game.player.feet;
    let list = candidates;
    if (!list) {
      const b = game.world.enterable.find((e) => e.id === npc.buildingId);
      if (!b) return null;
      list = b.windowNodes.map((w) => w.id).concat(b.roofNodes);
    }
    let best = null;
    let bestScore = -Infinity;
    for (const id of list) {
      const n = nav.get(id);
      if (!n || n.removed || (n.reservedBy && n.reservedBy !== npc && n.reservedBy.alive)) continue;
      if (!n.out) continue;
      const dx = pf.x - n.x;
      const dz = pf.z - n.z;
      const d = Math.hypot(dx, dz) || 1;
      const facing = (n.out.x * dx + n.out.z * dz) / d;
      if (facing < 0.25) continue;
      let crowd = 0;
      for (const o of this.list) if (o !== npc && o.alive && Math.hypot(o.position.x - n.x, o.position.z - n.z) < 2) crowd++;
      const score = facing * 3 - Math.abs(d - 25) * 0.05 + R.range(0, 1.5) - crowd * 4 - (id === npc.goalNode ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = id;
      }
    }
    return best;
  }
}
