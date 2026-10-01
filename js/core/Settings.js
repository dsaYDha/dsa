// 설정·최고 기록 localStorage 저장
import { CONFIG } from '../config.js';

const SETTINGS_KEY = 'piasik.settings.v1';
const RECORDS_KEY = 'piasik.records.v1';

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

export class Settings {
  constructor() {
    const saved = safeLoad(SETTINGS_KEY) || {};
    const d = CONFIG.defaults;
    const L = CONFIG.limits;
    this.sensitivity = clamp(Number(saved.sensitivity ?? d.sensitivity) || d.sensitivity, L.sensitivity);
    this.fov = clamp(Number(saved.fov ?? d.fov) || d.fov, L.fov);
    this.volume = clamp(Number(saved.volume ?? d.volume), L.volume);
    if (Number.isNaN(this.volume)) this.volume = d.volume;
    this.lastSeed = typeof saved.lastSeed === 'string' ? saved.lastSeed : null;
    this.speech = typeof saved.speech === 'boolean' ? saved.speech : d.speech; // 무전·외침 음성(TTS)
  }

  save() {
    safeSave(SETTINGS_KEY, {
      sensitivity: this.sensitivity,
      fov: this.fov,
      volume: this.volume,
      lastSeed: this.lastSeed,
      speech: this.speech,
    });
  }
}

export class Records {
  constructor() {
    const saved = safeLoad(RECORDS_KEY) || {};
    this.bestScore = saved.bestScore || 0;
    this.bestKills = saved.bestKills || 0;
    this.bestTime = saved.bestTime || 0;
    this.bestCombo = saved.bestCombo || 0;
    this.games = saved.games || 0;
  }

  // 결과를 반영하고 갱신된 항목을 돌려줌
  submit(result) {
    // 작전 해임은 생존 시간 기록으로 치지 않음
    const time = result.reason === 'dismissed' ? 0 : result.time;
    const updated = {
      score: result.score > this.bestScore,
      kills: result.kills > this.bestKills,
      time: time > this.bestTime,
      combo: result.bestChain > this.bestCombo,
    };
    this.bestScore = Math.max(this.bestScore, result.score);
    this.bestKills = Math.max(this.bestKills, result.kills);
    this.bestTime = Math.max(this.bestTime, time);
    this.bestCombo = Math.max(this.bestCombo, result.bestChain);
    this.games += 1;
    safeSave(RECORDS_KEY, {
      bestScore: this.bestScore,
      bestKills: this.bestKills,
      bestTime: this.bestTime,
      bestCombo: this.bestCombo,
      games: this.games,
    });
    return updated;
  }
}
