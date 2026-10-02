// 자막·음성 모듈 — 무전·외침을 화면 하단 자막으로 출력 (화자 라벨, 겹치면 큐 처리)
// 선택: Web Speech API(speechSynthesis, ko-KR) 음성. 화자마다 음높이·속도를 다르게, 한국어 음성이 없으면 자막만.
// 게임 로직과 독립적인 모듈 — 4단계 대화 시스템(dialogue/DialogueSystem.js)이 그대로 재사용한다 (플레이어 대사는 channel 'player').
//
// 사용:  voice.say({ speaker: '아군 무전', text: '적 발견!', channel: 'radio', priority: 1, voice: { id, pitch, rate } })
//        voice.mute('radio', 30)  /  voice.update(dt)  /  voice.setSpeech(true)

const CHANNEL_CLASS = { radio: 'radio', shout: 'shout', civilian: 'civilian', system: 'system', enemy: 'enemy', player: 'player' };

export class VoiceSystem {
  /**
   * @param {object} o { container: HTMLElement, maxLines, baseDuration, perChar, dedupeWindow, onRadio: () => void }
   */
  constructor(o = {}) {
    this.container = o.container || null;
    this.maxLines = o.maxLines ?? 3;
    this.baseDuration = o.baseDuration ?? 1.7;
    this.perChar = o.perChar ?? 0.06;
    this.dedupeWindow = o.dedupeWindow ?? 3;
    this.onRadio = o.onRadio || null; // 무전 잡음 등 효과음 훅
    this.time = 0;
    this.queue = [];
    this.lines = [];
    this.muted = {}; // 채널 → 해제 시각
    this.recent = new Map(); // 문장 → 마지막 출력 시각
    this.history = []; // 최근 출력 기록 (디버그·테스트용)
    this.speechEnabled = false;
    this.koVoice = null;
    this.speechAvailable = false;
    this._initSpeech();
  }

  _initSpeech() {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) return;
    const pick = () => {
      const voices = synth.getVoices() || [];
      this.koVoice = voices.find((v) => /^ko(-|_|$)/i.test(v.lang)) || null;
      this.speechAvailable = !!this.koVoice;
    };
    pick();
    if (typeof synth.addEventListener === 'function') synth.addEventListener('voiceschanged', pick);
  }

  setSpeech(enabled) {
    this.speechEnabled = !!enabled;
    if (!enabled && typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  }

  mute(channel, seconds) {
    this.muted[channel] = Math.max(this.muted[channel] || 0, this.time + seconds);
  }

  isMuted(channel) {
    return (this.muted[channel] || 0) > this.time;
  }

  muteRemaining(channel) {
    return Math.max(0, (this.muted[channel] || 0) - this.time);
  }

  /**
   * 대사 출력 요청
   * @param {object} line { speaker, text, channel='shout', priority=1, voice={id,pitch,rate}, force=false, duration, nodedupe=false }
   *   nodedupe: 같은 문장 반복 억제를 건너뜀 (4단계 문답처럼 같은 말을 일부러 되풀이할 때)
   * @returns {boolean} 큐에 들어갔는지
   */
  say(line) {
    const channel = line.channel || 'shout';
    if (!line.force && this.isMuted(channel)) return false;
    const key = `${line.speaker}|${line.text}`;
    const last = this.recent.get(key);
    if (!line.nodedupe && last != null && this.time - last < this.dedupeWindow) return false;
    this.recent.set(key, this.time);
    const item = {
      speaker: line.speaker || '',
      text: line.text,
      channel,
      priority: line.priority ?? 1,
      voice: line.voice || null,
      duration: line.duration ?? this.baseDuration + this.perChar * line.text.length,
      queuedAt: this.time,
    };
    // 높은 우선순위는 큐 앞쪽으로
    let i = this.queue.findIndex((q) => q.priority < item.priority);
    if (i < 0) i = this.queue.length;
    this.queue.splice(i, 0, item);
    // 너무 밀리면 낮은 우선순위·오래된 것부터 버림
    while (this.queue.length > 6) this.queue.pop();
    // 최우선(3)은 즉시 표시
    if (item.priority >= 3 && this.lines.length >= this.maxLines) this._expire(this.lines[0]);
    return true;
  }

  update(dt) {
    this.time += dt;
    for (const l of [...this.lines]) if (this.time >= l.until) this._expire(l);
    // 큐에서 오래 기다린 일반 대사는 버림 (상황이 지나감)
    this.queue = this.queue.filter((q) => q.priority >= 2 || this.time - q.queuedAt < 4);
    while (this.lines.length < this.maxLines && this.queue.length) this._show(this.queue.shift());
    if (this.recent.size > 200) {
      for (const [k, t] of this.recent) if (this.time - t > 30) this.recent.delete(k);
    }
  }

  _show(item) {
    item.until = this.time + item.duration;
    this.lines.push(item);
    this.history.push({ t: this.time, speaker: item.speaker, text: item.text, channel: item.channel });
    if (this.history.length > 80) this.history.shift();
    if (this.container) {
      const div = document.createElement('div');
      div.className = `sub ${CHANNEL_CLASS[item.channel] || 'shout'}`;
      const label = document.createElement('span');
      label.className = 'who';
      label.textContent = `[${item.speaker}]`;
      const txt = document.createElement('span');
      txt.className = 'txt';
      txt.textContent = ` ${item.text}`;
      div.append(label, txt);
      this.container.appendChild(div);
      item.el = div;
    }
    if (item.channel === 'radio' && this.onRadio) this.onRadio();
    this._speak(item);
  }

  _expire(item) {
    const i = this.lines.indexOf(item);
    if (i >= 0) this.lines.splice(i, 1);
    if (item.el) {
      item.el.classList.add('out');
      const el = item.el;
      setTimeout(() => el.remove(), 350);
    }
  }

  _speak(item) {
    if (!this.speechEnabled || !this.speechAvailable) return;
    const synth = window.speechSynthesis;
    if (!synth || typeof window.SpeechSynthesisUtterance !== 'function') return;
    // 밀린 음성은 버리고 최신 대사 위주로
    if (synth.pending || (synth.speaking && item.priority >= 2)) synth.cancel();
    const u = new window.SpeechSynthesisUtterance(item.text);
    u.voice = this.koVoice;
    u.lang = this.koVoice.lang;
    const v = item.voice || {};
    u.pitch = Math.max(0.1, Math.min(2, v.pitch ?? 1));
    u.rate = Math.max(0.5, Math.min(2, (v.rate ?? 1) * (item.channel === 'radio' ? 1.1 : 1.15)));
    u.volume = 1;
    try {
      synth.speak(u);
    } catch {
      // 음성 출력 실패는 자막만으로 대체
    }
  }

  clear() {
    this.queue.length = 0;
    for (const l of [...this.lines]) this._expire(l);
    this.muted = {};
    this.recent.clear();
    if (typeof window !== 'undefined' && window.speechSynthesis) window.speechSynthesis.cancel();
  }
}
