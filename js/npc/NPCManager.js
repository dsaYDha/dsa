// NPC 관리 — 생성(적·아군 분대·민간인·위장 적)·갱신·제거, 부위별 히트박스 레이캐스트, 엄폐/창가/은신/대피 지점 선택,
// 플레이어 화면 노출 추적(firstSeenAt), 조준 중인 NPC 질의(4단계 말 걸기용), 진영별 목록(진짜/겉보기), 청각(총성)·공황·무전 전파
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { EnemySoldier } from './EnemySoldier.js';
import { AllySoldier } from './AllySoldier.js';
import { AllySquad } from './AllySquad.js';
import { CivilianNPC } from './CivilianNPC.js';
import { ZONES } from './HumanoidRig.js';
import { rollDisguiseProfile, disguiseOutfit } from './Disguise.js';
import { gameRand as R } from '../core/Random.js';

const _ray = new THREE.Raycaster();
const _sphere = new THREE.Sphere();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _frustum = new THREE.Frustum();
const _pm = new THREE.Matrix4();
const _hits = [];
const _meshes = [];
const _dir = new THREE.Vector3();

export class NPCManager {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.scene = game.scene;
    this._visCursor = 0;
    this._playerNode = null;
    this._playerNodeT = 0;
    this.squads = [];
    this.factions = { enemy: [], ally: [], civilian: [] }; // 진짜 소속 (trueFaction)
    this.apparent = { enemy: [], ally: [], civilian: [] }; // 겉보기 소속 — 아군·민간인 AI 는 이것만 본다
    this._aimT = 0;
    this._evacNodes = null;
    this.shadowDist = 30; // 그래픽 프리셋: 그림자를 드리우는 NPC 거리 (0 = 끔)
    this.lodStats = { full: 0, half: 0, third: 0 };
    game.events.on(Events.WEAPON_FIRED, (e) => {
      // 적은 플레이어 총성을 듣고, 민간인은 모든 총성에 반응
      const r2 = CONFIG.npc.hearingRadius ** 2;
      const c2 = CONFIG.civilian.hearRadius ** 2;
      for (const n of this.list) {
        if (!n.alive) continue;
        const d2 = n.position.distanceToSquared(e.position);
        if (n.disguised) {
          // 위장 중인 적: 민간인처럼 보이면 총성에 웅크리는 척하거나(성향에 따라) 웅크리지 않음
          if (d2 < c2 && e.shooter !== n) n.onGunfire(e.position, Math.sqrt(d2));
        } else if (e.isPlayer && n.trueFaction === 'enemy' && d2 < r2) n.hearShot(e.position);
        else if (n.trueFaction === 'civilian' && d2 < c2 && e.shooter !== n) n.hearDanger(e.position, Math.sqrt(d2));
      }
    });
  }

  // 진영별 생존 목록 (프레임마다 갱신) — 진짜 소속
  byFaction(f) {
    return this.factions[f] || [];
  }

  // 겉보기 소속별 생존 목록 (위장 적은 ally/civilian 쪽에 들어감)
  byApparent(f) {
    return this.apparent[f] || [];
  }

  _rebuildFactions() {
    const F = this.factions;
    const A = this.apparent;
    for (const k of ['enemy', 'ally', 'civilian']) {
      F[k].length = 0;
      A[k].length = 0;
    }
    for (const n of this.list) {
      if (!n.alive) continue;
      if (F[n.trueFaction]) F[n.trueFaction].push(n);
      if (A[n.apparentFaction]) A[n.apparentFaction].push(n);
    }
  }

  // 아군 위치 콜아웃이 주변(플레이어 40m 안)의 아군 표식 인물에게 들림 — 반응하는지가 행동 단서
  broadcastRadio(squad, enemy) {
    for (const n of this.apparent.ally) {
      if (n.onRadioCallout && n.squad !== squad) n.onRadioCallout(enemy, squad);
    }
  }

  // 진행 방향 바로 앞에 다른 NPC 가 있는지 (겹쳐 지나가지 않게 감속)
  isBlockedAhead(npc, fx, fz) {
    const r = CONFIG.npc.yieldRadius;
    // 플레이어 몸을 뚫고 지나가지 않게
    const pf = this.game.player.feet;
    if (Math.abs(pf.y - npc.position.y) < 1.2) {
      const dx = pf.x - npc.position.x;
      const dz = pf.z - npc.position.z;
      const d = Math.hypot(dx, dz);
      if (d < r + 0.35 && d > 1e-3 && (dx * fx + dz * fz) / d > 0.55) return true;
    }
    for (const o of this.list) {
      if (o === npc || !o.alive) continue;
      const dx = o.position.x - npc.position.x;
      const dz = o.position.z - npc.position.z;
      if (Math.abs(o.position.y - npc.position.y) > 1.2) continue;
      const d2 = dx * dx + dz * dz;
      if (d2 > r * r || d2 < 1e-6) continue;
      const d = Math.sqrt(d2);
      if ((dx * fx + dz * fz) / d > 0.55) return true;
    }
    return false;
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
    npc.lastKnown.copy(this.game.player.feet);
    return this._add(npc, sp);
  }

  /**
   * 위장 적 생성 (3단계) — 겉보기는 아군(파란 표식)이나 민간인(사복), 진짜 소속은 적
   * @param {object} o { as: 'ally'|'civilian', spawnPoint, entrance, goalNode, threat, profile?, role?, infiltrate?, fromEnemySide? }
   */
  spawnDisguised(o) {
    const game = this.game;
    const sp = o.spawnPoint;
    // 5단계: 숙련도는 난이도 곡선의 시간 구간별 분포에서 (초반 숙련 0 위주 → 후반 완벽 위장 등장)
    const skill = game.difficulty.rollSkill(R);
    const profile = o.profile || rollDisguiseProfile(o.as, o.threat || game.director.threat, { role: o.role, infiltrate: o.infiltrate, fromEnemySide: o.fromEnemySide, skill });
    const npc = new EnemySoldier(game, {
      type: o.as === 'civilian' ? 'assault' : R.chance(0.5) ? 'assault' : 'rifleman',
      threat: o.threat || game.director.threat,
      entrance: o.entrance,
      nodeId: sp.nodeId,
      goalNode: o.goalNode,
      buildingId: sp.buildingId,
      apparentFaction: profile.as,
      outfit: disguiseOutfit(profile),
      disguise: profile,
    });
    if (profile.gear.includes('tapeBand')) {
      npc.insignia.setColor(CONFIG.insignia.tapeColor);
      npc.insignia.setShape('tape');
    }
    npc.lastKnown.copy(game.player.feet);
    this._add(npc, sp);
    this._noteSpawnSide(npc);
    game.events.emit(Events.DISGUISE_SPAWNED, { npc, profile });
    return npc;
  }

  // 아군 표식 인물이 적이 있던 쪽(교전 중인 빨간 표식 25m 안)에서 나타났으면 기록 — 진짜 아군도 마찬가지
  _noteSpawnSide(npc) {
    if (npc.apparentFaction !== 'ally') return;
    for (const e of this.apparent.enemy) {
      if (e.position.distanceToSquared(npc.position) < 25 * 25 && (e.aware || e.visibleToPlayer)) {
        npc.noteBehavior('fromEnemySide');
        return;
      }
    }
  }

  // 아군 분대 (2~4명): 리더는 출현 지점, 나머지는 근처 숨은 노드에서 등장
  // decoy: 'straggler'(1인 낙오병 — 플레이어에게 다가와 합류) | 'escort'(도착 뒤 분대원 하나가 동행 엄호)
  spawnAllySquad(o) {
    const game = this.game;
    const sp = o.spawnPoint;
    const size = o.decoy === 'straggler' ? 1 : Math.max(1, o.size || 3);
    const squad = new AllySquad(game);
    const leader = new AllySoldier(game, { nodeId: sp.nodeId, entrance: o.entrance, squad });
    squad.add(leader);
    this._add(leader, sp);
    this._noteSpawnSide(leader);
    if (o.decoy === 'straggler') {
      squad.straggler = true;
      leader.startJoin();
      this.squads.push(squad);
      return leader;
    }
    if (o.decoy === 'escort') squad.escortDecoyT = R.range(4, 9);
    const nav = game.world.nav;
    const near = nav.inRadius(sp.x, sp.y, sp.z, 6, (n) => n.id !== sp.nodeId && Math.abs(n.y - sp.y) < 1 && n.indoor === nav.get(sp.nodeId).indoor);
    R.shuffle(near);
    for (let i = 1; i < size; i++) {
      const n = near.find((c) => !game.director.isSpawnVisible({ x: c.x, y: c.y, z: c.z }, 'walkOut') && !this.list.some((x) => x.alive && Math.hypot(x.position.x - c.x, x.position.z - c.z) < 1.2)) || nav.get(sp.nodeId);
      const m = new AllySoldier(game, { nodeId: n.id, entrance: o.entrance, squad });
      squad.add(m);
      // 같은 노드면 살짝 비켜 세움
      this._add(m, { x: n.x + (n.id === sp.nodeId ? R.range(-0.6, 0.6) : 0), y: n.y, z: n.z + (n.id === sp.nodeId ? R.range(-0.6, 0.6) : 0), nodeId: n.id });
      const idx = near.indexOf(n);
      if (idx >= 0) near.splice(idx, 1);
    }
    for (const m of squad.members) if (m !== leader) this._noteSpawnSide(m);
    this.squads.push(squad);
    if (o.entrance === 'ambush') {
      // 돌발 조우 아군: 잠깐 뒤에야 "아군이다!" (판단을 시험하기 위해 바로 외치지 않음)
      squad.ambushShoutT = 1.2;
    } else if (o.announce) squad.onArrive();
    return leader;
  }

  // decoy: 'frozen'(총성에 얼어붙음) | 'helpSeeker'(도와달라며 다가옴) — 오판 유도용 진짜 행동
  spawnCivilian(o) {
    const sp = o.spawnPoint;
    const npc = new CivilianNPC(this.game, { nodeId: sp.nodeId, entrance: o.entrance, goalNode: o.goalNode, buildingId: sp.buildingId, decoy: o.decoy });
    return this._add(npc, sp);
  }

  _add(npc, sp) {
    // 플레이어 쪽을 대략 바라보며 등장
    const pp = this.game.player.feet;
    npc.placeAt(sp.x, sp.y, sp.z, Math.atan2(pp.x - sp.x, pp.z - sp.z));
    this.scene.add(npc.root);
    this.list.push(npc);
    if (this.factions[npc.trueFaction]) this.factions[npc.trueFaction].push(npc);
    if (this.apparent[npc.apparentFaction]) this.apparent[npc.apparentFaction].push(npc);
    this.game.events.emit(Events.NPC_SPAWNED, { npc, spawnPoint: sp });
    return npc;
  }

  clear() {
    for (const n of this.list) {
      if (n.coverNode && n.coverNode.reservedBy === n) n.coverNode.reservedBy = null;
      n.dispose();
    }
    this.list.length = 0;
    this.squads.length = 0;
    for (const k of ['enemy', 'ally', 'civilian']) this.apparent[k].length = 0;
    this._rebuildFactions();
    for (const node of this.game.world.nav.nodes) node.reservedBy = null;
    this._evacNodes = null;
  }

  countActive(faction = 'enemy') {
    let c = 0;
    for (const n of this.list) if (n.alive && n.trueFaction === faction) c++;
    return c;
  }

  // 정체를 드러내기 전의 위장 적 수
  countDisguised() {
    let c = 0;
    for (const n of this.list) if (n.alive && n.disguised) c++;
    return c;
  }

  get aliveList() {
    return this.list.filter((n) => n.alive);
  }

  // ------------------------------------------------------------------
  update(dt) {
    const game = this.game;
    const pp = game.player.feet;
    this._rebuildFactions();
    for (const sq of this.squads) {
      sq.update(dt);
      if (sq.ambushShoutT != null) {
        sq.ambushShoutT -= dt;
        if (sq.ambushShoutT <= 0) {
          sq.ambushShoutT = null;
          const m = sq.alive[0];
          if (m) game.voice.say({ speaker: m.talkLabel, text: '아군이다! 쏘지 마!', channel: 'shout', priority: 2, voice: m.voice });
        }
      }
    }
    for (let i = this.squads.length - 1; i >= 0; i--) if (this.squads[i].done) this.squads.splice(i, 1);
    this._updateAim(dt);
    const sd2 = this.shadowDist * this.shadowDist;
    const L = this.lodStats;
    L.full = L.half = L.third = 0;
    for (const n of this.list) {
      // 5단계 LOD: 가깝거나 화면에 보이는 인물은 매 프레임, 화면 밖 40m 넘으면 3프레임, 보여도 55m 넘으면 2프레임마다 애니메이션
      //   + 화면 밖 45m 넘으면 AI(think)도 2프레임에 한 번 (누적 dt)
      const d2 = n.position.distanceToSquared(pp);
      n.animEvery = d2 < 40 * 40 || (n.visibleToPlayer && d2 < 55 * 55) ? 1 : n.visibleToPlayer ? 2 : 3;
      n.thinkEvery = !n.visibleToPlayer && d2 > 45 * 45 && !(game.dialogue && game.dialogue.target === n) ? 2 : 1;
      if (n.animEvery === 1) L.full++;
      else if (n.animEvery === 2) L.half++;
      else L.third++;
      n.update(dt);
      // 실내 음영 + 가까운 NPC 만 그림자
      const indoor = game.world.isIndoors(n.position) ? 1 : 0;
      n._indoor = (n._indoor ?? indoor) + (indoor - (n._indoor ?? indoor)) * Math.min(1, dt * 4);
      n.rig.setInterior(n._indoor);
      n.rig.setCastShadow(d2 < sd2);
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
      _meshes.length = 0;
      for (const m of n.rig.hitMeshes) _meshes.push(m);
      if (n.insignia.mesh && n.insignia.mesh.visible) _meshes.push(n.insignia.mesh);
      _ray.intersectObjects(_meshes, false, _hits);
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
    const dir = cam.getWorldDirection(_dir);
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
      // 가슴이 가려져도 머리가 보이면 대상 (낮은 엄폐물 뒤에 웅크린 인물에게도 관찰·말 걸기 가능)
      if (ang < bestAng && (game.world.hasLineOfSight(cam.position, _v) || game.world.hasLineOfSight(cam.position, n.getHeadPosition(_w)))) {
        bestAng = ang;
        best = { npc: n, distance: d };
      }
    }
    return best;
  }

  // 플레이어가 가까이서 민간인(처럼 보이는 인물)을 총으로 겨누면 반응 (0.1초 주기) — 관찰 모드(총을 내림)일 땐 반응 없음
  _updateAim(dt) {
    this._aimT -= dt;
    if (this._aimT > 0) return;
    const step = 0.1;
    this._aimT = step;
    const game = this.game;
    if (!this.apparent.civilian.length || !game.player.alive) return;
    if (game.observation && game.observation.weaponDown) return;
    const a = this.getAimedNPC({ maxDistance: CONFIG.civilian.aimReactDist, coneDeg: 4 });
    if (!a || a.npc.apparentFaction !== 'civilian') return;
    // 4단계: 말을 거는 상대는 '겨눔'이 아니라 대화 중 — 손 들기 반응 없음 ("손 들어!"로 따로 시험). 위장 적은 궁지 압박만 누적
    if (game.dialogue && game.dialogue.target === a.npc) {
      if (a.npc.disguised) a.npc.ctl.onTalkAimed(step);
      return;
    }
    if (a.npc.onAimedAt) a.npc.onAimedAt(step);
  }

  // 민간인 사망 → 주변 민간인 공황 (흩어져 도망) + 디렉터에 공황 시간 통보
  onCivilianDeath(npc) {
    const C = CONFIG.civilian;
    for (const c of this.factions.civilian) {
      if (c !== npc && c.alive && c.position.distanceTo(npc.position) < C.panicRadius) c.startPanic();
    }
    if (this.game.director) this.game.director.civPanicT = C.panicTime;
  }

  // 맵 가장자리 대피 지점 (도로·골목 노드)
  get evacNodes() {
    if (!this._evacNodes) {
      const C = CONFIG;
      const inner = C.map.size / 2 - C.map.edgeMargin;
      const lim = inner - C.civilian.evacEdgeDist;
      this._evacNodes = this.game.world.nav.nodes.filter((n) => !n.removed && !n.indoor && (n.type === 'street' || n.type === 'alley' || n.type === 'yard') && Math.max(Math.abs(n.x), Math.abs(n.z)) > lim);
    }
    return this._evacNodes;
  }

  evacNodeFor(npc) {
    const nav = this.game.world.nav;
    const pp = this.game.player.feet;
    const list = this.evacNodes
      .map((n) => ({ n, d: Math.hypot(n.x - npc.position.x, n.z - npc.position.z) + (Math.hypot(n.x - pp.x, n.z - pp.z) < 15 ? 25 : 0) }))
      .sort((a, b) => a.d - b.d);
    for (let i = 0; i < Math.min(4, list.length); i++) {
      if (nav.findPath(npc.navNode, list[i].n.id, { maxIter: 4000 })) return list[i].n.id;
    }
    return null;
  }

  // 민간인 은신 목적지 (엄폐물 뒤·건물 출입구 안쪽) — dist: [최소, 최대]
  pickCivilianHideNode(npc, dist) {
    const nav = this.game.world.nav;
    const cands = nav.inRadius(npc.position.x, npc.position.y, npc.position.z, dist[1], (n) => {
      if (n.reservedBy && n.reservedBy.alive) return false;
      const d = Math.hypot(n.x - npc.position.x, n.z - npc.position.z);
      if (d < dist[0]) return false;
      return (n.type === 'cover' && !n.indoor) || (n.type === 'door' && n.floor === 0) || n.type === 'room';
    });
    R.shuffle(cands);
    for (const n of cands.slice(0, 6)) {
      if (this.list.some((o) => o !== npc && o.alive && Math.hypot(o.position.x - n.x, o.position.z - n.z) < 1.5)) continue;
      if (nav.findPath(npc.navNode, n.id, { maxIter: 3000 })) return n.id;
    }
    return null;
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
