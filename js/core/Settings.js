// 설정·기록 localStorage 저장
// 5단계: 설정 항목 확장(감도·정조준 감도·시야각·음량 4종·자막 크기·색각 보조·흔들림 줄이기·그래픽 프리셋·난이도·모드·키 설정),
//        기록은 모드 × 난이도별 최고 기록 + 최근 10판 (v1 기록은 '생존·보통'으로 옮김)
import { CONFIG } from '../config.js';

const SETTINGS_KEY = 'piasik.settings.v1';
const RECORDS_KEY_V1 = 'piasik.records.v1';
const RECORDS_KEY = 'piasik.records.v2';

function safeLoad(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function safeSave(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 시크릿 모드 등 저장 불가 환경은 조용히 무시
  }
}

const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));
const num = (v, d, lim) => {
  const n = Number(v);
  return Number.isFinite(n) ? clamp(n, lim) : d;
};
const bool = (v, d) => (typeof v === 'boolean' ? v : d);
const oneOf = (v, list, d) => (list.includes(v) ? v : d);

// 처음 config 에 적힌 키 (기본값 복원용)
const DEFAULT_KEYS = JSON.parse(JSON.stringify(CONFIG.keys));

export class Settings {
  constructor() {
    const saved = safeLoad(SETTINGS_KEY) || {};
    const d = CONFIG.defaults;
    const L = CONFIG.limits;
    this.sensitivity = num(saved.sensitivity, d.sensitivity, L.sensitivity);
    this.adsSensitivity = num(saved.adsSensitivity, d.adsSensitivity, L.adsSensitivity); // 정조준 중 감도 배율
    this.fov = num(saved.fov, d.fov, L.fov);
    this.volume = num(saved.volume, d.volume, L.volume); // 전체
    this.sfxVolume = num(saved.sfxVolume, d.sfxVolume, L.sfxVolume); // 효과음·환경음
    this.voiceVolume = num(saved.voiceVolume, d.voiceVolume, L.voiceVolume); // 무전·대사(잡음·TTS)
    this.musicVolume = num(saved.musicVolume, d.musicVolume, L.musicVolume); // 긴장 음악
    this.lastSeed = typeof saved.lastSeed === 'string' ? saved.lastSeed : null;
    this.speech = bool(saved.speech, d.speech); // 무전·외침 음성(TTS)
    this.countersignCard = bool(saved.countersignCard, d.countersignCard); // 4단계 암구호 카드 표시
    this.subtitleSize = oneOf(saved.subtitleSize, ['s', 'm', 'l'], d.subtitleSize);
    this.colorblind = bool(saved.colorblind, d.colorblind); // 표식 무늬 (적 X / 아군 세로 줄무늬)
    this.reduceShake = bool(saved.reduceShake, d.reduceShake);
    this.graphics = oneOf(saved.graphics, ['low', 'medium', 'high'], d.graphics); // null 이면 첫 실행 자동 추천
    this.graphicsAuto = saved.graphicsAuto !== false && !saved.graphicsChosen; // 사용자가 직접 고르기 전엔 자동
    this.graphicsMeasured = Number.isFinite(saved.graphicsMeasured) ? saved.graphicsMeasured : null; // 측정한 메뉴 FPS
    this.difficulty = oneOf(saved.difficulty, Object.keys(CONFIG.difficulty), d.difficulty);
    this.mode = oneOf(saved.mode, Object.keys(CONFIG.modes), d.mode);
    // 키 설정: 바꾼 동작만 저장 { action: [codes] }
    this.keys = {};
    if (saved.keys && typeof saved.keys === 'object') {
      for (const [a, codes] of Object.entries(saved.keys)) {
        if (CONFIG.rebindable[a] && Array.isArray(codes) && codes.length && codes.every((c) => typeof c === 'string')) this.keys[a] = codes.slice(0, 3);
      }
    }
    this.applyKeys();
  }

  /** 저장된 키 설정을 CONFIG.keys 에 반영 (Input 은 CONFIG.keys 를 읽는다) */
  applyKeys() {
    for (const a of Object.keys(CONFIG.rebindable)) CONFIG.keys[a] = (this.keys[a] || DEFAULT_KEYS[a]).slice();
  }

  /**
   * 동작의 첫 번째 키를 code 로 바꿈. 다른 동작이 그 키를 쓰고 있으면 그 동작에는 이 동작의 원래 첫 키를 넘겨줌(맞바꿈)
   * @returns {string|null} 맞바꾼 동작 이름
   */
  bindKey(action, code) {
    if (!CONFIG.rebindable[action]) return null;
    const cur = CONFIG.keys[action].slice();
    const oldFirst = cur[0];
    if (oldFirst === code) return null;
    let swapped = null;
    for (const a of Object.keys(CONFIG.rebindable)) {
      if (a === action) continue;
      const list = CONFIG.keys[a];
      const i = list.indexOf(code);
      if (i < 0) continue;
      const next = list.slice();
      if (i === 0 && oldFirst && !next.includes(oldFirst)) next[0] = oldFirst;
      else next.splice(i, 1);
      this.keys[a] = next.length ? next : [oldFirst];
      CONFIG.keys[a] = this.keys[a].slice();
      swapped = a;
    }
    const mine = [code, ...cur.slice(1).filter((c) => c !== code)];
    this.keys[action] = mine;
    CONFIG.keys[action] = mine.slice();
    this.save();
    return swapped;
  }

  resetKeys() {
    this.keys = {};
    this.applyKeys();
    this.save();
  }

  save() {
    safeSave(SETTINGS_KEY, {
      sensitivity: this.sensitivity,
      adsSensitivity: this.adsSensitivity,
      fov: this.fov,
      volume: this.volume,
      sfxVolume: this.sfxVolume,
      voiceVolume: this.voiceVolume,
      musicVolume: this.musicVolume,
      lastSeed: this.lastSeed,
      speech: this.speech,
      countersignCard: this.countersignCard,
      subtitleSize: this.subtitleSize,
      colorblind: this.colorblind,
      reduceShake: this.reduceShake,
      graphics: this.graphics,
      graphicsChosen: !this.graphicsAuto,
      graphicsMeasured: this.graphicsMeasured,
      difficulty: this.difficulty,
      mode: this.mode,
      keys: this.keys,
    });
  }
}

/** 키 코드 → 화면 표시 이름 */
export function keyLabel(code) {
  if (!code) return '-';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `숫자패드 ${code.slice(6)}`;
  const map = {
    Space: 'Space', ShiftLeft: '왼쪽 Shift', ShiftRight: '오른쪽 Shift', ControlLeft: '왼쪽 Ctrl', ControlRight: '오른쪽 Ctrl',
    AltLeft: '왼쪽 Alt', AltRight: '오른쪽 Alt', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Tab: 'Tab',
    CapsLock: 'CapsLock', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Enter: 'Enter', Backspace: 'Backspace',
  };
  return map[code] || code;
}

// ---------------------------------------------------------------------
// 기록 — 모드 × 난이도별 최고 기록 + 최근 10판
// ---------------------------------------------------------------------
const emptyBoard = () => ({ bestScore: 0, bestKills: 0, bestTime: 0, bestCombo: 0, bestGrade: null, games: 0 });
const GRADE_RANK = { S: 5, A: 4, B: 3, C: 2, D: 1 };

export class Records {
  constructor() {
    let saved = safeLoad(RECORDS_KEY);
    if (!saved) {
      // v1(모드·난이도 구분 없음) → 생존·보통으로 옮김
      const v1 = safeLoad(RECORDS_KEY_V1);
      saved = { boards: {}, recent: [] };
      if (v1 && v1.games) saved.boards['survival.normal'] = { ...emptyBoard(), ...v1 };
    }
    this.boards = {};
    for (const [k, b] of Object.entries(saved.boards || {})) this.boards[k] = { ...emptyBoard(), ...b };
    this.recent = Array.isArray(saved.recent) ? saved.recent.slice(0, CONFIG.result.recentMax) : [];
  }

  board(key) {
    return this.boards[key] || emptyBoard();
  }

  get games() {
    let n = 0;
    for (const b of Object.values(this.boards)) n += b.games || 0;
    return n;
  }

  /**
   * 결과를 반영하고 갱신된 항목을 돌려줌
   * @param result Game._finishRun 의 결과 객체 (score, kills, time, bestChain, reason, grade, title, judgment …)
   * @param key 'survival.normal' 등
   */
  submit(result, key) {
    const b = { ...emptyBoard(), ...(this.boards[key] || {}) };
    // 작전 해임은 생존 시간 기록으로 치지 않음
    const time = result.reason === 'dismissed' ? 0 : result.time;
    const updated = {
      first: b.games === 0,
      score: b.games > 0 ? result.score > b.bestScore : result.score > 0,
      kills: result.kills > b.bestKills,
      time: time > b.bestTime,
      combo: result.bestChain > b.bestCombo,
      grade: !b.bestGrade || (GRADE_RANK[result.grade] || 0) > (GRADE_RANK[b.bestGrade] || 0),
    };
    b.bestScore = b.games > 0 ? Math.max(b.bestScore, result.score) : result.score;
    b.bestKills = Math.max(b.bestKills, result.kills);
    b.bestTime = Math.max(b.bestTime, time);
    b.bestCombo = Math.max(b.bestCombo, result.bestChain);
    if (updated.grade) b.bestGrade = result.grade;
    b.games += 1;
    this.boards[key] = b;
    this.recent.unshift({
      at: Date.now(),
      key,
      score: result.score,
      grade: result.grade,
      title: result.title,
      reason: result.reason,
      kills: result.kills,
      time: Math.round(result.time),
      judgment: result.judgmentAccuracy,
    });
    this.recent.length = Math.min(this.recent.length, CONFIG.result.recentMax);
    safeSave(RECORDS_KEY, { boards: this.boards, recent: this.recent });
    return updated;
  }
}
