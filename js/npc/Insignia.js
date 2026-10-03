// 표식 컴포넌트 — 몸에 붙은 실제 물체(양팔 완장 + 헬멧 띠). 색과 형태를 바꿀 수 있다.
// 3단계 위장 적: setColor(아군 파랑) / setShape('none') 으로 겉보기 소속을 바꾼다.
//   'tape' = 급조한 테이프 완장 (비스듬히 두 겹으로 엉성하게 감기고 끝이 늘어짐, 색도 진짜보다 하늘빛) — 장비 단서
// 살짝 발광(emissive)해 30~40m 에서도 보이지만, 일반 깊이 판정이라 벽 너머로는 보이지 않는다.
// 렌더링: 리그와 같은 뼈대를 쓰는 SkinnedMesh 하나 (드로우콜 1)
// 5단계 색각 보조(설정): 표식에 무늬를 겹친다 — 빨간 표식(적) = X 무늬, 파란 표식(아군) = 세로 줄무늬.
//   위장 적의 파란 표식·테이프도 아군 무늬를 그대로 흉내 낸다 (무늬는 '색'을 대신할 뿐 판정을 돕지 않음)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { patchInterior } from '../world/Materials.js';
import { buildSkinnedGeometry } from './HumanoidRig.js';

const cache = new Map();

// uv.x 를 '무늬 칸 수'만큼 늘려 둔다 (셰이더는 fract(uv.x) 를 한 칸으로 씀 — 부위마다 칸 크기가 비슷하게)
function ring(rTop, rBottom, h, y, zScale = 1, tiltZ = 0, tiltX = 0, cells = 5) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, 12, 1, true).toNonIndexed();
  g.scale(1, 1, zScale);
  if (tiltZ) g.rotateZ(tiltZ);
  if (tiltX) g.rotateX(tiltX);
  g.translate(0, y, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * cells);
  return g;
}

// 늘어진 테이프 끝
function flap(x, y, z, rz = 0) {
  const g = new THREE.BoxGeometry(0.028, 0.065, 0.006).toNonIndexed();
  g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
}

// ---------------------------------------------------------------------
// 색각 보조 무늬 + 재질 풀
// ---------------------------------------------------------------------
let patternsOn = false;
const live = new Set();

/** 설정: 색각 보조 무늬 켜기/끄기 (살아 있는 모든 표식에 바로 반영) */
export function setColorblindPatterns(on) {
  patternsOn = !!on;
  for (const ins of live) ins._applyColor();
}

const PATTERN_GLSL = /* glsl */ `
varying vec2 vPatUv;
uniform float uPattern;
float insigniaPattern() {
  if ( uPattern < 0.5 ) return 1.0;
  float fw = fwidth( vPatUv.x ) + fwidth( vPatUv.y ) + 0.02;
  float line;
  if ( uPattern < 1.5 ) {
    // X 무늬: 칸마다 두 대각선
    vec2 c = vec2( fract( vPatUv.x ), vPatUv.y );
    float d = min( abs( c.x - c.y ), abs( c.x + c.y - 1.0 ) );
    line = 1.0 - smoothstep( 0.15 - fw, 0.15 + fw, d );
  } else {
    // 세로 줄무늬: 칸마다 두 줄
    float f = abs( fract( vPatUv.x * 2.0 ) - 0.5 );
    line = 1.0 - smoothstep( 0.2 - fw, 0.2 + fw, f );
  }
  return 1.0 - 0.84 * line;
}
`;

const matPool = [];
function makeInsigniaMaterial() {
  const m = patchInterior(
    new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: CONFIG.insignia.emissive, side: THREE.DoubleSide, vertexColors: true }),
    false,
  );
  const base = m.onBeforeCompile;
  m.userData.uPattern = { value: 0 };
  m.onBeforeCompile = (shader) => {
    base(shader);
    shader.uniforms.uPattern = m.userData.uPattern;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vPatUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPatUv = uv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PATTERN_GLSL}`)
      .replace('#include <color_fragment>', '#include <color_fragment>\n\tfloat insPat = insigniaPattern();\n\tdiffuseColor.rgb *= insPat;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= insPat;');
  };
  m.customProgramCacheKey = () => 'insignia-pattern-v1'; // NPC 몸 재질과 다른 셰이더 (같은 키면 프로그램을 잘못 공유함)
  return m;
}
function acquireMaterial() {
  const m = matPool.pop() || makeInsigniaMaterial();
  m.userData.uInterior.value = 0;
  m.userData.uHighlight.value.setRGB(0, 0, 0);
  m.userData.uPattern.value = 0;
  return m;
}
function releaseMaterial(m) {
  if (matPool.length < 64) matPool.push(m);
  else m.dispose();
}

// shape: 'band'(완장+헬멧띠) | 'armband'(완장만) | 'helmet'(헬멧띠만) | 'tape'(급조 테이프 완장+띠) | 'none'
export class Insignia {
  constructor(spec) {
    this.color = spec ? spec.color : null;
    this.shape = spec ? spec.shape || 'band' : 'none';
    this.material = acquireMaterial();
    live.add(this);
    this.mesh = null;
    this.rig = null;
    this._visible = true;
    this._applyColor();
  }

  attach(rig) {
    this.detach();
    this.rig = rig;
    this._rebuild();
    return this;
  }

  detach() {
    if (this.mesh && this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.mesh = null;
  }

  _rebuild() {
    const rig = this.rig;
    if (!rig) return;
    const s = this.shape;
    const helmet = rig.outfit.headwear === 'helmet';
    const style = helmet ? rig.outfit.helmetStyle : 'none';
    const key = `${s}|${style}`;
    let geo = cache.get(key);
    if (geo === undefined) {
      const I = CONFIG.insignia;
      const parts = [];
      if (s === 'band' || s === 'armband') {
        const arm = ring(0.079, 0.079, I.armbandHeight, -0.085, 1, 0, 0, 5);
        parts.push({ bone: 'shoulderL', geo: arm, zone: 'arm' }, { bone: 'shoulderR', geo: arm, zone: 'arm' });
      }
      if (s === 'tape') {
        // 엉성하게 두 번 비스듬히 감은 테이프 + 늘어진 끝
        for (const [bone, side] of [['shoulderL', 1], ['shoulderR', -1]]) {
          parts.push(
            { bone, geo: ring(0.08, 0.081, 0.055, -0.06, 1, 0.32 * side, 0.12, 7), zone: 'arm' },
            { bone, geo: ring(0.081, 0.08, 0.045, -0.115, 1, -0.24 * side, -0.1, 8), zone: 'arm' },
            { bone, geo: flap(side * 0.07, -0.17, 0.035, 0.25 * side), zone: 'arm' },
          );
        }
        let band;
        if (style === 'ally') band = ring(0.138, 0.162, I.helmetBandHeight * 0.75, 0.2, 1.07, 0.16, 0.08, 14);
        else if (helmet) band = ring(0.142, 0.156, I.helmetBandHeight * 0.75, 0.205, 1.1, 0.16, 0.08, 14);
        else band = ring(0.118, 0.118, I.helmetBandHeight * 0.6, 0.19, 1.1, 0.16, 0.08, 12);
        parts.push({ bone: 'neck', geo: band, zone: 'head' }, { bone: 'neck', geo: flap(-0.13, 0.15, -0.05, -0.4), zone: 'head' });
      }
      if (s === 'band' || s === 'helmet') {
        // 헬멧 모양에 맞춘 띠 (적·아군 같은 형태·두께, 헬멧이 없으면 머리띠)
        let band;
        if (style === 'ally') band = ring(0.138, 0.162, I.helmetBandHeight, 0.2, 1.07, 0, 0, 12);
        else if (helmet) band = ring(0.142, 0.156, I.helmetBandHeight, 0.205, 1.1, 0, 0, 12);
        else band = ring(0.118, 0.118, I.helmetBandHeight * 0.8, 0.19, 1.1, 0, 0, 10);
        parts.push({ bone: 'neck', geo: band, zone: 'head' });
      }
      geo = parts.length ? buildSkinnedGeometry(parts, rig.restOffsets) : null;
      cache.set(key, geo);
    }
    if (!geo) {
      this.detach();
      return;
    }
    if (!this.mesh) {
      this.mesh = rig.makeSkinnedMesh(geo, this.material);
      this.mesh.castShadow = false;
      rig.root.add(this.mesh);
    } else this.mesh.geometry = geo;
    this.mesh.visible = this._visible && this.color != null;
  }

  setColor(hex) {
    this.color = hex;
    this._applyColor();
    if (this.mesh) this.mesh.visible = this._visible && this.color != null;
  }

  setShape(shape) {
    this.shape = shape;
    this._rebuild();
  }

  setVisible(v) {
    this._visible = v;
    if (this.mesh) this.mesh.visible = v && this.color != null;
  }

  _applyColor() {
    if (!this.material) return;
    this.material.userData.uPattern.value = patternsOn ? patternFor(this.color) : 0;
    if (this.color == null) return;
    this.material.color.setHex(this.color);
    this.material.emissive.setHex(this.color);
  }

  // 장비 데이터 (3단계 시각 단서 판정용) — tape: 급조 테이프 (색이 미묘하게 다른 파랑)
  describe() {
    const visible = !!(this.mesh && this.mesh.visible);
    let colorName = null;
    if (this.color === CONFIG.factions.enemy.insignia.color) colorName = 'red';
    else if (this.color === CONFIG.factions.ally.insignia.color || this.color === CONFIG.insignia.tapeColor) colorName = 'blue';
    else if (this.color != null) colorName = 'other';
    return {
      visible,
      color: visible ? this.color : null,
      colorName: visible ? colorName : null,
      shape: visible ? this.shape : 'none',
      tape: visible && this.shape === 'tape',
    };
  }

  // 레이캐스트 대상 (보이는 것만)
  hitMeshes() {
    return this.mesh && this.mesh.visible ? [this.mesh] : [];
  }

  dispose() {
    this.detach();
    live.delete(this);
    releaseMaterial(this.material);
    this.material = null;
  }
}

// 표식 색 → 색각 보조 무늬 (1 = X 무늬, 2 = 세로 줄무늬)
function patternFor(color) {
  if (color == null) return 0;
  if (color === CONFIG.factions.enemy.insignia.color) return 1;
  if (color === CONFIG.factions.ally.insignia.color || color === CONFIG.insignia.tapeColor) return 2;
  return 0;
}
