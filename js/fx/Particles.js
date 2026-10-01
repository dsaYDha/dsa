// 인스턴스 빌보드 파티클 — 연기·먼지·불꽃·피·재를 모두 이 시스템으로 그린다 (시스템당 드로우콜 1)
import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute float iSize;
attribute vec4 iColor;
attribute float iRot;
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
void main() {
  vUv = uv;
  vColor = iColor;
  vec4 mvPosition = modelViewMatrix * vec4( iPos, 1.0 );
  float c = cos( iRot );
  float s = sin( iRot );
  vec2 p = vec2( position.x * c - position.y * s, position.x * s + position.y * c ) * iSize;
  mvPosition.xy += p;
  gl_Position = projectionMatrix * mvPosition;
  vFogDepth = - mvPosition.z;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
uniform vec3 fogColor;
uniform float fogDensity;
uniform float additive;
varying vec2 vUv;
varying vec4 vColor;
varying float vFogDepth;
void main() {
  vec4 t = texture2D( map, vUv );
  float a = vColor.a * t.a;
  if ( a < 0.004 ) discard;
  float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  vec3 col = vColor.rgb * t.rgb;
  if ( additive > 0.5 ) {
    a *= ( 1.0 - fogFactor );
  } else {
    col = mix( col, fogColor, fogFactor );
  }
  gl_FragColor = vec4( col, a );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class ParticleSystem {
  constructor({ capacity = 500, texture, additive = false, fog, renderOrder = 2 }) {
    this.capacity = capacity;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    geo.setAttribute('uv', quad.attributes.uv);
    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.aRot = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.aPos, this.aSize, this.aColor, this.aRot]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('iPos', this.aPos);
    geo.setAttribute('iSize', this.aSize);
    geo.setAttribute('iColor', this.aColor);
    geo.setAttribute('iRot', this.aRot);
    geo.instanceCount = 0;
    this.geometry = geo;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: texture },
        fogColor: { value: fog ? fog.color : new THREE.Color(0) },
        fogDensity: { value: fog ? fog.density : 0 },
        additive: { value: additive ? 1 : 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.fog = fog;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;

    // 시뮬레이션 상태 (구조 배열)
    const n = capacity;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n); this.life = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.r = new Float32Array(n); this.g = new Float32Array(n); this.b = new Float32Array(n);
    this.a0 = new Float32Array(n); this.fadeIn = new Float32Array(n);
    this.rot = new Float32Array(n); this.rotV = new Float32Array(n);
    this.grav = new Float32Array(n); this.drag = new Float32Array(n);
    this.alive = new Uint8Array(n);
    this.cursor = 0;
    this.liveCount = 0;
  }

  /**
   * p: { x,y,z, vx,vy,vz, life, size, sizeEnd, color: THREE.Color|[r,g,b], alpha, fadeIn, gravity, drag, rot, rotSpeed }
   */
  emit(p) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx || 0; this.vy[i] = p.vy || 0; this.vz[i] = p.vz || 0;
    this.age[i] = 0;
    this.life[i] = p.life || 1;
    this.s0[i] = p.size || 0.5;
    this.s1[i] = p.sizeEnd ?? this.s0[i];
    const c = p.color;
    if (c && c.isColor) { this.r[i] = c.r; this.g[i] = c.g; this.b[i] = c.b; }
    else if (c) { this.r[i] = c[0]; this.g[i] = c[1]; this.b[i] = c[2]; }
    else { this.r[i] = this.g[i] = this.b[i] = 1; }
    this.a0[i] = p.alpha ?? 1;
    this.fadeIn[i] = p.fadeIn ?? 0.08;
    this.rot[i] = p.rot ?? Math.random() * 6.28;
    this.rotV[i] = p.rotSpeed ?? 0;
    this.grav[i] = p.gravity || 0;
    this.drag[i] = p.drag || 0;
    this.alive[i] = 1;
  }

  clear() {
    this.alive.fill(0);
    this.geometry.instanceCount = 0;
  }

  update(dt, wind) {
    const P = this.aPos.array;
    const S = this.aSize.array;
    const Cc = this.aColor.array;
    const R = this.aRot.array;
    let k = 0;
    const wx = wind ? wind.x : 0;
    const wz = wind ? wind.z : 0;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.alive[i]) continue;
      const age = (this.age[i] += dt);
      const life = this.life[i];
      if (age >= life) {
        this.alive[i] = 0;
        continue;
      }
      const d = 1 / (1 + this.drag[i] * dt);
      this.vx[i] = (this.vx[i] + wx * this.drag[i] * dt) * d;
      this.vz[i] = (this.vz[i] + wz * this.drag[i] * dt) * d;
      this.vy[i] = (this.vy[i] - this.grav[i] * dt) * d;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.rotV[i] * dt;
      const t = age / life;
      const fi = this.fadeIn[i];
      const fade = t < fi ? t / fi : 1 - (t - fi) / (1 - fi);
      P[k * 3] = this.px[i];
      P[k * 3 + 1] = this.py[i];
      P[k * 3 + 2] = this.pz[i];
      S[k] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      Cc[k * 4] = this.r[i];
      Cc[k * 4 + 1] = this.g[i];
      Cc[k * 4 + 2] = this.b[i];
      Cc[k * 4 + 3] = this.a0[i] * Math.max(0, fade);
      R[k] = this.rot[i];
      k++;
    }
    this.liveCount = k;
    this.geometry.instanceCount = k;
    if (k > 0) {
      this.aPos.clearUpdateRanges();
      this.aPos.addUpdateRange(0, k * 3);
      this.aSize.clearUpdateRanges();
      this.aSize.addUpdateRange(0, k);
      this.aColor.clearUpdateRanges();
      this.aColor.addUpdateRange(0, k * 4);
      this.aRot.clearUpdateRanges();
      this.aRot.addUpdateRange(0, k);
      this.aPos.needsUpdate = true;
      this.aSize.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aRot.needsUpdate = true;
    }
  }
}
