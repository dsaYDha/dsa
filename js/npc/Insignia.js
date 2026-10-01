// 표식 컴포넌트 — 몸에 붙은 실제 물체(양팔 완장 + 헬멧 띠). 색과 형태를 바꿀 수 있다.
// 3단계 위장 적: setColor(아군 파랑) / setShape('none') 으로 겉보기 소속을 바꾼다.
// 살짝 발광(emissive)해 30~40m 에서도 보이지만, 일반 깊이 판정이라 벽 너머로는 보이지 않는다.
// 렌더링: 리그와 같은 뼈대를 쓰는 SkinnedMesh 하나 (드로우콜 1)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { patchInterior } from '../world/Materials.js';
import { buildSkinnedGeometry } from './HumanoidRig.js';

const cache = new Map();

function ring(rTop, rBottom, h, y, zScale = 1) {
  const g = new THREE.CylinderGeometry(rTop, rBottom, h, 12, 1, true).toNonIndexed();
  g.scale(1, 1, zScale);
  g.translate(0, y, 0);
  g.deleteAttribute('uv');
  return g;
}

// shape: 'band'(완장+헬멧띠) | 'armband'(완장만) | 'helmet'(헬멧띠만) | 'none'
export class Insignia {
  constructor(spec) {
    this.color = spec ? spec.color : null;
    this.shape = spec ? spec.shape || 'band' : 'none';
    this.material = patchInterior(
      new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: CONFIG.insignia.emissive, side: THREE.DoubleSide, vertexColors: true }),
      false,
    );
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
    const key = `${s}|${helmet}`;
    let geo = cache.get(key);
    if (geo === undefined) {
      const I = CONFIG.insignia;
      const parts = [];
      if (s === 'band' || s === 'armband') {
        const arm = ring(0.079, 0.079, I.armbandHeight, -0.085);
        parts.push({ bone: 'shoulderL', geo: arm, zone: 'arm' }, { bone: 'shoulderR', geo: arm, zone: 'arm' });
      }
      if (s === 'band' || s === 'helmet') {
        const band = helmet ? ring(0.142, 0.156, I.helmetBandHeight, 0.205, 1.1) : ring(0.118, 0.118, I.helmetBandHeight * 0.8, 0.19, 1.1);
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
    if (this.color == null) return;
    this.material.color.setHex(this.color);
    this.material.emissive.setHex(this.color);
  }

  // 레이캐스트 대상 (보이는 것만)
  hitMeshes() {
    return this.mesh && this.mesh.visible ? [this.mesh] : [];
  }

  dispose() {
    this.detach();
    this.material.dispose();
  }
}
