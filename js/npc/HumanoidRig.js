// 파츠 조립식 로우폴리 인간형 — 머리, 헬멧, 상의, 조끼, 팔, 다리, 군화, 소총
// 복장(outfit)을 바꿔 끼울 수 있어 3단계 위장 복장(사복·다른 군복)에 그대로 쓰인다.
// 절차적 애니메이션: 걷기, 달리기, 조준, 사격, 피격, 사망, 앉기
// 성능: 파츠를 뼈 하나씩에 강체 스키닝해 몸 전체를 SkinnedMesh 하나(드로우콜 1)로 그린다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { patchInterior } from '../world/Materials.js';

const _c = new THREE.Color();
const IDENTITY = new THREE.Matrix4();
// 부위 코드 (정점별) — 레이캐스트 결과의 face.a 로 부위를 찾는다
export const ZONES = ['torso', 'head', 'arm', 'leg', 'none'];
const ZONE_CODE = { torso: 0, head: 1, arm: 2, leg: 3, none: 4 };
const BONE_NAMES = ['pelvis', 'spine', 'neck', 'shoulderL', 'elbowL', 'shoulderR', 'elbowR', 'hipL', 'kneeL', 'hipR', 'kneeR', 'rifleMount'];
// NPC 하나를 넉넉히 감싸는 경계 구 (애니메이션으로 모양이 바뀌어도 컬링·레이캐스트가 틀리지 않게)
const BOUNDS = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 1.6);

// 정점 색이 들어간 상자
function box(w, h, d, color, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z);
  return paint(g, color);
}

function paint(g, color) {
  _c.setHex(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    // 약간의 음영 변화
    const v = 0.92 + ((i * 7919) % 17) / 17 * 0.12;
    arr[i * 3] = _c.r * v;
    arr[i * 3 + 1] = _c.g * v;
    arr[i * 3 + 2] = _c.b * v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.index) return g.toNonIndexed();
  return g;
}

function merge(list) {
  const clean = list.map((g) => {
    const keep = new THREE.BufferGeometry();
    keep.setAttribute('position', g.attributes.position);
    keep.setAttribute('normal', g.attributes.normal);
    keep.setAttribute('color', g.attributes.color);
    return keep;
  });
  const m = mergeGeometries(clean, false);
  m.computeBoundingSphere();
  return m;
}

// 기본 복장 — 진영 정의(config.factions)에서 색을 받아 만든다 (진영별 장비 세트는 npc/Outfits.js)
// 복장 필드는 그대로 장비 데이터(npc.getEquipment)로 조회된다 — 3단계 시각 단서 판정 기준
export function defaultOutfit(faction) {
  return {
    uniform: faction.uniform ?? 0x5a5f42, // 상의 색 (사복이면 상의 색)
    vest: faction.vest ?? 0x3d4130, // null 이면 조끼 없음
    pants: faction.uniform ?? 0x5a5f42,
    skin: 0xb08066,
    boots: 0x1e1a16,
    helmet: 0x434835, // 머리 장비 색
    gloves: 0x2a2620, // 손 색 (사복은 피부색)
    hair: 0x2a1e16,
    headwear: 'helmet', // 'helmet' | 'cap' | 'beanie' | 'hat' | 'none'
    helmetStyle: 'enemy', // 'enemy'(챙 있는 둥근 헬멧) | 'ally'(낮고 넓은 헬멧 + 뒷목 가리개)
    rifle: true,
    rifleStyle: 'curved', // 'curved'(굽은 탄창·나무 개머리판) | 'straight'(직선 탄창·검은 개머리판)
    footwear: 'combat', // 'combat' | 'sneakers' | 'dress' | 'work'
    top: 'uniform', // 'uniform' | 'shirt' | 'jacket' | 'coat' | 'sweater'
    bag: null, // null | 'backpack' | 'shoulder' | 'carry'
    bagColor: 0x3a3028,
    elder: false,
  };
}

const geoCache = new Map();
const skinCache = new Map();

function headGeometry(o) {
  const head = [box(0.19, 0.22, 0.21, o.skin, 0, 0.12, 0), box(0.16, 0.03, 0.02, 0x2a1e18, 0, 0.15, 0.106)];
  if (o.headwear !== 'helmet') {
    // 머리카락 (모자 아래로도 보임)
    const hair = o.elder ? 0xa8a49c : o.hair;
    head.push(box(0.2, 0.05, 0.22, hair, 0, 0.245, -0.005), box(0.2, 0.15, 0.04, hair, 0, 0.16, -0.1));
  }
  if (o.headwear === 'helmet') {
    if (o.helmetStyle === 'ally') {
      // 아군: 낮고 넓은 헬멧, 챙 없음, 뒷목 가리개 + 앞쪽 장착대
      const hg = new THREE.SphereGeometry(0.145, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      hg.scale(1.06, 0.72, 1.12);
      hg.translate(0, 0.165, 0);
      head.push(paint(hg, o.helmet));
      head.push(box(0.24, 0.06, 0.05, o.helmet, 0, 0.15, -0.15, 0.25));
      head.push(box(0.05, 0.04, 0.025, 0x1c1d1e, 0, 0.215, 0.155));
    } else {
      // 적: 둥근 헬멧 + 둘레 챙
      const hg = new THREE.SphereGeometry(0.145, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2);
      hg.scale(1, 0.85, 1.08);
      hg.translate(0, 0.17, 0);
      head.push(paint(hg, o.helmet));
      head.push(box(0.3, 0.02, 0.32, o.helmet, 0, 0.17, 0.0));
    }
  } else if (o.headwear === 'cap') {
    head.push(box(0.21, 0.08, 0.23, o.helmet, 0, 0.25, 0), box(0.18, 0.02, 0.1, o.helmet, 0, 0.215, 0.14));
  } else if (o.headwear === 'beanie') {
    head.push(box(0.21, 0.11, 0.23, o.helmet, 0, 0.26, -0.005), box(0.215, 0.035, 0.235, o.helmet, 0, 0.215, -0.005));
  } else if (o.headwear === 'hat') {
    head.push(box(0.2, 0.1, 0.22, o.helmet, 0, 0.28, 0), box(0.34, 0.015, 0.36, o.helmet, 0, 0.235, 0));
  }
  return merge(head);
}

function rifleGeometry(style) {
  if (style === 'straight') {
    // 아군 소총: 직선 탄창, 검은 폴리머 개머리판·총열덮개, 상부 손잡이
    return merge([
      box(0.05, 0.075, 0.42, 0x232426, 0, 0, 0.05),
      box(0.028, 0.04, 0.2, 0x18191a, 0, 0.058, 0.05),
      box(0.022, 0.022, 0.38, 0x161718, 0, 0.012, 0.46),
      box(0.036, 0.16, 0.06, 0x202122, 0, -0.11, 0.14, 0.05),
      box(0.045, 0.075, 0.26, 0x1c1d1f, 0, -0.02, -0.26),
      box(0.06, 0.06, 0.2, 0x26272a, 0, 0.0, 0.33),
      box(0.034, 0.1, 0.045, 0x1c1d1f, 0, -0.07, -0.05, -0.3),
    ]);
  }
  // 적 소총: 굽은 탄창, 나무 개머리판·총열덮개
  return merge([
    box(0.05, 0.075, 0.42, 0x25262a, 0, 0, 0.05),
    box(0.024, 0.024, 0.36, 0x1a1b1d, 0, 0.012, 0.44),
    box(0.04, 0.1, 0.07, 0x2a2b2e, 0, -0.08, 0.13, 0.15),
    box(0.038, 0.1, 0.066, 0x2a2b2e, 0, -0.165, 0.175, 0.55),
    box(0.045, 0.085, 0.25, 0x5a3c26, 0, -0.025, -0.26),
    box(0.058, 0.058, 0.18, 0x5a3c26, 0, 0.0, 0.32),
    box(0.034, 0.1, 0.045, 0x5a3c26, 0, -0.07, -0.05, -0.3),
  ]);
}

function footGeometry(o) {
  switch (o.footwear) {
    case 'sneakers': // 운동화: 낮고 밝은 색 + 밑창
      return [box(0.13, 0.07, 0.26, 0xd6d3cb, 0, -0.42, 0.05), box(0.135, 0.025, 0.265, o.boots, 0, -0.455, 0.05)];
    case 'dress': // 구두: 낮고 어두운 광택
      return [box(0.12, 0.065, 0.26, 0x23160f, 0, -0.425, 0.05)];
    case 'work': // 작업화: 갈색
      return [box(0.14, 0.1, 0.25, 0x5a3a22, 0, -0.42, 0.045)];
    default: // 군화: 목이 긴 검은 군화
      return [box(0.14, 0.12, 0.25, o.boots, 0, -0.43, 0.045), box(0.135, 0.1, 0.15, o.boots, 0, -0.33, 0)];
  }
}

function buildGeometries(o) {
  const key = JSON.stringify(o);
  if (geoCache.has(key)) return geoCache.get(key);
  const G = {};
  const pelvis = [box(0.34, 0.2, 0.22, o.pants, 0, -0.02, 0), box(0.36, 0.05, 0.24, 0x2b2a24, 0, 0.07, 0)];
  if (o.top === 'coat') pelvis.push(box(0.4, 0.34, 0.27, o.uniform, 0, -0.09, 0));
  if (o.bag === 'shoulder') pelvis.push(box(0.08, 0.2, 0.24, o.bagColor, -0.22, 0.0, 0));
  G.pelvis = merge(pelvis);
  const torso = [box(0.38, 0.5, 0.22, o.uniform, 0, 0.27, 0), box(0.1, 0.08, 0.1, o.skin, 0, 0.55, 0)];
  if (o.vest != null) {
    torso.push(box(0.42, 0.34, 0.28, o.vest, 0, 0.25, 0.005));
    torso.push(box(0.09, 0.1, 0.05, o.vest, -0.12, 0.14, 0.16), box(0.09, 0.1, 0.05, o.vest, 0, 0.14, 0.16), box(0.09, 0.1, 0.05, o.vest, 0.12, 0.14, 0.16));
    torso.push(box(0.3, 0.2, 0.08, o.vest, 0, 0.3, -0.18)); // 등 배낭
  }
  if (o.top === 'jacket' || o.top === 'coat') {
    torso.push(box(0.3, 0.06, 0.24, o.uniform, 0, 0.5, 0)); // 깃
    torso.push(box(0.02, 0.44, 0.012, 0x1a1816, 0, 0.27, 0.112)); // 지퍼·여밈
  } else if (o.top === 'sweater') {
    torso.push(box(0.39, 0.05, 0.23, o.uniform, 0, 0.04, 0));
  } else if (o.top === 'shirt') {
    torso.push(box(0.16, 0.05, 0.02, 0xd8d2c4, 0, 0.5, 0.105)); // 칼라
  }
  if (o.bag === 'backpack') torso.push(box(0.3, 0.34, 0.14, o.bagColor, 0, 0.26, -0.18));
  if (o.bag === 'shoulder') torso.push(box(0.04, 0.62, 0.02, o.bagColor, 0, 0.26, 0.115, 0, 0, 0.62));
  G.torso = merge(torso);
  G.head = headGeometry(o);
  G.upperArm = merge([box(0.11, 0.3, 0.11, o.uniform, 0, -0.14, 0)]);
  G.forearm = merge([box(0.1, 0.26, 0.1, o.uniform, 0, -0.12, 0), box(0.08, 0.09, 0.08, o.gloves, 0, -0.29, 0)]);
  G.thigh = merge([box(0.15, 0.44, 0.16, o.pants, 0, -0.21, 0)]);
  G.shin = merge([box(0.13, 0.4, 0.14, o.pants, 0, -0.2, 0), ...footGeometry(o)]);
  if (o.rifle) G.rifle = rifleGeometry(o.rifleStyle);
  if (o.bag === 'carry') G.carry = merge([box(0.1, 0.24, 0.32, o.bagColor, 0, -0.47, 0.02), box(0.02, 0.08, 0.1, 0x1a1816, 0, -0.33, 0.02)]);
  geoCache.set(key, G);
  return G;
}

// 자세 보간용
const lerp = (a, b, t) => a + (b - a) * t;

// 파츠 목록 [{ bone, geo, zone }] → 하나의 스킨 지오메트리 (뼈 휴지 위치로 옮기고 skinIndex 부여)
export function buildSkinnedGeometry(parts, restOffsets) {
  const list = [];
  const zones = [];
  for (const p of parts) {
    const bi = BONE_NAMES.indexOf(p.bone);
    let g = p.geo.index ? p.geo.toNonIndexed() : p.geo.clone();
    const off = restOffsets[bi];
    g.translate(off.x, off.y, off.z);
    const n = g.attributes.position.count;
    const si = new Uint16Array(n * 4);
    const sw = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      si[i * 4] = bi;
      sw[i * 4] = 1;
      zones.push(ZONE_CODE[p.zone] ?? 0);
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
    if (!g.attributes.color) g = paint(g, 0xffffff);
    const keep = new THREE.BufferGeometry();
    for (const a of ['position', 'normal', 'color', 'skinIndex', 'skinWeight']) keep.setAttribute(a, g.attributes[a]);
    list.push(keep);
  }
  const m = mergeGeometries(list, false);
  m.userData.zones = new Uint8Array(zones);
  m.computeBoundingSphere();
  return m;
}

export class HumanoidRig {
  constructor(outfit) {
    this.outfit = { ...outfit };
    this.material = patchInterior(new THREE.MeshLambertMaterial({ vertexColors: true }), false);
    this.root = new THREE.Group();
    this.root.name = 'Humanoid';
    this.anchors = {};
    this.hitMeshes = [];
    this.mesh = null;
    this._buildSkeleton();
    this.applyOutfit(this.outfit);
    this.phase = Math.random() * 10;
    this.kick = 0;
    this.flinch = 0;
    this.flinchSide = 0;
    this.deathT = -1;
    this.deathDir = 1;
    this.castShadow = true;
  }

  _buildSkeleton() {
    const b = (x, y, z) => {
      const bone = new THREE.Bone();
      bone.position.set(x, y, z);
      return bone;
    };
    this.pelvis = b(0, 0.95, 0);
    this.spine = b(0, 0.06, 0);
    this.neck = b(0, 0.56, 0);
    this.shoulderL = b(0.245, 0.47, 0);
    this.shoulderR = b(-0.245, 0.47, 0);
    this.elbowL = b(0, -0.29, 0);
    this.elbowR = b(0, -0.29, 0);
    this.hipL = b(0.1, -0.06, 0);
    this.hipR = b(-0.1, -0.06, 0);
    this.kneeL = b(0, -0.43, 0);
    this.kneeR = b(0, -0.43, 0);
    this.rifleMount = b(0, 0, 0);
    this.root.add(this.pelvis);
    this.pelvis.add(this.spine, this.hipL, this.hipR);
    this.spine.add(this.neck, this.shoulderL, this.shoulderR, this.rifleMount);
    this.shoulderL.add(this.elbowL);
    this.shoulderR.add(this.elbowR);
    this.hipL.add(this.kneeL);
    this.hipR.add(this.kneeR);
    // 앞으로 든 팔을 안쪽으로 모으기 위해 (x 로 들어 올린 뒤 y 로 모음)
    this.shoulderL.rotation.order = 'YXZ';
    this.shoulderR.rotation.order = 'YXZ';
    this.muzzle = new THREE.Object3D();
    this.muzzle.position.set(0, 0.012, 0.64);
    this.rifleMount.add(this.muzzle);

    this.bones = BONE_NAMES.map((n) => this[n]);
    // 휴지 자세의 뼈 위치(루트 기준) — 회전이 모두 0 이므로 위치 합
    this.restOffsets = this.bones.map((bone) => {
      const v = new THREE.Vector3();
      let o = bone;
      while (o && o !== this.root) {
        v.add(o.position);
        o = o.parent;
      }
      return v;
    });
    const inverses = this.restOffsets.map((v) => new THREE.Matrix4().makeTranslation(-v.x, -v.y, -v.z));
    this.skeleton = new THREE.Skeleton(this.bones, inverses);
    this.anchors = { head: this.neck, armL: this.shoulderL, armR: this.shoulderR, torso: this.spine, rifle: this.rifleMount };
  }

  // 같은 뼈대에 붙일 스킨 메시 생성 (표식 등 다른 재질 파츠용)
  makeSkinnedMesh(geometry, material) {
    const m = new THREE.SkinnedMesh(geometry, material);
    m.bind(this.skeleton, IDENTITY);
    m.boundingSphere = BOUNDS.clone();
    return m;
  }

  boneIndex(name) {
    return BONE_NAMES.indexOf(name);
  }

  // 복장 교체 (3단계 위장용) — 같은 뼈대에 다른 파츠를 끼운다
  applyOutfit(outfit) {
    this.outfit = { ...outfit };
    const key = JSON.stringify(this.outfit);
    let geo = skinCache.get(key);
    if (!geo) {
      const G = buildGeometries(this.outfit);
      const parts = [
        { bone: 'pelvis', geo: G.pelvis, zone: 'torso' },
        { bone: 'spine', geo: G.torso, zone: 'torso' },
        { bone: 'neck', geo: G.head, zone: 'head' },
        { bone: 'shoulderL', geo: G.upperArm, zone: 'arm' },
        { bone: 'shoulderR', geo: G.upperArm, zone: 'arm' },
        { bone: 'elbowL', geo: G.forearm, zone: 'arm' },
        { bone: 'elbowR', geo: G.forearm, zone: 'arm' },
        { bone: 'hipL', geo: G.thigh, zone: 'leg' },
        { bone: 'hipR', geo: G.thigh, zone: 'leg' },
        { bone: 'kneeL', geo: G.shin, zone: 'leg' },
        { bone: 'kneeR', geo: G.shin, zone: 'leg' },
      ];
      if (this.outfit.rifle) parts.push({ bone: 'rifleMount', geo: G.rifle, zone: 'none' });
      if (G.carry) parts.push({ bone: 'elbowR', geo: G.carry, zone: 'none' });
      geo = buildSkinnedGeometry(parts, this.restOffsets);
      skinCache.set(key, geo);
    }
    if (this.mesh) {
      this.mesh.geometry = geo;
    } else {
      this.mesh = this.makeSkinnedMesh(geo, this.material);
      this.mesh.castShadow = this.castShadow !== false;
      this.mesh.receiveShadow = true;
      this.root.add(this.mesh);
    }
    this.hitMeshes = [this.mesh];
  }

  setCastShadow(v) {
    if (this.castShadow === v) return;
    this.castShadow = v;
    this.mesh.castShadow = v;
  }

  setInterior(v) {
    this.material.userData.uInterior.value = v;
  }

  getMuzzleWorld(target) {
    this.muzzle.updateWorldMatrix(true, false);
    return target.setFromMatrixPosition(this.muzzle.matrixWorld);
  }

  getHeadWorld(target) {
    this.neck.updateWorldMatrix(true, false);
    return target.set(0, 0.13, 0).applyMatrix4(this.neck.matrixWorld);
  }

  onFire() {
    this.kick = 1;
  }

  onHit(side = 0) {
    this.flinch = 1;
    this.flinchSide = side;
  }

  startDeath(dir = 1) {
    this.deathT = 0;
    this.deathDir = dir;
  }

  /**
   * p: { speed, aim(0~1), aimPitch(rad), crouch(0~1), handsUp(0~1), cower(0~1) }
   * 무장 여부는 복장(outfit.rifle), 노인 자세는 outfit.elder 로 결정
   */
  animate(dt, p) {
    const speed = p.speed || 0;
    const armed = !!this.outfit.rifle;
    const aim = armed ? p.aim || 0 : 0;
    const crouch = p.crouch || 0;
    const handsUp = p.handsUp || 0;
    const cower = p.cower || 0;
    const stoop = this.outfit.elder ? 1 : 0;
    this.kick = Math.max(0, this.kick - dt * 14);
    this.flinch = Math.max(0, this.flinch - dt * 4);

    // 사망 애니메이션
    if (this.deathT >= 0) {
      this.deathT += dt;
      const t = Math.min(1, this.deathT / 0.75);
      const e = t * t;
      const buckle = Math.min(1, this.deathT / 0.25);
      this.pelvis.position.y = 0.95 - buckle * 0.25 - e * 0.55;
      this.root.rotation.x = -this.deathDir * e * (Math.PI / 2 - 0.08);
      this.hipL.rotation.x = -buckle * 0.6 * (1 - e);
      this.hipR.rotation.x = -buckle * 0.3 * (1 - e);
      this.kneeL.rotation.x = buckle * 1.0 * (1 - e * 0.7);
      this.kneeR.rotation.x = buckle * 0.6 * (1 - e * 0.7);
      this.shoulderL.rotation.set(-0.3 - e * 1.6, 0, -0.4 * e);
      this.shoulderR.rotation.set(-0.2 - e * 1.4, 0, 0.5 * e);
      this.elbowL.rotation.x = -0.4;
      this.elbowR.rotation.x = -0.2;
      this.spine.rotation.set(0.15 * e, 0, 0);
      this.neck.rotation.set(0.3 * e * this.deathDir, 0.4 * e, 0);
      this.rifleMount.position.set(0.25 * e, 0.2, 0.3);
      this.rifleMount.rotation.set(1.2 * e, 0.6 * e, 0.8 * e);
      return;
    }

    // 걸음 주기
    const stride = speed > 3 ? 2.6 : 1.9;
    this.phase += (speed / stride) * Math.PI * 2 * dt;
    const amp = Math.min(1, speed / 4.5) * (1 - crouch * 0.5);
    const s = Math.sin(this.phase);
    const c = Math.cos(this.phase);
    const run = Math.min(1, Math.max(0, (speed - 2.5) / 2.5));

    // 다리
    const legAmp = 0.35 + amp * 0.45;
    const crouchHip = -1.15 * crouch;
    const crouchKnee = 2.3 * crouch; // 발이 지면 아래로 꺼지지 않게 무릎을 더 접음
    this.hipL.rotation.set(crouchHip + (speed > 0.1 ? s * legAmp * amp : 0), 0, 0);
    this.hipR.rotation.set(crouchHip + (speed > 0.1 ? -s * legAmp * amp : 0), 0, 0);
    this.kneeL.rotation.x = crouchKnee + (speed > 0.1 ? Math.max(0, -c) * (0.6 + run * 0.7) * amp : 0);
    this.kneeR.rotation.x = crouchKnee + (speed > 0.1 ? Math.max(0, c) * (0.6 + run * 0.7) * amp : 0);

    // 골반
    const bob = speed > 0.1 ? Math.abs(s) * 0.045 * amp : Math.sin(this.phase * 0.3) * 0.004;
    this.pelvis.position.y = 0.95 - crouch * 0.55 + bob; // 웅크리면 머리 끝 ≈1.15m (엄폐물 1.25m 이상 뒤에 숨음)
    this.pelvis.rotation.y = speed > 0.1 ? s * 0.12 * amp * (1 - aim * 0.7) : 0;

    // 상체: 달릴 때 앞으로, 앉을 때 숙임, 조준 피치, 피격 움찔
    const lean = run * 0.18 + crouch * 0.6 * (1 - aim * 0.55) + stoop * 0.2 * (1 - handsUp);
    this.spine.rotation.set(lean - (p.aimPitch || 0) * aim - this.flinch * 0.45, -this.pelvis.rotation.y, this.flinch * 0.25 * this.flinchSide);
    this.neck.rotation.set(-this.flinch * 0.5 - lean * 0.4 + (p.aimPitch || 0) * aim * 0.1, 0, 0);

    // 팔: 무장(조준 ↔ 휴대) / 비무장(자연스러운 팔 흔들기, 짐 들기)
    // 오른팔(-x 쪽)은 +y 회전, 왼팔(+x 쪽)은 -y 회전이 안쪽
    let rX;
    let rY;
    let rZ;
    let rE;
    let lX;
    let lY;
    let lZ;
    let lE;
    if (armed) {
      const swing = speed > 0.1 ? s * 0.35 * amp * (1 - aim) : 0;
      rX = lerp(-0.45 + swing * 0.5, -0.95, aim); rY = lerp(0.35, 0.55, aim); rZ = 0; rE = lerp(-1.15, -0.7, aim);
      lX = lerp(-0.7 - swing * 0.5, -1.3, aim); lY = lerp(-0.5, -0.62, aim); lZ = 0; lE = lerp(-0.9, -0.22, aim);
    } else {
      // 오른 다리가 앞으로 갈 때(-s) 오른팔은 뒤로(+)
      const sw = speed > 0.1 ? s * (0.3 + run * 0.45) * Math.min(1, speed / 2.5 + 0.3) : 0;
      rX = sw; rY = 0; rZ = -0.08; rE = -(0.15 + run * 1.0);
      lX = -sw; lY = 0; lZ = 0.08; lE = -(0.15 + run * 1.0);
      if (this.outfit.bag === 'carry') { rX = sw * 0.2; rZ = -0.16; rE = -0.05; }
    }
    // 손 들기 (항복·"쏘지 마세요")
    if (handsUp > 0) {
      rX = lerp(rX, -2.75, handsUp); rY = lerp(rY, 0, handsUp); rZ = lerp(rZ, -0.35, handsUp); rE = lerp(rE, -0.45, handsUp);
      lX = lerp(lX, -2.75, handsUp); lY = lerp(lY, 0, handsUp); lZ = lerp(lZ, 0.35, handsUp); lE = lerp(lE, -0.45, handsUp);
    }
    // 머리 감싸고 웅크리기
    if (cower > 0) {
      rX = lerp(rX, -2.45, cower); rY = lerp(rY, 0.3, cower); rZ = lerp(rZ, -0.55, cower); rE = lerp(rE, -2.2, cower);
      lX = lerp(lX, -2.45, cower); lY = lerp(lY, -0.3, cower); lZ = lerp(lZ, 0.55, cower); lE = lerp(lE, -2.2, cower);
    }
    this.shoulderR.rotation.set(rX, rY, rZ);
    this.elbowR.rotation.set(rE, 0, 0);
    this.shoulderL.rotation.set(lX, lY, lZ);
    this.elbowL.rotation.set(lE, 0, 0);
    this.rifleMount.position.set(lerp(-0.02, -0.1, aim), lerp(0.22, 0.42, aim), lerp(0.24, 0.24, aim) - this.kick * 0.05);
    this.rifleMount.rotation.set(lerp(0.55, 0, aim) - this.kick * 0.12, lerp(0.25, 0, aim), lerp(0.5, 0, aim));
  }

  dispose() {
    this.material.dispose();
  }
}
