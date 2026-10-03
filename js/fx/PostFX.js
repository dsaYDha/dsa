// 5단계 후처리 — 월드·1인칭 총기를 렌더 타깃(HDR)에 그린 뒤 화면 전체 삼각형 하나로 마무리
// · 톤 매핑(ACES)·sRGB 변환은 이 패스에서 (렌더 타깃에 그릴 땐 three 가 선형 HDR 로 둔다)
// · 색보정(채도·대비·색조)·비네트·옅은 필름 그레인, 저체력 채도 감소 + 붉은 맥동, 사망 시 회색으로 어두워짐
// · 안티에일리어싱: 'fxaa'(이 패스 안에서) | 'msaa'(멀티샘플 렌더 타깃) — 그래픽 프리셋(config.graphics)
// 그래픽 '낮음'은 후처리를 끄고 화면에 바로 그린다 (Game._render)
import * as THREE from 'three';
import { CONFIG } from '../config.js';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4( position.xy, 0.0, 1.0 );
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tDiffuse;
uniform vec2 uTexel;
uniform float uFxaa;
uniform float uVignette;
uniform float uSat;
uniform float uContrast;
uniform vec3 uTint;
uniform float uLowHp;
uniform float uPulse;
uniform float uDead;
uniform float uGrain;
uniform float uTime;
varying vec2 vUv;

float lum( vec3 c ) { return dot( c, vec3( 0.299, 0.587, 0.114 ) ); }
// HDR 값의 밝기를 대략 0~1 로 (FXAA 경계 판정용)
float lumT( vec3 c ) { float l = lum( c ); return l / ( 1.0 + l ); }

// 가벼운 FXAA (경계 방향으로 두 번 더 샘플)
vec3 fxaa( vec2 uv ) {
  vec3 cM = texture2D( tDiffuse, uv ).rgb;
  float lM = lumT( cM );
  float lNW = lumT( texture2D( tDiffuse, uv + vec2( -1.0, -1.0 ) * uTexel ).rgb );
  float lNE = lumT( texture2D( tDiffuse, uv + vec2( 1.0, -1.0 ) * uTexel ).rgb );
  float lSW = lumT( texture2D( tDiffuse, uv + vec2( -1.0, 1.0 ) * uTexel ).rgb );
  float lSE = lumT( texture2D( tDiffuse, uv + vec2( 1.0, 1.0 ) * uTexel ).rgb );
  float lMin = min( lM, min( min( lNW, lNE ), min( lSW, lSE ) ) );
  float lMax = max( lM, max( max( lNW, lNE ), max( lSW, lSE ) ) );
  if ( lMax - lMin < max( 0.03, lMax * 0.12 ) ) return cM;
  vec2 dir = vec2( -( ( lNW + lNE ) - ( lSW + lSE ) ), ( lNW + lSW ) - ( lNE + lSE ) );
  float reduce = max( ( lNW + lNE + lSW + lSE ) * 0.03125, 1.0 / 128.0 );
  float rcp = 1.0 / ( min( abs( dir.x ), abs( dir.y ) ) + reduce );
  dir = clamp( dir * rcp, vec2( -8.0 ), vec2( 8.0 ) ) * uTexel;
  vec3 a = 0.5 * ( texture2D( tDiffuse, uv + dir * ( 1.0 / 3.0 - 0.5 ) ).rgb + texture2D( tDiffuse, uv + dir * ( 2.0 / 3.0 - 0.5 ) ).rgb );
  vec3 b = a * 0.5 + 0.25 * ( texture2D( tDiffuse, uv + dir * -0.5 ).rgb + texture2D( tDiffuse, uv + dir * 0.5 ).rgb );
  float lB = lumT( b );
  return ( lB < lMin || lB > lMax ) ? a : b;
}

float hash( vec2 p ) { return fract( sin( dot( p, vec2( 12.9898, 78.233 ) ) ) * 43758.5453 ); }

void main() {
  vec3 c = uFxaa > 0.5 ? fxaa( vUv ) : texture2D( tDiffuse, vUv ).rgb;
  gl_FragColor = vec4( c, 1.0 );
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  vec3 col = gl_FragColor.rgb;
  // 색보정 (화면 색 공간에서)
  float l = lum( col );
  float sat = uSat * ( 1.0 - uLowHp * ${CONFIG.post.lowHpDesat.toFixed(3)} ) * ( 1.0 - uDead * 0.85 );
  col = mix( vec3( l ), col, sat );
  col = ( col - 0.5 ) * uContrast + 0.5;
  col *= uTint;
  // 비네트 (+ 저체력이면 붉게 맥동)
  vec2 d = vUv - 0.5;
  float r = dot( d, d ) * 2.2;
  float vig = smoothstep( 0.18, 1.0, r );
  col *= 1.0 - vig * ( uVignette + uLowHp * 0.25 + uDead * 0.5 );
  col = mix( col, col * vec3( 1.25, 0.55, 0.5 ), vig * uLowHp * ( 0.45 + 0.35 * uPulse ) );
  // 사망: 어둡게
  col *= 1.0 - uDead * 0.45;
  // 옅은 그레인
  col += ( hash( vUv * 913.7 + uTime ) - 0.5 ) * uGrain;
  gl_FragColor = vec4( clamp( col, 0.0, 1.0 ), 1.0 );
}
`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = false;
    this.aa = 'none';
    this.target = null;
    const P = CONFIG.post;
    this.uniforms = {
      tDiffuse: { value: null },
      uTexel: { value: new THREE.Vector2(1 / 1280, 1 / 720) },
      uFxaa: { value: 0 },
      uVignette: { value: P.vignette },
      uSat: { value: P.saturation },
      uContrast: { value: P.contrast },
      uTint: { value: new THREE.Vector3(...P.tint) },
      uLowHp: { value: 0 },
      uPulse: { value: 0 },
      uDead: { value: 0 },
      uGrain: { value: P.grain },
      uTime: { value: 0 },
    };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geo, this.material);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // HDR 렌더 타깃을 쓸 수 있는지 (WebGL2 + 부동소수 색 버퍼)
    const ext = renderer.extensions;
    this.hdr = !!(ext && (ext.has('EXT_color_buffer_float') || ext.has('EXT_color_buffer_half_float')));
  }

  /** 그래픽 프리셋 적용 */
  configure(enabled, aa) {
    this.enabled = !!enabled;
    this.aa = aa || 'none';
    this.uniforms.uFxaa.value = this.enabled && this.aa === 'fxaa' ? 1 : 0;
    this._rebuild();
  }

  _rebuild() {
    if (this.target) {
      this.target.dispose();
      this.target = null;
    }
    if (!this.enabled) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: this.aa === 'msaa' ? 4 : 0,
      depthBuffer: true,
    });
    this.target.texture.generateMipmaps = false;
    this.uniforms.tDiffuse.value = this.target.texture;
    this.uniforms.uTexel.value.set(1 / size.x, 1 / size.y);
  }

  /** 창 크기·렌더 배율이 바뀌면 */
  resize() {
    if (!this.enabled) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    if (this.target && this.target.width === size.x && this.target.height === size.y) return;
    this._rebuild();
  }

  /** 매 프레임 상태 (저체력 0~1, 박동 0~1, 사망 0~1) */
  setState(lowHp, pulse, dead, time) {
    const u = this.uniforms;
    u.uLowHp.value = lowHp;
    u.uPulse.value = pulse;
    u.uDead.value = dead;
    u.uTime.value = time % 100;
  }

  /** 렌더 타깃 → 화면 */
  render() {
    const r = this.renderer;
    r.setRenderTarget(null);
    r.render(this.scene, this.camera);
  }

  dispose() {
    if (this.target) this.target.dispose();
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
