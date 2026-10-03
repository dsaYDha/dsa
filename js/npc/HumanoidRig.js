// 파츠 조립식 로우폴리 인간형 — 머리, 헬멧, 상의, 조끼, 팔, 다리, 군화, 소총
// 복장(outfit)을 바꿔 끼울 수 있어 3단계 위장 복장(사복·다른 군복)에 그대로 쓰인다.
// 3단계 단서 파츠: 어깨 부대 패치(진짜 아군 = 파란 방패), 허리 불룩함·등 뒤 총몸 윤곽(숨긴 무기), 무전기, 조끼 끈
// 절차적 애니메이션: 걷기, 달리기, 조준, 사격, 피격, 사망, 앉기
//   + 손 숨기기(등 뒤·주머니), 얼어붙음, 표식 뜯기, 숨긴 무기 꺼내기, 무전기에 대고 말하기
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
    patch: null, // 어깨 부대 패치: 'shield'|'star'|'triangle'(진짜 아군 부대, 파란색 — config.dialogue.units) | 'square' | 'round' | null
    shirtLift: false, // 4단계: 손을 들어 옷이 올라감 (허리띠·허리춤 무기가 드러남)
    waistBulge: false, // 허리춤 불룩함 (옷 속 무기)
    backRifle: false, // 등 뒤로 비치는 총몸 윤곽
    radio: false, // 가슴의 무전기
    vestStraps: false, // 옷 위로 보이는 조끼 끈
  };
}

// 어깨 부대 패치 (팔 바깥면, 완장 아래) — side: +1 왼팔(+x), -1 오른팔(-x)
// 작고 평평해서 가까이서만 보인다. 진짜 아군은 항상 자기 부대의 파란 패치(방패·별·삼각형, 테두리 밝은 색)
const PATCH_STYLE = {
  shield: { main: 0x2858c8, rim: 0xd9cfa8 },
  star: { main: 0x2858c8, rim: 0xd9cfa8 },
  triangle: { main: 0x2858c8, rim: 0xd9cfa8 },
  square: { main: 0x4a5a32, rim: 0x1c1c1a },
  round: { main: 0x8a7a3a, rim: 0x1c1c1a },
};
function patchShape(kind, scale) {
  if (kind === 'round') return new THREE.CircleGeometry(0.031 * scale, 10);
  const sh = new THREE.Shape();
  if (kind === 'star') {
    for (let i = 0; i < 10; i++) {
      const r = (i % 2 ? 0.016 : 0.038) * scale;
      const a = Math.PI / 2 + (i * Math.PI) / 5;
      if (i === 0) sh.moveTo(Math.cos(a) * r, Math.sin(a) * r);
      else sh.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    sh.closePath();
  } else if (kind === 'triangle') {
    sh.moveTo(0, 0.038 * scale); sh.lineTo(0.035 * scale, -0.024 * scale); sh.lineTo(-0.035 * scale, -0.024 * scale); sh.closePath();
  } else if (kind === 'square') {
    const h = 0.029 * scale;
    sh.moveTo(-h, h); sh.lineTo(h, h); sh.lineTo(h, -h); sh.lineTo(-h, -h); sh.closePath();
  } else {
    const w = 0.028 * scale;
    sh.moveTo(-w, 0.034 * scale); sh.lineTo(w, 0.034 * scale); sh.lineTo(w, -0.006 * scale);
    sh.lineTo(0, -0.04 * scale); sh.lineTo(-w, -0.006 * scale); sh.closePath();
  }
  return new THREE.ShapeGeometry(sh);
}
function patchGeometry(kind, side) {
  const st = PATCH_STYLE[kind];
  if (!st) return [];
  const out = [];
  // 팔 바깥면에서 앞쪽으로 약간(24°) 돌려 붙임 — 옆·비스듬한 각도에서 잘 보이고 정면에선 거의 안 보임
  const yaw = side > 0 ? Math.PI / 2 - 0.42 : -Math.PI / 2 + 0.42;
  for (const [scale, color, off] of [[1.38, st.rim, 0.0625], [1.12, st.main, 0.0645]]) {
    const g = patchShape(kind, scale);
    g.rotateY(yaw);
    g.translate(side * off, -0.215, 0.012);
    out.push(paint(g, color));
  }
  return out;
}

// 색을 어둡게 (옷 속에서 불룩 튀어나온 부분)
function shade(color, k) {
  _c.setHex(color).multiplyScalar(k);
  return _c.getHex();
}

// 스킨 지오메트리 캐시 — 같은 복장(키)의 인물은 지오메트리 하나를 함께 쓴다 (참조 수 관리)
// 5단계: 사복 조합은 사실상 무한해서 캐시가 계속 커지던 문제 → 아무도 안 쓰는 지오메트리는 최근 것 몇 개만 남기고 dispose
const skinCache = new Map(); // key → { geo, refs, idleAt }
const IDLE_KEEP = 24; // 참조 0 인 채로 남겨 둘 최대 수 (군복처럼 자주 다시 쓰는 복장을 매번 다시 만들지 않게)
let idleSeq = 0;

function acquireSkin(key, build) {
  let e = skinCache.get(key);
  if (!e) {
    e = { geo: build(), refs: 0, idleAt: 0 };
    skinCache.set(key, e);
  }
  e.refs++;
  return e.geo;
}

function releaseSkin(key) {
  const e = skinCache.get(key);
  if (!e) return;
  e.refs = Math.max(0, e.refs - 1);
  if (e.refs > 0) return;
  e.idleAt = ++idleSeq;
  let idle = 0;
  for (const v of skinCache.values()) if (v.refs === 0) idle++;
  if (idle <= IDLE_KEEP) return;
  // 가장 오래 쉬고 있던 것부터 정리
  const list = [];
  for (const [k, v] of skinCache) if (v.refs === 0) list.push([k, v]);
  list.sort((a, b) => a[1].idleAt - b[1].idleAt);
  for (let i = 0; i < list.length - IDLE_KEEP; i++) {
    list[i][1].geo.dispose();
    skinCache.delete(list[i][0]);
  }
}

/** 디버그·테스트: 캐시 상태 { entries, inUse, idle } */
export function skinCacheStats() {
  let inUse = 0;
  for (const v of skinCache.values()) if (v.refs > 0) inUse++;
  return { entries: skinCache.size, inUse, idle: skinCache.size - inUse };
}

// NPC 재질 풀 — 인물마다 실내 음영·노란 윤곽 유니폼이 따로 필요해 재질을 하나씩 쓰지만,
// 지우지 않고 돌려 써서 (1) 메모리가 늘지 않고 (2) 모든 인물이 사라져도 셰이더 프로그램이 해제·재컴파일되지 않게 한다
const rigMatPool = [];
function acquireRigMaterial() {
  const m = rigMatPool.pop() || patchInterior(new THREE.MeshLambertMaterial({ vertexColors: true }), false);
  m.userData.uInterior.value = 0;
  m.userData.uHighlight.value.setRGB(0, 0, 0);
  return m;
}
function releaseRigMaterial(m) {
  if (rigMatPool.length < 64) rigMatPool.push(m);
  else m.dispose();
}

// 4단계: 신분증 소품 (보여줄 때만 오른손에 붙는 작은 판, 모든 인물이 같은 모양 — 위조 신분증도 겉보기는 같다)
let CARD = null;
function cardAssets() {
  if (CARD) return CARD;
  const cv = document.createElement('canvas');
  cv.width = 128;
  cv.height = 82;
  const x = cv.getContext('2d');
  x.fillStyle = '#e6e1d2';
  x.fillRect(0, 0, 128, 82);
  x.fillStyle = '#3b5a86';
  x.fillRect(0, 0, 128, 16);
  x.fillStyle = '#f2efe6';
  x.font = 'bold 11px sans-serif';
  x.fillText('주 민 등 록 증', 30, 12);
  x.fillStyle = '#8c7a68';
  x.fillRect(8, 22, 32, 42);
  x.fillStyle = '#5a4a3e';
  x.beginPath();
  x.arc(24, 36, 8, 0, Math.PI * 2);
  x.fill();
  x.fillRect(13, 46, 22, 18);
  x.fillStyle = '#6f6a60';
  for (let i = 0; i < 4; i++) x.fillRect(48, 26 + i * 10, 64 - i * 8, 4);
  x.strokeStyle = '#c0392b';
  x.lineWidth = 2;
  x.beginPath();
  x.arc(108, 66, 8, 0, Math.PI * 2);
  x.stroke();
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const geo = new THREE.PlaneGeometry(0.115, 0.074); // 실물(8.6×5.4cm)보다 조금 크게 — 몇 m 떨어져서도 보이게
  geo.rotateX(Math.PI / 2); // 팔을 앞으로 들면 앞쪽(보는 사람)을 향함
  CARD = { geo, mat: new THREE.MeshLambertMaterial({ map: tex, side: THREE.DoubleSide }) };
  return CARD;
}

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

export function rifleGeometry(style) {
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

// 파츠별 지오메트리 (스킨 지오메트리를 만들 때만 쓰고 버림 — 캐시하지 않음)
function buildGeometries(o) {
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
  // 3단계 단서: 옷 속 무기 (허리춤 불룩함 / 등 뒤 총몸 윤곽 + 옷자락 아래로 삐져나온 개머리판·위로 보이는 총구)
  if (o.waistBulge) torso.push(box(0.15, 0.12, 0.09, shade(o.uniform, 0.72), -0.11, 0.07, 0.13));
  if (o.backRifle) {
    torso.push(box(0.08, 0.64, 0.06, shade(o.uniform, 0.7), 0.04, 0.25, -0.137, 0, 0, 0.35));
    torso.push(box(0.03, 0.13, 0.03, 0x1d1e20, -0.085, 0.64, -0.137, 0, 0, 0.35)); // 어깨 위로 보이는 총구
    torso.push(box(0.055, 0.1, 0.055, 0x4a3422, 0.155, -0.07, -0.137, 0, 0, 0.35)); // 옷자락 아래 개머리판
  }
  if (o.radio) {
    torso.push(box(0.062, 0.1, 0.036, 0x262724, 0.12, 0.37, 0.13));
    torso.push(box(0.03, 0.02, 0.006, 0x6a6a60, 0.12, 0.395, 0.149)); // 스피커 망
    torso.push(box(0.011, 0.15, 0.011, 0x111111, 0.138, 0.49, 0.13)); // 안테나
  }
  if (o.vestStraps) {
    const sc = 0x3b3f2c;
    for (const sx of [-0.09, 0.09]) {
      torso.push(box(0.04, 0.46, 0.014, sc, sx, 0.3, 0.115), box(0.04, 0.46, 0.014, sc, sx, 0.3, -0.115), box(0.04, 0.014, 0.23, sc, sx, 0.528, 0));
    }
    torso.push(box(0.26, 0.03, 0.014, sc, 0, 0.36, 0.117));
  }
  // 4단계: 손을 들어 옷이 올라가면 허리띠가 드러나고, 허리춤에 숨긴 무기가 있으면 권총 손잡이·권총집이 보인다
  if (o.shirtLift && o.top !== 'uniform') {
    torso.push(box(0.392, 0.04, 0.232, 0x2a2018, 0, 0.03, 0));
    torso.push(box(0.05, 0.035, 0.012, 0x8a7a5a, 0, 0.03, 0.117)); // 버클
    if (o.waistBulge) {
      torso.push(box(0.07, 0.11, 0.06, 0x2a2622, -0.11, 0.035, 0.15)); // 권총집
      torso.push(box(0.038, 0.1, 0.045, 0x141414, -0.11, 0.12, 0.165, -0.25, 0, 0)); // 손잡이
    }
  }
  G.torso = merge(torso);
  G.head = headGeometry(o);
  const arm = () => box(0.11, 0.3, 0.11, o.uniform, 0, -0.14, 0);
  G.upperArmL = merge([arm(), ...patchGeometry(o.patch, 1)]);
  G.upperArmR = merge([arm(), ...patchGeometry(o.patch, -1)]);
  G.forearm = merge([box(0.1, 0.26, 0.1, o.uniform, 0, -0.12, 0), box(0.08, 0.09, 0.08, o.gloves, 0, -0.29, 0)]);
  G.thigh = merge([box(0.15, 0.44, 0.16, o.pants, 0, -0.21, 0)]);
  G.shin = merge([box(0.13, 0.4, 0.14, o.pants, 0, -0.2, 0), ...footGeometry(o)]);
  if (o.rifle) G.rifle = rifleGeometry(o.rifleStyle);
  if (o.bag === 'carry') G.carry = merge([box(0.1, 0.24, 0.32, o.bagColor, 0, -0.47, 0.02), box(0.02, 0.08, 0.1, 0x1a1816, 0, -0.33, 0.02)]);
  return G;
}

// 자세 보간용
const lerp = (a, b, t) => a + (b - a) * t;

// 파츠 목록 [{ bone, geo, zone }] → 하나의 스킨 지오메트리 (뼈 휴지 위치로 옮기고 skinIndex 부여)
export function buildSkinnedGeometry(parts, restOffsets) {
  const list = [];
  const zones = [];
  // uv 는 모든 파츠에 있을 때만 유지 (표식의 색각 보조 무늬용 — 몸 파츠는 uv 없음)
  const attrs = ['position', 'normal', 'color', 'skinIndex', 'skinWeight'];
  if (parts.every((p) => p.geo.attributes.uv)) attrs.push('uv');
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
    for (const a of attrs) keep.setAttribute(a, g.attributes[a]);
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
    this.material = acquireRigMaterial();
    this._skinKey = null;
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
    if (key === this._skinKey && this.mesh) return;
    const geo = acquireSkin(key, () => {
      const G = buildGeometries(this.outfit);
      const parts = [
        { bone: 'pelvis', geo: G.pelvis, zone: 'torso' },
        { bone: 'spine', geo: G.torso, zone: 'torso' },
        { bone: 'neck', geo: G.head, zone: 'head' },
        { bone: 'shoulderL', geo: G.upperArmL, zone: 'arm' },
        { bone: 'shoulderR', geo: G.upperArmR, zone: 'arm' },
        { bone: 'elbowL', geo: G.forearm, zone: 'arm' },
        { bone: 'elbowR', geo: G.forearm, zone: 'arm' },
        { bone: 'hipL', geo: G.thigh, zone: 'leg' },
        { bone: 'hipR', geo: G.thigh, zone: 'leg' },
        { bone: 'kneeL', geo: G.shin, zone: 'leg' },
        { bone: 'kneeR', geo: G.shin, zone: 'leg' },
      ];
      if (this.outfit.rifle) parts.push({ bone: 'rifleMount', geo: G.rifle, zone: 'none' });
      if (G.carry) parts.push({ bone: 'elbowR', geo: G.carry, zone: 'none' });
      return buildSkinnedGeometry(parts, this.restOffsets);
    });
    if (this._skinKey) releaseSkin(this._skinKey);
    this._skinKey = key;
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
    if (this.material) this.material.userData.uInterior.value = v;
  }

  // 4단계: 신분증을 손에 듦 (처음 쓸 때 만들어 오른 팔뚝 뼈에 붙임 — 보일 때만 드로우콜 1)
  setCard(visible) {
    if (visible && !this.card) {
      const c = cardAssets();
      this.card = new THREE.Mesh(c.geo, c.mat);
      this.card.position.set(0, -0.36, 0.01);
      this.card.rotation.y = 0.15;
      this.elbowR.add(this.card);
    }
    if (this.card) this.card.visible = visible;
  }

  // 관찰 모드 노란 윤곽 (0 이면 끔)
  setHighlight(intensity) {
    const u = this.material && this.material.userData.uHighlight;
    if (!u) return;
    if (intensity <= 0) u.value.setRGB(0, 0, 0);
    else u.value.setRGB(1.0 * intensity, 0.78 * intensity, 0.12 * intensity);
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
   * p: { speed, aim(0~1), aimPitch(rad), crouch(0~1), handsUp(0~1), cower(0~1),
   *      hideHands(0~1), handsMode('back'|'pocket'), shock(0~1), tear(0~1), reach(0~1), radioTalk(0~1),
   *      handsLag(0~1: 오른손만 늦게 듦), lowered(0~1: 총구를 내림), showCard(0~1: 신분증을 내밂) }
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
    // 4단계: 총구를 내림 ("총 내려!") — 소총을 몸 앞 아래로 늘어뜨림
    const lowered = armed ? (p.lowered || 0) : 0;
    if (lowered > 0) {
      rX = lerp(rX, -0.2, lowered); rY = lerp(rY, 0.25, lowered); rE = lerp(rE, -0.55, lowered);
      lX = lerp(lX, -0.35, lowered); lY = lerp(lY, -0.35, lowered); lE = lerp(lE, -0.75, lowered);
    }
    // 손 들기 (항복·"쏘지 마세요") — handsLag: 오른손만 늦게 올라옴 (4단계 위장 적 단서)
    if (handsUp > 0) {
      const hr = handsUp * (1 - (p.handsLag || 0));
      rX = lerp(rX, -2.75, hr); rY = lerp(rY, 0, hr); rZ = lerp(rZ, -0.35, hr); rE = lerp(rE, -0.45, hr);
      lX = lerp(lX, -2.75, handsUp); lY = lerp(lY, 0, handsUp); lZ = lerp(lZ, 0.35, handsUp); lE = lerp(lE, -0.45, handsUp);
    }
    // 4단계: 신분증을 앞으로 내밂
    const card = (p.showCard || 0) * (1 - handsUp);
    if (card > 0) {
      rX = lerp(rX, -1.3, card); rY = lerp(rY, 0.2, card); rZ = lerp(rZ, -0.05, card); rE = lerp(rE, -0.5, card);
    }
    // 머리 감싸고 웅크리기
    if (cower > 0) {
      rX = lerp(rX, -2.45, cower); rY = lerp(rY, 0.3, cower); rZ = lerp(rZ, -0.55, cower); rE = lerp(rE, -2.2, cower);
      lX = lerp(lX, -2.45, cower); lY = lerp(lY, -0.3, cower); lZ = lerp(lZ, 0.55, cower); lE = lerp(lE, -2.2, cower);
    }
    // 3단계 행동 단서 자세
    const hide = (p.hideHands || 0) * (1 - handsUp);
    if (hide > 0) {
      if (p.handsMode === 'pocket') {
        // 주머니에 손: 손이 바지 앞쪽에 파묻혀 안 보임
        rX = lerp(rX, -0.06, hide); rY = lerp(rY, 0, hide); rZ = lerp(rZ, 0.14, hide); rE = lerp(rE, -0.18, hide);
        lX = lerp(lX, -0.06, hide); lY = lerp(lY, 0, hide); lZ = lerp(lZ, -0.14, hide); lE = lerp(lE, -0.18, hide);
      } else {
        // 등 뒤로 손: 앞에서 보면 손이 몸 뒤에 가려짐
        rX = lerp(rX, 0.55, hide); rY = lerp(rY, 0, hide); rZ = lerp(rZ, 0.16, hide); rE = lerp(rE, -0.35, hide);
        lX = lerp(lX, 0.55, hide); lY = lerp(lY, 0, hide); lZ = lerp(lZ, -0.16, hide); lE = lerp(lE, -0.35, hide);
      }
    }
    const shock = (p.shock || 0) * (1 - handsUp);
    if (shock > 0) {
      // 충격으로 얼어붙음: 두 손을 가슴에 모으고 굳음 (웅크리지 않음)
      rX = lerp(rX, -0.55, shock); rY = lerp(rY, 0.35, shock); rZ = lerp(rZ, 0.3, shock); rE = lerp(rE, -1.95, shock);
      lX = lerp(lX, -0.55, shock); lY = lerp(lY, -0.35, shock); lZ = lerp(lZ, -0.3, shock); lE = lerp(lE, -1.95, shock);
    }
    const tear = p.tear || 0;
    if (tear > 0) {
      // 왼손을 가슴 앞으로 가로질러 오른팔 완장을 뜯음
      lX = lerp(lX, -1.3, tear); lY = lerp(lY, -0.95, tear); lZ = lerp(lZ, -0.25, tear); lE = lerp(lE, -1.15, tear);
    }
    const reach = p.reach || 0;
    if (reach > 0) {
      // 오른손을 등 뒤 옷 속으로 (숨긴 총 꺼내기)
      rX = lerp(rX, 0.8, reach); rY = lerp(rY, 0, reach); rZ = lerp(rZ, 0.38, reach); rE = lerp(rE, -1.05, reach);
    }
    const talk = p.radioTalk || 0;
    if (talk > 0) {
      // 왼손을 귀·입가로 (무전기에 대고 말함)
      lX = lerp(lX, -1.55, talk); lY = lerp(lY, -0.45, talk); lZ = lerp(lZ, 0.2, talk); lE = lerp(lE, -2.35, talk);
    }
    this.shoulderR.rotation.set(rX, rY, rZ);
    this.elbowR.rotation.set(rE, 0, 0);
    this.shoulderL.rotation.set(lX, lY, lZ);
    this.elbowL.rotation.set(lE, 0, 0);
    this.rifleMount.position.set(lerp(lerp(-0.02, -0.1, aim), -0.04, lowered), lerp(lerp(0.22, 0.42, aim), 0.1, lowered), lerp(0.24, 0.26, lowered) - this.kick * 0.05);
    this.rifleMount.rotation.set(lerp(lerp(0.55, 0, aim) - this.kick * 0.12, 1.2, lowered), lerp(lerp(0.25, 0, aim), 0.08, lowered), lerp(lerp(0.5, 0, aim), 0.12, lowered));
  }

  // 5단계: 지오메트리 참조 반환 + 뼈 텍스처(GPU) 해제 + 재질은 풀로 — 장시간·반복 재시작에도 메모리가 늘지 않게
  dispose() {
    if (this._skinKey) releaseSkin(this._skinKey);
    this._skinKey = null;
    this.skeleton.dispose();
    this.setHighlight(0);
    releaseRigMaterial(this.material);
    this.material = null;
  }
}
