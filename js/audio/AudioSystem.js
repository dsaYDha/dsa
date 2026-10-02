// 사운드 — 외부 파일 없이 Web Audio API 로 모두 합성
// AudioContext 는 시작 버튼을 누를 때 생성 (브라우저 자동재생 정책)
import { CONFIG } from '../config.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = CONFIG.audio.masterVolume;
    this._npcSteps = 0;
    this._heartbeat = false;
    this._nextBeat = 0;
    this._focus = 0;
  }

  init() {
    if (this.ctx) {
      this.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb = ctx.createGain();
    this.amb.gain.value = 0.9;
    this.amb.connect(this.master);
    this.ui = ctx.createGain();
    this.ui.gain.value = 0.9;
    this.ui.connect(this.master);

    // 도심 잔향 (생성한 임펄스 응답)
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(CONFIG.audio.reverbSeconds, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverbSend.connect(this.reverb).connect(this.master);

    this.noise = this._noiseBuffer(2.0, 'white');
    this.brown = this._noiseBuffer(3.0, 'brown');

    this._startAmbience();
    this.ready = true;
  }

  _noiseBuffer(sec, kind) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'brown') {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  _impulse(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 초반 이른 반사 + 지수 감쇠 꼬리
        const early = i < ctx.sampleRate * 0.08 && Math.random() < 0.01 ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend();
  }

  resume() {
    if (this.ctx && this.ctx.state !== 'running') this.ctx.resume();
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  // ------------------------------------------------------------------
  // 3D 위치 / 청자
  // ------------------------------------------------------------------
  updateListener(camera) {
    if (!this.ready) return;
    const l = this.ctx.listener;
    const p = camera.position;
    const e = camera.matrixWorld.elements;
    const fx = -e[8];
    const fy = -e[9];
    const fz = -e[10];
    const ux = e[4];
    const uy = e[5];
    const uz = e[6];
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(p.x, t);
      l.positionY.setValueAtTime(p.y, t);
      l.positionZ.setValueAtTime(p.z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(ux, t);
      l.upY.setValueAtTime(uy, t);
      l.upZ.setValueAtTime(uz, t);
    } else {
      l.setPosition(p.x, p.y, p.z);
      l.setOrientation(fx, fy, fz, ux, uy, uz);
    }
    this.listenerPos = p;
  }

  // 위치 사운드 출력 노드: panner → (거리 저역통과) → sfx (+ 잔향)
  _spatial(pos, { ref = 4, rolloff = 1.1, reverb = 0.3, muffle = true } = {}) {
    const ctx = this.ctx;
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = ref;
    pan.maxDistance = 500;
    pan.rolloffFactor = rolloff;
    if (pan.positionX) {
      pan.positionX.value = pos.x;
      pan.positionY.value = pos.y;
      pan.positionZ.value = pos.z;
    } else pan.setPosition(pos.x, pos.y, pos.z);
    let out = pan;
    if (muffle && this.listenerPos) {
      const d = Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = Math.max(700, 16000 * Math.exp(-d / 28));
      pan.connect(lp);
      out = lp;
    }
    out.connect(this.sfx);
    if (reverb > 0) {
      const s = ctx.createGain();
      s.gain.value = reverb;
      out.connect(s).connect(this.reverbSend);
    }
    return pan;
  }

  _dist(pos) {
    if (!this.listenerPos) return 0;
    return Math.hypot(pos.x - this.listenerPos.x, pos.y - this.listenerPos.y, pos.z - this.listenerPos.z);
  }

  // ------------------------------------------------------------------
  // 합성 기본 블록
  // ------------------------------------------------------------------
  _noiseBurst(dest, t, { dur = 0.1, gain = 1, type = 'bandpass', freq = 1000, q = 0.8, attack = 0.002, buffer = null, freqEnd = null }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer || this.noise;
    src.playbackRate.value = rand(0.9, 1.1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    const off = Math.random() * Math.max(0, src.buffer.duration - dur - 0.1);
    src.start(t, off, dur + 0.05);
    return g;
  }

  _tone(dest, t, { f0 = 200, f1 = null, dur = 0.1, gain = 0.5, type = 'sine', attack = 0.002 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // ------------------------------------------------------------------
  // 무기
  // ------------------------------------------------------------------
  playerGunshot() {
    if (!this.ready) return;
    const t = this.now;
    const out = this.ctx.createGain();
    out.gain.value = 0.9;
    out.connect(this.sfx);
    const rs = this.ctx.createGain();
    rs.gain.value = 0.7;
    out.connect(rs).connect(this.reverbSend);
    this._noiseBurst(out, t, { dur: 0.16, gain: 1.0, type: 'bandpass', freq: rand(900, 1300), q: 0.6 });
    this._noiseBurst(out, t, { dur: 0.04, gain: 0.7, type: 'highpass', freq: 3500, q: 0.5 });
    this._tone(out, t, { f0: 170, f1: 48, dur: 0.14, gain: 0.95 });
    this._noiseBurst(out, t + 0.01, { dur: 0.35, gain: 0.25, type: 'lowpass', freq: 600, q: 0.3, buffer: this.brown });
    // 탄피 짤랑 (약간 뒤)
    if (Math.random() < 0.5) this._tone(this.sfx, t + rand(0.25, 0.4), { f0: rand(4200, 5200), dur: 0.05, gain: 0.03, type: 'triangle' });
  }

  enemyGunshot(pos) {
    if (!this.ready) return;
    const t = this.now;
    const d = this._dist(pos);
    const out = this._spatial(pos, { ref: 6, rolloff: 0.9, reverb: Math.min(1.2, 0.3 + d / 40) });
    this._noiseBurst(out, t, { dur: 0.14, gain: 1.0, type: 'bandpass', freq: rand(700, 1100), q: 0.6 });
    this._tone(out, t, { f0: 140, f1: 45, dur: 0.12, gain: 0.8 });
    this._noiseBurst(out, t, { dur: 0.03, gain: 0.5, type: 'highpass', freq: 3000, q: 0.5 });
  }

  // 아군 소총 (직선 탄창 소총 — 조금 더 날카로운 음색, 같은 거리감)
  allyGunshot(pos) {
    if (!this.ready) return;
    const t = this.now;
    const d = this._dist(pos);
    const out = this._spatial(pos, { ref: 6, rolloff: 0.9, reverb: Math.min(1.2, 0.3 + d / 40) });
    this._noiseBurst(out, t, { dur: 0.12, gain: 0.9, type: 'bandpass', freq: rand(1100, 1500), q: 0.7 });
    this._tone(out, t, { f0: 160, f1: 55, dur: 0.1, gain: 0.7 });
    this._noiseBurst(out, t, { dur: 0.03, gain: 0.55, type: 'highpass', freq: 3600, q: 0.5 });
  }

  // 무전 잡음 (콜아웃 앞)
  radioClick() {
    if (!this.ready) return;
    const t = this.now;
    this._noiseBurst(this.ui, t, { dur: 0.09, gain: 0.12, type: 'bandpass', freq: 2200, q: 3 });
    this._tone(this.ui, t, { f0: 1600, dur: 0.03, gain: 0.04, type: 'square' });
  }

  // 비명 (위치 사운드) — 톱니파 + 비브라토 + 포먼트 필터
  scream(pos, elder = false) {
    if (!this.ready || this._dist(pos) > 45) return;
    const ctx = this.ctx;
    const t = this.now;
    const out = this._spatial(pos, { ref: 4, rolloff: 1.0, reverb: 0.4 });
    const dur = rand(0.55, 0.95);
    const base = elder ? rand(260, 380) : rand(420, 720);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 0.85, t);
    o.frequency.linearRampToValueAtTime(base * 1.15, t + dur * 0.3);
    o.frequency.linearRampToValueAtTime(base * 0.8, t + dur);
    const lfo = ctx.createOscillator();
    lfo.frequency.value = rand(6, 9);
    const lg = ctx.createGain();
    lg.gain.value = base * 0.05;
    lfo.connect(lg).connect(o.frequency);
    const f1 = ctx.createBiquadFilter();
    f1.type = 'bandpass';
    f1.frequency.value = rand(900, 1300);
    f1.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.setValueAtTime(0.5, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f1).connect(g).connect(out);
    o.start(t);
    lfo.start(t);
    o.stop(t + dur + 0.05);
    lfo.stop(t + dur + 0.05);
  }

  // 오인 사격 경고음 — 사살음과 확실히 다른 거친 버저
  friendlyFire(killed) {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.ui, t, { f0: 110, dur: killed ? 0.55 : 0.32, gain: 0.32, type: 'square' });
    this._tone(this.ui, t, { f0: 117, dur: killed ? 0.55 : 0.32, gain: 0.28, type: 'square' });
    this._tone(this.ui, t + 0.02, { f0: 220, f1: 150, dur: 0.25, gain: 0.12, type: 'sawtooth' });
  }

  // 민간인 대피 성공 — 부드러운 짧은 알림
  evacChime() {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.ui, t, { f0: 660, dur: 0.18, gain: 0.07, type: 'sine' });
    this._tone(this.ui, t + 0.1, { f0: 990, dur: 0.22, gain: 0.06, type: 'sine' });
  }

  dryFire() {
    if (!this.ready) return;
    const t = this.now;
    this._noiseBurst(this.sfx, t, { dur: 0.03, gain: 0.25, type: 'highpass', freq: 2500 });
    this._tone(this.sfx, t, { f0: 1800, dur: 0.03, gain: 0.08, type: 'square' });
  }

  // 재장전 단계별 소리: 'out' | 'in' | 'bolt'
  reload(stage) {
    if (!this.ready) return;
    const t = this.now;
    if (stage === 'out') {
      this._tone(this.sfx, t, { f0: 2400, dur: 0.03, gain: 0.12, type: 'square' });
      this._noiseBurst(this.sfx, t + 0.02, { dur: 0.12, gain: 0.25, type: 'bandpass', freq: 2200, q: 2 });
    } else if (stage === 'in') {
      this._noiseBurst(this.sfx, t, { dur: 0.06, gain: 0.45, type: 'bandpass', freq: 1500, q: 1.5 });
      this._tone(this.sfx, t, { f0: 320, f1: 200, dur: 0.07, gain: 0.3 });
      this._tone(this.sfx, t + 0.05, { f0: 3000, dur: 0.02, gain: 0.08, type: 'square' });
    } else if (stage === 'bolt') {
      this._noiseBurst(this.sfx, t, { dur: 0.07, gain: 0.4, type: 'bandpass', freq: 2600, q: 2 });
      this._noiseBurst(this.sfx, t + 0.13, { dur: 0.06, gain: 0.5, type: 'bandpass', freq: 1900, q: 2 });
      this._tone(this.sfx, t + 0.13, { f0: 900, f1: 600, dur: 0.05, gain: 0.15, type: 'triangle' });
    }
  }

  // ------------------------------------------------------------------
  // 3단계: 위장 적·관찰
  // ------------------------------------------------------------------
  // 관찰 모드 집중: 주변 소리(환경·효과음)를 줄임 (0 = 평소)
  setFocus(f) {
    if (!this.ready || Math.abs(f - this._focus) < 0.01) return;
    this._focus = f;
    const t = this.ctx.currentTime;
    this.amb.gain.setTargetAtTime(0.9 * (1 - 0.8 * f), t, 0.08);
    this.sfx.gain.setTargetAtTime(1 - 0.55 * f, t, 0.08);
  }

  // 관찰 모드 들어감/나옴 — 숨 들이쉬는 듯한 짧은 소리
  observe(on) {
    if (!this.ready) return;
    const t = this.now;
    this._noiseBurst(this.ui, t, { dur: on ? 0.32 : 0.2, gain: 0.07, type: 'bandpass', freq: on ? 700 : 1100, freqEnd: on ? 380 : 1500, q: 1.2, attack: 0.08 });
  }

  // 관찰로 사실 하나를 알아챔 (이상한 사실은 조금 다른 음)
  notice(anomalous) {
    if (!this.ready) return;
    const t = this.now;
    if (anomalous) {
      this._tone(this.ui, t, { f0: 1320, dur: 0.12, gain: 0.07, type: 'triangle' });
      this._tone(this.ui, t + 0.07, { f0: 990, dur: 0.18, gain: 0.06, type: 'triangle' });
    } else this._tone(this.ui, t, { f0: 1760, dur: 0.06, gain: 0.04, type: 'sine' });
  }

  // 정체를 드러내는 순간: 장전음 "철컥" (위치 사운드, 크게)
  rack(pos) {
    if (!this.ready) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 6, rolloff: 0.8, reverb: 0.25, muffle: false });
    const g = this.ctx.createGain();
    g.gain.value = 2.2;
    g.connect(out);
    this._noiseBurst(g, t, { dur: 0.05, gain: 0.8, type: 'bandpass', freq: 2600, q: 2.5 });
    this._tone(g, t, { f0: 1500, f1: 900, dur: 0.04, gain: 0.35, type: 'square' });
    this._noiseBurst(g, t + 0.16, { dur: 0.06, gain: 0.9, type: 'bandpass', freq: 1900, q: 2.5 });
    this._tone(g, t + 0.16, { f0: 1100, f1: 600, dur: 0.06, gain: 0.4, type: 'square' });
  }

  // 정체가 드러날 때 짧은 긴장 효과음 (불협화음이 부풀었다 끊김)
  revealSting() {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.ui, t, { f0: 92, f1: 110, dur: 0.55, gain: 0.22, type: 'sawtooth', attack: 0.12 });
    this._tone(this.ui, t, { f0: 98, f1: 117, dur: 0.55, gain: 0.18, type: 'sawtooth', attack: 0.12 });
    this._tone(this.ui, t + 0.05, { f0: 1480, f1: 1560, dur: 0.4, gain: 0.04, type: 'sine', attack: 0.2 });
  }

  // 테이프 완장을 뜯는 소리
  tapeRip(pos) {
    if (!this.ready) return;
    const out = this._spatial(pos, { ref: 3, rolloff: 1.2, reverb: 0.1 });
    this._noiseBurst(out, this.now, { dur: 0.22, gain: 0.6, type: 'bandpass', freq: 3200, freqEnd: 1400, q: 1.5, attack: 0.01 });
  }

  // 숨긴 총이 바닥에 떨어지는 소리
  clatter(pos) {
    if (!this.ready) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 3, rolloff: 1.2, reverb: 0.2 });
    this._tone(out, t + 0.25, { f0: rand(1800, 2400), dur: 0.12, gain: 0.25, type: 'triangle' });
    this._noiseBurst(out, t + 0.25, { dur: 0.08, gain: 0.5, type: 'bandpass', freq: 1500, q: 1.2 });
    this._tone(out, t + 0.4, { f0: rand(1300, 1700), dur: 0.08, gain: 0.15, type: 'triangle' });
  }

  // 정찰형 위장 적이 무전기에 대고 말함 (작은 잡음)
  enemyRadio(pos) {
    if (!this.ready || this._dist(pos) > 30) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 2, rolloff: 1.4, reverb: 0.05 });
    for (let i = 0; i < 3; i++) this._noiseBurst(out, t + i * 0.22, { dur: 0.12, gain: 0.25, type: 'bandpass', freq: 1800, q: 4 });
  }

  // 위장 적 사살 확인 (오인 사격 버저와 확실히 다른 밝은 음)
  disguiseKill() {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.ui, t, { f0: 660, dur: 0.12, gain: 0.1, type: 'triangle' });
    this._tone(this.ui, t + 0.09, { f0: 990, dur: 0.14, gain: 0.1, type: 'triangle' });
    this._tone(this.ui, t + 0.18, { f0: 1320, dur: 0.24, gain: 0.09, type: 'triangle' });
  }

  // ------------------------------------------------------------------
  // 피드백
  // ------------------------------------------------------------------
  hitMarker(headshot) {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.ui, t, { f0: 2300, dur: 0.045, gain: 0.22, type: 'triangle' });
    if (headshot) {
      this._tone(this.ui, t, { f0: 3400, dur: 0.28, gain: 0.12, type: 'sine' });
      this._tone(this.ui, t, { f0: 4570, dur: 0.22, gain: 0.07, type: 'sine' });
    }
  }

  kill(headshot) {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.ui, t, { f0: 140, f1: 55, dur: 0.2, gain: 0.55 });
    this._noiseBurst(this.ui, t, { dur: 0.06, gain: 0.25, type: 'lowpass', freq: 900 });
    this._tone(this.ui, t + 0.03, { f0: 880, dur: 0.16, gain: 0.12, type: 'triangle' });
    this._tone(this.ui, t + 0.1, { f0: headshot ? 1760 : 1320, dur: 0.22, gain: 0.1, type: 'triangle' });
  }

  hurt() {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.sfx, t, { f0: 90, f1: 50, dur: 0.18, gain: 0.6 });
    this._noiseBurst(this.sfx, t, { dur: 0.12, gain: 0.35, type: 'lowpass', freq: 500 });
  }

  // 귀 옆을 스치는 총알: side -1(왼쪽) ~ 1(오른쪽)
  whiz(side = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now;
    const p = ctx.createStereoPanner();
    p.pan.setValueAtTime(-side * 0.9, t);
    p.pan.linearRampToValueAtTime(side * 0.9, t + 0.16);
    p.connect(this.sfx);
    this._noiseBurst(p, t, { dur: 0.17, gain: 0.55, type: 'bandpass', freq: 4200, freqEnd: 900, q: 4, attack: 0.05 });
    this._noiseBurst(p, t, { dur: 0.025, gain: 0.35, type: 'highpass', freq: 5000 });
  }

  impact(pos, surface) {
    if (!this.ready || this._dist(pos) > 45) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 2, rolloff: 1.4, reverb: 0.15 });
    if (surface === 'metal') this._tone(out, t, { f0: rand(1800, 2600), dur: 0.12, gain: 0.25, type: 'triangle' });
    this._noiseBurst(out, t, { dur: 0.06, gain: 0.4, type: 'bandpass', freq: surface === 'dirt' || surface === 'sand' ? 700 : 1800, q: 1 });
  }

  // ------------------------------------------------------------------
  // 이동·환경
  // ------------------------------------------------------------------
  footstep(pos, { player = false, surface = 'concrete', volume = 1, run = false } = {}) {
    if (!this.ready) return;
    const t = this.now;
    let out;
    if (player) {
      out = this.ctx.createGain();
      out.gain.value = 0.35 * volume;
      out.connect(this.sfx);
    } else {
      if (this._npcSteps >= CONFIG.audio.maxNpcFootsteps || this._dist(pos) > 40) return;
      this._npcSteps++;
      setTimeout(() => this._npcSteps--, 120);
      out = this._spatial(pos, { ref: 3, rolloff: 1.3, reverb: 0.2 });
      const g = this.ctx.createGain(); // panner 앞단 게인
      g.gain.value = 0.9 * volume;
      g.connect(out);
      out = g;
    }
    const f = surface === 'rubble' ? rand(1500, 2400) : surface === 'metal' ? rand(1200, 1600) : rand(500, 900);
    this._noiseBurst(out, t, { dur: run ? 0.07 : 0.055, gain: 0.5, type: 'bandpass', freq: f, q: 1.2 });
    this._tone(out, t, { f0: 95, f1: 55, dur: 0.06, gain: 0.35 });
    if (surface === 'rubble' || Math.random() < 0.3) {
      for (let i = 0; i < 4; i++) this._noiseBurst(out, t + rand(0.01, 0.07), { dur: 0.015, gain: 0.25, type: 'highpass', freq: 3000 });
    }
  }

  // 잔해 밟는 소리 (출현 예고)
  rubble(pos) {
    if (!this.ready) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 4, rolloff: 1.0, reverb: 0.3 });
    for (let i = 0; i < 12; i++) {
      this._noiseBurst(out, t + rand(0, 0.5), { dur: rand(0.01, 0.04), gain: rand(0.2, 0.5), type: 'bandpass', freq: rand(1200, 4000), q: 1.5 });
    }
    this._noiseBurst(out, t + 0.1, { dur: 0.3, gain: 0.25, type: 'lowpass', freq: 500, buffer: this.brown });
  }

  // 문 삐걱 + 쾅 (출현 예고)
  door(pos) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now;
    const out = this._spatial(pos, { ref: 4, rolloff: 1.0, reverb: 0.4 });
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(rand(70, 110), t);
    for (let i = 1; i <= 6; i++) o.frequency.linearRampToValueAtTime(rand(60, 160), t + i * 0.08);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100;
    bp.Q.value = 6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
    g.gain.setValueAtTime(0.5, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(bp).connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.6);
    this._tone(out, t + 0.58, { f0: 120, f1: 50, dur: 0.18, gain: 0.7 });
    this._noiseBurst(out, t + 0.58, { dur: 0.1, gain: 0.4, type: 'lowpass', freq: 800 });
  }

  // 유리 조각 밟는 소리 (창문 사수 예고)
  glass(pos) {
    if (!this.ready) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 4, rolloff: 1.0, reverb: 0.3 });
    for (let i = 0; i < 8; i++) this._tone(out, t + rand(0, 0.35), { f0: rand(3000, 6500), dur: rand(0.03, 0.08), gain: rand(0.05, 0.12), type: 'triangle' });
    this._noiseBurst(out, t, { dur: 0.2, gain: 0.2, type: 'highpass', freq: 4000 });
  }

  // 발소리 연속 (출현 예고)
  footstepSequence(pos, count = 4, interval = 0.28) {
    for (let i = 0; i < count; i++) {
      setTimeout(() => this.footstep(pos, { surface: Math.random() < 0.4 ? 'rubble' : 'concrete', volume: 1.25, run: true }), i * interval * 1000);
    }
  }

  crackle(pos) {
    if (!this.ready || this._dist(pos) > 22) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 2, rolloff: 1.5, reverb: 0, muffle: false });
    this._noiseBurst(out, t, { dur: rand(0.01, 0.03), gain: rand(0.08, 0.2), type: 'highpass', freq: rand(1500, 4000) });
  }

  // 멀리서 울리는 포성 (방위: 청자 기준 좌우 pan)
  distantBoom(pan = 0, strength = 1) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    const g = ctx.createGain();
    g.gain.value = 0.55 * strength;
    p.connect(g).connect(this.amb);
    const rs = ctx.createGain();
    rs.gain.value = 0.4;
    g.connect(rs).connect(this.reverbSend);
    this._noiseBurst(p, t, { dur: rand(2.0, 3.2), gain: 1.0, type: 'lowpass', freq: 220, q: 0.4, buffer: this.brown, attack: 0.02 });
    this._tone(p, t, { f0: 52, f1: 28, dur: 1.4, gain: 0.8, attack: 0.01 });
  }

  // 먼 교전 소리 (배경)
  distantGunfire(pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = this.now;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.value = 0.12;
    p.connect(g).connect(this.amb);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(p);
    const n = Math.floor(rand(3, 9));
    const auto = Math.random() < 0.5;
    let t = t0;
    for (let i = 0; i < n; i++) {
      this._noiseBurst(lp, t, { dur: 0.12, gain: 0.9, type: 'bandpass', freq: 500, q: 0.6 });
      t += auto ? rand(0.08, 0.12) : rand(0.25, 0.8);
    }
  }

  _startAmbience() {
    const ctx = this.ctx;
    // 바람: 루프 노이즈 + 느린 필터 LFO
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 420;
    bp.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 220;
    lfo.connect(lfoGain).connect(bp.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.07;
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.13;
    const lfo2g = ctx.createGain();
    lfo2g.gain.value = 0.03;
    lfo2.connect(lfo2g).connect(g.gain);
    src.connect(bp).connect(g).connect(this.amb);
    src.start();
    lfo.start();
    lfo2.start();
    // 낮은 웅웅거림
    const hum = ctx.createBufferSource();
    hum.buffer = this.brown;
    hum.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 120;
    const hg = ctx.createGain();
    hg.gain.value = 0.12;
    hum.connect(lp).connect(hg).connect(this.amb);
    hum.start();
  }

  // 심장 박동 — 체력이 낮을 때, 관찰 모드에서는 더 느리고 작게(soft)
  updateHeartbeat(active, time, soft = false) {
    if (!this.ready) return;
    if (active && time >= this._nextBeat) {
      this._nextBeat = time + (soft ? 1.05 : 0.85);
      const t = this.now;
      const k = soft ? 0.55 : 1;
      this._tone(this.ui, t, { f0: 62, f1: 40, dur: 0.12, gain: 0.5 * k });
      this._tone(this.ui, t + 0.18, { f0: 58, f1: 38, dur: 0.12, gain: 0.35 * k });
    }
  }
}
