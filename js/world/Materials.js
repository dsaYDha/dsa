// 재질 정의 + 실내 음영 셰이더 패치
// 실내 면(aInterior=1)은 태양광을 받지 않고 간접광도 줄어 바깥보다 어둡게 보인다.
// 손전등·불빛·총구 화염 같은 점/스포트 광원은 그대로 적용된다.
import * as THREE from 'three';
import { CONFIG } from '../config.js';

export const sharedUniforms = {
  uInteriorAmbient: { value: CONFIG.map.interiorAmbient },
};

const SUN_PATCH = 'getDirectionalLightInfo( directionalLight, directLight );';

// attributeMode: true 면 정점 속성 aInterior 사용(정적 지형), false 면 재질별 uInterior 유니폼 사용(NPC)
export function patchInterior(material, attributeMode = true) {
  material.userData.uInterior = { value: 0 };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uInterior = material.userData.uInterior;
    shader.uniforms.uInteriorAmbient = sharedUniforms.uInteriorAmbient;
    const vDecl = attributeMode
      ? 'attribute float aInterior;\nuniform float uInterior;\nvarying float vInterior;'
      : 'uniform float uInterior;\nvarying float vInterior;';
    const vAssign = attributeMode ? 'vInterior = max( aInterior, uInterior );' : 'vInterior = uInterior;';
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${vDecl}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${vAssign}`);
    const lightsChunk = THREE.ShaderChunk.lights_fragment_begin.replace(
      SUN_PATCH,
      `${SUN_PATCH}\n\t\tdirectLight.color *= ( 1.0 - vInterior );`,
    );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vInterior;\nuniform float uInteriorAmbient;')
      .replace(
        '#include <lights_fragment_begin>',
        `${lightsChunk}\n#if defined( RE_IndirectDiffuse )\n\tirradiance *= mix( 1.0, uInteriorAmbient, vInterior );\n#endif\n`,
      );
  };
  material.customProgramCacheKey = () => (attributeMode ? 'interior-attr-v1' : 'interior-uni-v1');
  return material;
}

// 텍스처 타일 크기(m) 기준으로 UV 를 미터 단위로 만들고 repeat 로 축척
function lambert(map, tile, extra = {}) {
  const m = new THREE.MeshLambertMaterial({ map: map || null, ...extra });
  if (map) map.repeat.set(1 / tile, 1 / tile);
  return patchInterior(m, true);
}

// 정적 지형 재질 목록. info.uv: 'world'(미터 기준 반복) | 'facade'(창문 아틀라스 맞춤)
// 성능: 바닥·천장·창틀·작은 소품 재질은 그림자를 드리우지 않는다 (그림자 패스 드로우콜 절감)
export function createWorldMaterials(tex) {
  const M = {};
  const info = {};
  const def = (key, mat, opts = {}) => {
    M[key] = mat;
    info[key] = { uv: 'world', tile: 1, castShadow: true, receiveShadow: true, ...opts };
  };

  // 반복 텍스처를 재질마다 복제해 repeat 를 독립적으로 둔다
  const c = (t) => {
    const k = t.clone();
    k.needsUpdate = true;
    return k;
  };

  def('ground', lambert(c(tex.dirt), 7), { castShadow: false });
  def('asphalt', lambert(c(tex.asphalt), 9, { polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), { castShadow: false });
  def('sidewalk', lambert(c(tex.sidewalk), 2.2, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 }), { castShadow: false });
  def('lane', lambert(null, 1, { color: 0xb8a670, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -6 }), { castShadow: false });
  def('scorch', lambert(tex.scorch, 1, { transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }), { castShadow: false, uv: 'unit' });

  def('facadePlaster', lambert(c(tex.plasterA), 4));
  def('facadeBrick', lambert(c(tex.brick), 2.6));
  def('facadeConcrete', lambert(c(tex.plasterB), 4));
  def('reveal', lambert(c(tex.concrete), 2.5), { castShadow: false });

  for (const [key, atlas] of [['winBrick', tex.facadeBrick], ['winPlaster', tex.facadePlaster], ['winConcrete', tex.facadeConcrete]]) {
    const m = new THREE.MeshLambertMaterial({
      map: atlas.map,
      emissiveMap: atlas.emissive,
      emissive: new THREE.Color(0xffffff),
      emissiveIntensity: 1.6,
    });
    def(key, patchInterior(m, true), { uv: 'facade' });
  }

  def('interior', lambert(c(tex.interior), 3.2));
  def('floor', lambert(c(tex.floorTile), 2.2), { castShadow: false });
  def('ceiling', lambert(c(tex.concreteDark), 3), { castShadow: false });
  def('concrete', lambert(c(tex.concrete), 3));
  def('concreteDark', lambert(c(tex.concreteDark), 3));
  def('roof', lambert(c(tex.roof), 4));
  def('wood', lambert(c(tex.wood), 1.6), { castShadow: false });
  def('metal', lambert(c(tex.burntMetal), 2.2));
  def('rubble', lambert(c(tex.rubble), 3));
  def('char', lambert(null, 1, { color: 0x14110f }), { castShadow: false });
  def('sandbagSolid', lambert(c(tex.sandbag), 0.6));
  def('skyline', lambert(null, 1, { color: 0x2a2523 }), { castShadow: false, receiveShadow: false });

  return { materials: M, info };
}

// 표면 종류(피탄 이펙트·발소리 구분용)
export const SURFACE = {
  concrete: 'concrete',
  metal: 'metal',
  wood: 'wood',
  dirt: 'dirt',
  sand: 'sand',
  rubble: 'rubble',
};
