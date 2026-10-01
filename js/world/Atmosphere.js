// 분위기 — 흐린 해 질 녘 하늘, 먼지 안개, 태양(그림자는 플레이어 주변만), 불길·연기 기둥, 날리는 재,
// 지평선 폭발 섬광(멀리서 울리는 포성은 AudioSystem 이 담당)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { ParticleSystem } from '../fx/Particles.js';
import { RNG, gameRand } from '../core/Random.js';

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize( position );
  vec4 p = modelViewMatrix * vec4( position, 1.0 );
  gl_Position = projectionMatrix * p;
  gl_Position.z = gl_Position.w; // 항상 가장 먼 깊이
}
`;

const SKY_FRAG = /* glsl */ `
uniform vec3 zenith;
uniform vec3 horizon;
uniform vec3 ground;
uniform vec3 sunDir;
uniform vec3 sunColor;
uniform vec3 flashDir;
uniform float flash;
uniform float time;
varying vec3 vDir;

float hash( vec2 p ) { return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 ); }
float noise( vec2 p ) {
  vec2 i = floor( p ); vec2 f = fract( p );
  vec2 u = f * f * ( 3.0 - 2.0 * f );
  return mix( mix( hash( i ), hash( i + vec2( 1, 0 ) ), u.x ), mix( hash( i + vec2( 0, 1 ) ), hash( i + vec2( 1, 1 ) ), u.x ), u.y );
}
float fbm( vec2 p ) {
  float v = 0.0; float a = 0.5;
  for ( int i = 0; i < 5; i ++ ) { v += a * noise( p ); p *= 2.03; a *= 0.5; }
  return v;
}

void main() {
  vec3 d = normalize( vDir );
  float h = d.y;
  vec3 col = mix( horizon, zenith, pow( clamp( h, 0.0, 1.0 ), 0.55 ) );
  col = mix( col, ground, smoothstep( 0.0, -0.12, h ) );
  // 태양 주변 붉은 번짐
  float sd = max( dot( d, sunDir ), 0.0 );
  col += sunColor * ( pow( sd, 8.0 ) * 0.35 + pow( sd, 64.0 ) * 0.6 + pow( sd, 900.0 ) * 1.5 );
  // 흐린 구름층
  if ( h > -0.05 ) {
    vec2 uv = d.xz / ( h + 0.18 ) * 1.4 + vec2( time * 0.006, time * 0.002 );
    float c = fbm( uv );
    float cov = smoothstep( 0.35, 0.8, c );
    vec3 cloudCol = mix( vec3( 0.16, 0.13, 0.13 ), sunColor * 0.55 + vec3( 0.12, 0.08, 0.07 ), pow( sd, 3.0 ) );
    col = mix( col, cloudCol, cov * 0.75 * smoothstep( -0.05, 0.12, h ) );
  }
  // 지평선 폭발 섬광
  float fd = max( dot( d, flashDir ), 0.0 );
  col += vec3( 1.0, 0.62, 0.3 ) * flash * ( pow( fd, 24.0 ) * 2.5 + pow( fd, 4.0 ) * 0.25 ) * smoothstep( 0.45, -0.02, h );
  gl_FragColor = vec4( col, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class Atmosphere {
  constructor(scene, textures, fires, seed) {
    const A = CONFIG.atmosphere;
    this.scene = scene;
    this.fires = fires;
    this.rng = new RNG('atmo:' + seed);
    this.time = 0;
    this.wind = new THREE.Vector3(0.9, 0, 0.35);

    // 안개
    this.fog = new THREE.FogExp2(A.fogColor, A.fogDensity);
    scene.fog = this.fog;
    scene.background = new THREE.Color(A.fogColor);

    // 태양 방향
    const el = THREE.MathUtils.degToRad(A.sunElevation);
    const az = THREE.MathUtils.degToRad(A.sunAzimuth);
    this.sunDir = new THREE.Vector3(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();

    // 하늘
    this.skyUniforms = {
      zenith: { value: new THREE.Color(0x2e2d36) },
      horizon: { value: new THREE.Color(0x9a6a52) },
      ground: { value: new THREE.Color(A.fogColor) },
      sunDir: { value: this.sunDir },
      sunColor: { value: new THREE.Color(0xff8a40) },
      flashDir: { value: new THREE.Vector3(1, 0, 0) },
      flash: { value: 0 },
      time: { value: 0 },
    };
    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({ uniforms: this.skyUniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false }),
    );
    sky.frustumCulled = false;
    sky.renderOrder = -10;
    this.sky = sky;
    scene.add(sky);

    // 조명
    this.hemi = new THREE.HemisphereLight(A.hemiSky, A.hemiGround, A.hemiIntensity);
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(A.sunColor, A.sunIntensity);
    const sh = this.sun.shadow;
    const R = CONFIG.render.shadowRange;
    sh.mapSize.set(CONFIG.render.shadowMapSize, CONFIG.render.shadowMapSize);
    sh.camera.left = -R;
    sh.camera.right = R;
    sh.camera.top = R;
    sh.camera.bottom = -R;
    sh.camera.near = 1;
    sh.camera.far = 185; // 태양 쪽 120m ~ 플레이어 뒤 65m 까지만
    sh.bias = -0.0006;
    sh.normalBias = 0.04;
    this.sun.castShadow = true;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // 불길 점광원 풀 (개수 고정 — 셰이더 재컴파일 방지)
    this.fireLights = [];
    for (let i = 0; i < A.maxFireLights; i++) {
      const l = new THREE.PointLight(0xff7a2a, 0, A.fireLightRange, 2);
      l.position.set(0, -100, 0);
      scene.add(l);
      this.fireLights.push({ light: l, fire: null });
    }
    this._lightTimer = 0;

    // 파티클
    this.smoke = new ParticleSystem({ capacity: 900, texture: textures.smoke, fog: this.fog, renderOrder: 3 });
    this.flames = new ParticleSystem({ capacity: 420, texture: textures.flame, additive: true, fog: this.fog, renderOrder: 4 });
    this.embers = new ParticleSystem({ capacity: 260, texture: textures.spark, additive: true, fog: this.fog, renderOrder: 4 });
    this.ash = new ParticleSystem({ capacity: A.ashCount, texture: textures.glow, fog: this.fog, renderOrder: 3 });
    scene.add(this.smoke.mesh, this.flames.mesh, this.embers.mesh, this.ash.mesh);

    // 연기 기둥: 연기 플래그가 있는 불 + 맵 밖 먼 기둥
    this.columns = [];
    const smokeFires = fires.filter((f) => f.smoke);
    this.rng.shuffle(smokeFires);
    for (const f of smokeFires.slice(0, A.smokeColumns)) this.columns.push({ x: f.x, y: f.y + 1, z: f.z, scale: 1, t: 0 });
    for (let i = 0; i < 4; i++) {
      const a = this.rng.range(0, Math.PI * 2);
      const d = this.rng.range(120, 220);
      this.columns.push({ x: Math.cos(a) * d, y: 5, z: Math.sin(a) * d, scale: 3.2, t: 0 });
    }
    for (const f of fires) f.t = this.rng.range(0, 1);

    this._ashInit = false;
    this.nextFlash = this.rng.range(...A.horizonFlashInterval) * 0.5;
    this.flashT = 0;
    this.onDistantExplosion = null; // (방위 벡터, 지연초, 세기) => void
    this.indoorFactor = 0;
  }

  // 원경 스카이라인 (맵 밖 폐허 실루엣)
  buildSkyline(materials) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    geo.translate(0, 0.5, 0);
    geo.setAttribute('aInterior', new THREE.Float32BufferAttribute(new Float32Array(geo.attributes.position.count), 1));
    const count = 140;
    const im = new THREE.InstancedMesh(geo, materials.skyline, count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3();
    const p = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + this.rng.range(-0.02, 0.02);
      const d = this.rng.range(125, 260);
      p.set(Math.cos(a) * d, 0, Math.sin(a) * d);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.rng.range(0, Math.PI));
      const broken = this.rng.chance(0.4);
      s.set(this.rng.range(10, 26), this.rng.range(8, broken ? 18 : 34), this.rng.range(10, 26));
      m.compose(p, q, s);
      im.setMatrixAt(i, m);
    }
    im.computeBoundingSphere();
    im.castShadow = false;
    im.receiveShadow = false;
    this.scene.add(im);
  }

  update(dt, camera, playerPos, indoorFactor = 0) {
    this.time += dt;
    this.skyUniforms.time.value = this.time;
    this.sky.position.copy(camera.position);
    this.indoorFactor = indoorFactor;

    // 그림자 카메라가 플레이어를 따라감 (텍셀 단위로 스냅해 떨림 감소)
    const R = CONFIG.render.shadowRange;
    const texel = (R * 2) / CONFIG.render.shadowMapSize;
    const tx = Math.round(playerPos.x / texel) * texel;
    const tz = Math.round(playerPos.z / texel) * texel;
    this.sun.target.position.set(tx, 0, tz);
    this.sun.position.set(tx + this.sunDir.x * 120, this.sunDir.y * 120, tz + this.sunDir.z * 120);
    this.sun.target.updateMatrixWorld();

    // 바람 변화
    this.wind.x = 0.9 + Math.sin(this.time * 0.07) * 0.5;
    this.wind.z = 0.35 + Math.cos(this.time * 0.05) * 0.4;

    this._updateFires(dt, playerPos);
    this._updateColumns(dt);
    this._updateAsh(dt, camera);
    this._updateFlashes(dt);

    this.smoke.update(dt, this.wind);
    this.flames.update(dt, this.wind);
    this.embers.update(dt, this.wind);
    this.ash.update(dt, this.wind);
  }

  _updateFires(dt, pp) {
    const A = CONFIG.atmosphere;
    // 가까운 불에 점광원 배정 (0.3초마다)
    this._lightTimer -= dt;
    if (this._lightTimer <= 0) {
      this._lightTimer = 0.3;
      const sorted = this.fires
        .map((f) => ({ f, d: (f.x - pp.x) ** 2 + (f.z - pp.z) ** 2 }))
        .sort((a, b) => a.d - b.d);
      for (let i = 0; i < this.fireLights.length; i++) {
        const slot = this.fireLights[i];
        const s = sorted[i];
        if (s && s.d < 70 * 70) {
          slot.fire = s.f;
          slot.light.position.set(s.f.x, s.f.y + 0.9, s.f.z);
        } else {
          slot.fire = null;
          slot.light.intensity = 0;
        }
      }
    }
    for (const slot of this.fireLights) {
      if (!slot.fire) continue;
      const t = this.time * 9 + slot.fire.x;
      const flick = 0.75 + Math.sin(t) * 0.12 + Math.sin(t * 2.3 + 1.7) * 0.08 + gameRand.range(-0.08, 0.08);
      slot.light.intensity = A.fireLightIntensity * slot.fire.size * flick;
    }
    // 불꽃 파티클 (거리에 따라 방출량 조절)
    for (const f of this.fires) {
      const d2 = (f.x - pp.x) ** 2 + (f.z - pp.z) ** 2;
      if (d2 > 110 * 110) continue;
      const rate = d2 < 40 * 40 ? 22 : 9;
      f.t += dt * rate * f.size;
      while (f.t > 1) {
        f.t -= 1;
        const s = f.size;
        this.flames.emit({
          x: f.x + gameRand.range(-0.5, 0.5) * s, y: f.y + gameRand.range(-0.1, 0.3), z: f.z + gameRand.range(-0.5, 0.5) * s,
          vx: gameRand.range(-0.2, 0.2), vy: gameRand.range(1.4, 2.6) * s, vz: gameRand.range(-0.2, 0.2),
          life: gameRand.range(0.45, 0.9), size: gameRand.range(0.7, 1.2) * s, sizeEnd: 0.25 * s,
          color: [1.0, gameRand.range(0.55, 0.8), 0.35], alpha: 0.9, fadeIn: 0.15, drag: 0.6, rotSpeed: gameRand.range(-1, 1),
        });
        if (gameRand.chance(0.08)) {
          this.embers.emit({
            x: f.x, y: f.y + 0.5, z: f.z, vx: gameRand.range(-0.8, 0.8), vy: gameRand.range(2, 4.5), vz: gameRand.range(-0.8, 0.8),
            life: gameRand.range(1.2, 2.5), size: 0.06, sizeEnd: 0.02, color: [1, 0.6, 0.25], alpha: 1, drag: 0.4, gravity: -0.3,
          });
        }
        if (!f.smoke && gameRand.chance(0.15)) {
          this.smoke.emit({
            x: f.x, y: f.y + 1.2, z: f.z, vx: 0, vy: gameRand.range(0.8, 1.4), vz: 0,
            life: gameRand.range(2, 3.5), size: 0.8 * s, sizeEnd: 2.8 * s, color: [0.12, 0.11, 0.1], alpha: 0.4, fadeIn: 0.15, drag: 0.3,
          });
        }
      }
    }
  }

  _updateColumns(dt) {
    for (const c of this.columns) {
      const far = c.scale > 1;
      c.t += dt * (far ? 3.5 : 6);
      while (c.t > 1) {
        c.t -= 1;
        const s = c.scale;
        this.smoke.emit({
          x: c.x + gameRand.range(-0.6, 0.6) * s, y: c.y, z: c.z + gameRand.range(-0.6, 0.6) * s,
          vx: gameRand.range(-0.2, 0.2), vy: gameRand.range(2.2, 3.2) * Math.sqrt(s), vz: gameRand.range(-0.2, 0.2),
          life: gameRand.range(12, 18), size: 1.6 * s, sizeEnd: 14 * s,
          color: far ? [0.16, 0.14, 0.13] : [0.1, 0.09, 0.085], alpha: far ? 0.5 : 0.55, fadeIn: 0.06, drag: 0.08,
          rotSpeed: gameRand.range(-0.15, 0.15),
        });
      }
    }
  }

  _updateAsh(dt, camera) {
    // 카메라 주변 상자에서 재가 떨어짐
    const p = camera.position;
    const want = CONFIG.atmosphere.ashCount;
    const live = this.ash.liveCount;
    const spawn = Math.min(want - live, Math.ceil(dt * want / 6) + (this._ashInit ? 0 : want));
    this._ashInit = true;
    for (let i = 0; i < spawn; i++) {
      const ember = gameRand.chance(0.07);
      this.ash.emit({
        x: p.x + gameRand.range(-22, 22), y: p.y + gameRand.range(-2, 14), z: p.z + gameRand.range(-22, 22),
        vx: gameRand.range(-0.3, 0.3), vy: gameRand.range(-0.6, -0.25), vz: gameRand.range(-0.3, 0.3),
        life: gameRand.range(5, 9), size: ember ? 0.05 : gameRand.range(0.04, 0.08), sizeEnd: 0.03,
        color: ember ? [1, 0.5, 0.2] : [0.55, 0.52, 0.5], alpha: ember ? 0.9 : 0.55, fadeIn: 0.2, drag: 0.8,
        rotSpeed: gameRand.range(-2, 2),
      });
    }
  }

  _updateFlashes(dt) {
    const A = CONFIG.atmosphere;
    this.nextFlash -= dt;
    if (this.nextFlash <= 0) {
      this.nextFlash = gameRand.range(...A.horizonFlashInterval);
      const a = gameRand.range(0, Math.PI * 2);
      const dir = new THREE.Vector3(Math.cos(a), gameRand.range(0.0, 0.06), Math.sin(a)).normalize();
      this.skyUniforms.flashDir.value.copy(dir);
      const strength = gameRand.range(0.6, 1.4);
      this.flashT = strength;
      if (this.onDistantExplosion) this.onDistantExplosion(dir, gameRand.range(0.9, 3.2), strength);
    }
    this.flashT = Math.max(0, this.flashT - dt * 2.2);
    const f = this.flashT * this.flashT;
    this.skyUniforms.flash.value = f;
    this.hemi.intensity = A.hemiIntensity * (1 + f * 0.35);
  }

  // 큰 폭발(근거리) 등 외부 요청용 — 2단계 이후 확장 지점
  clearTransient() {
    this.smoke.clear();
    this.embers.clear();
  }
}
