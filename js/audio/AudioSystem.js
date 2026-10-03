// 사운드 — 외부 파일 없이 Web Audio API 로 모두 합성
// AudioContext 는 시작 버튼을 누를 때 생성 (브라우저 자동재생 정책)
// 5단계 믹스: master → (사망 시 먹먹하게) → 압축기 → 출력
//   버스: sfx(총성·피탄·발소리) / amb(바람·먼 교전 — 실내에선 먹먹하게) / ui(피드백) / voice(무전 잡음 — TTS 음량도 같은 설정) / music(긴장 드론)
//   우선순위(덕킹): 무전·대사가 들리는 동안 amb·music(·sfx 조금)을 줄임, 관찰 중엔 주변 소리를 줄임(setFocus)
//   잔향: 실외(긴 꼬리)와 실내(짧은 반사) 두 컨볼버를 플레이어 위치에 따라 교차
//   먼 교전: 원거리 소총·기관총 / 중거리 교전 / 가끔 먼 사이렌 — 위협 단계가 오를수록 잦아짐
//   긴장 음악: 낮은 드론 + 잡음 바닥 + (고조되면) 높은 떨림·맥동 — 위협 단계·주변 적·습격·관찰/대화·저체력에 반응
import { CONFIG } from '../config.js';

const rand = (a, b) => a + Math.random() * (b - a);

export class AudioSystem {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.volume = CONFIG.audio.masterVolume;
    this.vol = { sfx: 1, voice: 1, music: 0.7 }; // 설정 음량 (버스별)
    this.mixState = { focus: 0, duck: 0, indoor: 0, dead: 0 };
    this._applied = {};
    this._npcSteps = 0;
    this._heartbeat = false;
    this._nextBeat = 0;
    this._focus = 0;
    this.tension = 0;
    this._pulseT = 0;
    this._battle = { far: 4, mid: 12, siren: 70 };
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

    const A = CONFIG.audio;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    // 사망 시 먹먹하게 (저역 통과)
    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 20000;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    this.comp = comp;
    this.master.connect(this.masterFilter).connect(comp).connect(ctx.destination);

    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    // 환경음: 실내에선 바깥 소리를 먹먹하게
    this.amb = ctx.createGain();
    this.amb.gain.value = A.mix.amb;
    this.ambFilter = ctx.createBiquadFilter();
    this.ambFilter.type = 'lowpass';
    this.ambFilter.frequency.value = 20000;
    this.amb.connect(this.ambFilter).connect(this.master);
    this.ui = ctx.createGain();
    this.ui.gain.value = A.mix.ui;
    this.ui.connect(this.master);
    this.voice = ctx.createGain();
    this.voice.gain.value = A.mix.voice;
    this.voice.connect(this.master);
    this.music = ctx.createGain();
    this.music.gain.value = 0;
    this.music.connect(this.master);

    // 잔향: 실외(도심 메아리, 긴 꼬리) / 실내(방 안 짧은 반사) — 플레이어 위치에 따라 교차
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.55;
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(A.reverbSeconds, 2.6);
    this.roomReverb = ctx.createConvolver();
    this.roomReverb.buffer = this._impulse(A.roomReverbSeconds, 1.6, 0.06);
    this.outGain = ctx.createGain();
    this.outGain.gain.value = 1;
    this.roomGain = ctx.createGain();
    this.roomGain.gain.value = 0;
    this.reverbSend.connect(this.outGain).connect(this.reverb).connect(this.master);
    this.reverbSend.connect(this.roomGain).connect(this.roomReverb).connect(this.master);

    this.noise = this._noiseBuffer(2.0, 'white');
    this.brown = this._noiseBuffer(3.0, 'brown');

    this._startAmbience();
    this._startMusic();
    this.ready = true;
    this._applied = {};
    this._applyMix(true);
  }

  // ------------------------------------------------------------------
  // 5단계 믹스
  // ------------------------------------------------------------------
  /** 설정 음량 (0~1): master·sfx·voice·music */
  setVolumes({ master, sfx, voice, music }) {
    if (master != null) this.setVolume(master);
    if (sfx != null) this.vol.sfx = sfx;
    if (voice != null) this.vol.voice = voice;
    if (music != null) this.vol.music = music;
    this._applyMix(true);
  }

  /** 매 프레임 상태: focus(관찰 0~1) / duck(무전·대사 0~1) / indoor(실내 0~1) / dead(사망 0~1) */
  updateMix(state) {
    const m = this.mixState;
    m.focus = state.focus ?? m.focus;
    m.duck += ((state.duck ?? 0) - m.duck) * Math.min(1, (state.dt || 0.016) * ((state.duck ?? 0) > m.duck ? 8 : 2.5));
    m.indoor += ((state.indoor ?? 0) - m.indoor) * Math.min(1, (state.dt || 0.016) * 3);
    m.dead = state.dead ?? m.dead;
    this._applyMix(false);
  }

  _applyMix(force) {
    if (!this.ready) return;
    const A = CONFIG.audio;
    const m = this.mixState;
    const D = A.duck;
    const t = this.ctx.currentTime;
    const set = (key, param, v, tc = 0.08) => {
      const prev = this._applied[key];
      if (!force && prev != null && Math.abs(prev - v) < 0.004) return;
      this._applied[key] = v;
      param.setTargetAtTime(v, t, tc);
    };
    set('sfx', this.sfx.gain, this.vol.sfx * (1 - 0.55 * m.focus) * (1 - D.sfx * m.duck));
    set('amb', this.amb.gain, A.mix.amb * this.vol.sfx * (1 - 0.8 * m.focus) * (1 - D.amb * m.duck));
    set('ui', this.ui.gain, A.mix.ui * this.vol.sfx);
    set('voice', this.voice.gain, A.mix.voice * this.vol.voice);
    set('music', this.music.gain, A.mix.music * this.vol.music * (1 - D.music * m.duck) * (1 - 0.6 * m.dead), 0.25);
    set('ambLp', this.ambFilter.frequency, 20000 - (20000 - A.indoorAmbMuffle) * Math.min(1, m.indoor), 0.15);
    set('outRev', this.outGain.gain, 1 - 0.7 * m.indoor, 0.2);
    set('roomRev', this.roomGain.gain, 0.9 * m.indoor, 0.2);
  }

  /** 사망 연출: 먹먹해지고 귀울림 (dismissed 면 귀울림 없이 조금만) */
  onDeath(ring = true) {
    if (!this.ready) return;
    const t = this.now;
    this.masterFilter.frequency.cancelScheduledValues(t);
    this.masterFilter.frequency.setValueAtTime(this.masterFilter.frequency.value, t);
    this.masterFilter.frequency.exponentialRampToValueAtTime(ring ? 520 : 2400, t + 1.1);
    if (!ring) return;
    // 귀울림: 압축기 뒤로 바로 (먹먹함의 영향을 받지 않게)
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.value = rand(3100, 3500);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05 * this.volume, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    o.connect(g).connect(this.comp);
    o.start(t);
    o.stop(t + 3.3);
  }

  /** 새 판·메뉴: 사망 먹먹함 해제, 음악 긴장 0 */
  resetRun() {
    this.tension = 0;
    this.mixState.dead = 0;
    this.mixState.duck = 0;
    if (!this.ready) return;
    const t = this.now;
    this.masterFilter.frequency.cancelScheduledValues(t);
    this.masterFilter.frequency.setValueAtTime(20000, t);
    this._applyMix(true);
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

  // earlyDensity: 이른 반사 비율 (실내는 벽이 가까워 촘촘한 반사)
  _impulse(sec, decay, earlyDensity = 0.01) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 초반 이른 반사 + 지수 감쇠 꼬리
        const early = i < ctx.sampleRate * 0.08 && Math.random() < earlyDensity ? 1.5 : 0;
        d[i] = ((Math.random() * 2 - 1) + early) * Math.pow(1 - t, decay);
      }
    }
    return buf;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  get voiceLevel() {
    return this.volume * this.vol.voice;
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
    this._noiseBurst(this.voice, t, { dur: 0.09, gain: 0.12, type: 'bandpass', freq: 2200, q: 3 });
    this._tone(this.voice, t, { f0: 1600, dur: 0.03, gain: 0.04, type: 'square' });
  }

  // 5단계 신호음: 암구호 교체 (무전 삐 소리 세 번)
  countersignCue() {
    if (!this.ready) return;
    const t = this.now;
    this._noiseBurst(this.voice, t, { dur: 0.12, gain: 0.1, type: 'bandpass', freq: 2000, q: 2 });
    for (let i = 0; i < 3; i++) this._tone(this.voice, t + 0.14 + i * 0.13, { f0: 1180, dur: 0.07, gain: 0.07, type: 'square' });
  }

  // 5단계 신호음: 습격 시작 (낮게 부풀어 오르는 금관 같은 화음 + 바람 소리)
  assaultCue() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(180, t);
    lp.frequency.exponentialRampToValueAtTime(1400, t + 0.7);
    lp.frequency.exponentialRampToValueAtTime(300, t + 1.4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.5);
    lp.connect(g).connect(this.ui);
    for (const f of [73.4, 110, 146.8]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.97, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.5);
      o.connect(lp);
      o.start(t);
      o.stop(t + 1.55);
    }
    this._noiseBurst(this.ui, t + 0.1, { dur: 1.1, gain: 0.06, type: 'bandpass', freq: 600, freqEnd: 1800, q: 0.8, attack: 0.4 });
  }

  // 5단계 신호음: 난이도 곡선 구간이 바뀜 (낮은 두 음)
  phaseCue() {
    if (!this.ready) return;
    const t = this.now;
    this._tone(this.ui, t, { f0: 196, dur: 0.5, gain: 0.08, type: 'triangle', attack: 0.05 });
    this._tone(this.ui, t + 0.18, { f0: 147, dur: 0.7, gain: 0.08, type: 'triangle', attack: 0.05 });
  }

  // 5단계: 가까이 맞은 탄 — 흙·파편이 후드득
  nearImpact(pos) {
    if (!this.ready) return;
    const t = this.now;
    const out = this._spatial(pos, { ref: 2, rolloff: 1.2, reverb: 0.1, muffle: false });
    this._noiseBurst(out, t, { dur: 0.09, gain: 0.7, type: 'bandpass', freq: 1400, q: 0.7 });
    for (let i = 0; i < 6; i++) this._noiseBurst(out, t + rand(0.05, 0.35), { dur: rand(0.01, 0.03), gain: rand(0.12, 0.3), type: 'highpass', freq: rand(2500, 5000) });
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
  // 관찰 모드 집중: 주변 소리(환경·효과음)를 줄임 (0 = 평소) — 5단계 믹스(updateMix)의 focus
  setFocus(f) {
    if (!this.ready || Math.abs(f - this._focus) < 0.01) return;
    this._focus = f;
    this.mixState.focus = f;
    this._applyMix(false);
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

  // 먼 교전 소리 (배경) — near: 0 = 아주 멀리(먹먹), 1 = 중거리(조금 또렷하고 큼)
  distantGunfire(pan = 0, near = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t0 = this.now;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.value = 0.12 + near * 0.13;
    p.connect(g).connect(this.amb);
    const rs = ctx.createGain();
    rs.gain.value = 0.25 + near * 0.2;
    g.connect(rs).connect(this.reverbSend);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900 + near * 1500;
    lp.connect(p);
    const auto = Math.random() < 0.5;
    const n = auto ? Math.floor(rand(5, 14)) : Math.floor(rand(3, 9));
    let t = t0;
    for (let i = 0; i < n; i++) {
      this._noiseBurst(lp, t, { dur: 0.12, gain: 0.9, type: 'bandpass', freq: 500 + near * 300, q: 0.6 });
      if (near > 0.5) this._tone(lp, t, { f0: 120, f1: 45, dur: 0.1, gain: 0.35 });
      t += auto ? rand(0.075, 0.11) : rand(0.25, 0.8);
    }
    // 중거리: 맞받아 쏘는 다른 쪽 총성
    if (near > 0.5 && Math.random() < 0.7) {
      const p2 = ctx.createStereoPanner();
      p2.pan.value = Math.max(-1, Math.min(1, pan + rand(-0.5, 0.5)));
      p2.connect(g);
      let t2 = t0 + rand(0.4, 1.2);
      for (let i = 0; i < Math.floor(rand(2, 6)); i++) {
        this._noiseBurst(p2, t2, { dur: 0.1, gain: 0.6, type: 'bandpass', freq: 900, q: 0.7 });
        t2 += rand(0.2, 0.5);
      }
    }
  }

  // 아주 먼 사이렌 (드물게, 아주 작게)
  distantSiren(pan = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = this.now;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    const dur = rand(7, 11);
    o.frequency.setValueAtTime(320, t);
    for (let k = 0; k < 3; k++) {
      o.frequency.linearRampToValueAtTime(560, t + k * (dur / 3) + dur / 6);
      o.frequency.linearRampToValueAtTime(320, t + (k + 1) * (dur / 3));
    }
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const p = ctx.createStereoPanner();
    p.pan.value = pan;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.022, t + 2);
    g.gain.setValueAtTime(0.022, t + dur - 2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp).connect(p).connect(g).connect(this.amb);
    o.start(t);
    o.stop(t + dur + 0.1);
  }

  /** 5단계: 먼 교전 소리 층 (Game 이 매 프레임) — 위협 단계가 오를수록 잦아짐 */
  updateBattle(dt, threat) {
    if (!this.ready) return;
    const L = CONFIG.audio.distantLayers;
    const k = Math.max(0.45, 1.15 - 0.07 * threat); // 간격 배율
    const b = this._battle;
    b.far -= dt;
    b.mid -= dt;
    b.siren -= dt;
    if (b.far <= 0) {
      b.far = rand(L.far[0], L.far[1]) * k;
      this.distantGunfire(rand(-1, 1), 0);
    }
    if (b.mid <= 0) {
      b.mid = rand(L.mid[0], L.mid[1]) * k;
      this.distantGunfire(rand(-1, 1), rand(0.6, 1));
    }
    if (b.siren <= 0) {
      b.siren = rand(L.siren[0], L.siren[1]);
      this.distantSiren(rand(-0.8, 0.8));
    }
  }

  // ------------------------------------------------------------------
  // 5단계 긴장 음악 (합성 드론) — tension 0~1
  // ------------------------------------------------------------------
  _startMusic() {
    const ctx = this.ctx;
    const M = {};
    M.lp = ctx.createBiquadFilter();
    M.lp.type = 'lowpass';
    M.lp.frequency.value = 200;
    M.lp.Q.value = 1.2;
    M.drone = ctx.createGain();
    M.drone.gain.value = 0;
    M.lp.connect(M.drone).connect(this.music);
    M.oscs = [];
    for (const [f, type, detune] of [[55, 'sawtooth', -7], [55, 'sawtooth', 8], [82.4, 'triangle', 0], [41.2, 'sine', 0]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(M.lp);
      o.start();
      M.oscs.push(o);
    }
    // 느린 필터 흔들림
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = ctx.createGain();
    lg.gain.value = 60;
    lfo.connect(lg).connect(M.lp.frequency);
    lfo.start();
    // 잡음 바닥
    const nb = ctx.createBufferSource();
    nb.buffer = this.brown;
    nb.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 260;
    bp.Q.value = 0.9;
    M.bed = ctx.createGain();
    M.bed.gain.value = 0;
    nb.connect(bp).connect(M.bed).connect(this.music);
    nb.start();
    // 높은 떨림 (고조됐을 때만)
    const sh = ctx.createBufferSource();
    sh.buffer = this.noise;
    sh.loop = true;
    const sbp = ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 3300;
    sbp.Q.value = 9;
    const trem = ctx.createGain();
    trem.gain.value = 0.5;
    const tl = ctx.createOscillator();
    tl.frequency.value = 5.5;
    const tlg = ctx.createGain();
    tlg.gain.value = 0.5;
    tl.connect(tlg).connect(trem.gain);
    tl.start();
    M.shimmer = ctx.createGain();
    M.shimmer.gain.value = 0;
    sh.connect(sbp).connect(trem).connect(M.shimmer).connect(this.music);
    sh.start();
    this.mus = M;
  }

  /** 긴장도(0~1)에 맞춰 드론·잡음·떨림·맥동 조절 (매 프레임) */
  updateMusic(dt, tension) {
    if (!this.ready || !this.mus) return;
    this.tension = tension;
    const M = this.mus;
    const t = this.ctx.currentTime;
    const v = Math.max(0, Math.min(1, tension));
    const key = Math.round(v * 200);
    if (key !== this._musKey) {
      this._musKey = key;
      M.drone.gain.setTargetAtTime(0.02 + 0.13 * v, t, 0.6);
      M.lp.frequency.setTargetAtTime(150 + 950 * v * v, t, 0.6);
      M.bed.gain.setTargetAtTime(0.03 + 0.07 * v, t, 0.6);
      M.shimmer.gain.setTargetAtTime(v > 0.55 ? ((v - 0.55) / 0.45) * 0.05 : 0, t, 0.8);
    }
    // 맥동 (고조되면 북소리처럼)
    if (v > 0.45) {
      this._pulseT -= dt;
      if (this._pulseT <= 0) {
        this._pulseT = 60 / (56 + 54 * v);
        const g = 0.08 + 0.2 * (v - 0.45) / 0.55;
        this._tone(this.music, t, { f0: 58, f1: 34, dur: 0.22, gain: g });
        this._noiseBurst(this.music, t, { dur: 0.05, gain: g * 0.3, type: 'lowpass', freq: 400, buffer: this.brown });
      }
    } else this._pulseT = 0;
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
