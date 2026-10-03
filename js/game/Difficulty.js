// 5단계 난이도 — 시간 구간별 난이도 곡선(config.curve) + 난이도 프리셋(config.difficulty) + 게임 모드(config.modes)
// · 곡선: 0~1분 적응(적 위주·위장 없음) → 1~3분 위장 등장(장비 단서 많음) → 3~6분 혼전(섞인 습격·숙련 1 증가)
//         → 6분~ 고강도(완벽 위장 등장, 그 값으로 유지). 구간 안에서는 값이 일정하다(경계에서 바뀜)
// · 위협 단계(적의 수·명중률·반응·습격 규모)는 곡선 시간 1분마다 1단계 — 5분 작전은 곡선이 0.5분부터 1.2배 빠르게 흐름
// · 프리셋 배율: 적 명중률·반응, 위장 비율, 숙련도 분포(완벽 위장 비율), 관찰 속도, 암구호 카드 허용
//   + v1.1: 적 조준 강화 적용 비율(aimBoost), 플레이어 무기 다루기(handling — 퍼짐·연사 반동)
// 디렉터(SpawnDirector)가 매 프레임 sample() 결과(director.curve)를 읽어 출현 비율·위장·오판 유도 행동을 정한다
import { CONFIG } from '../config.js';

const NO_HANDLING = { spreadMul: 1, bloomMul: 1, recoilGrowthMul: 1, swayMul: 1 };

export class Difficulty {
  constructor(game) {
    this.game = game;
    this.presetKey = 'normal';
    this.modeKey = 'survival';
    // sample() 이 채우는 현재 값 (매 프레임 재사용 — 할당 없음)
    this.cur = {
      index: 0, name: '', note: '',
      mix: { enemy: 0, ally: 0, civilian: 0 },
      fakeAlly: 0, fakeCiv: 0, skill: [1, 0, 0], maxDisguised: 0, decoyAlly: 0, decoyCiv: 0, nearEnemy: 0,
    };
    const s = game.settings;
    this.set(s ? s.difficulty : 'normal', s ? s.mode : 'survival');
  }

  set(preset, mode) {
    this.presetKey = CONFIG.difficulty[preset] ? preset : 'normal';
    this.modeKey = CONFIG.modes[mode] ? mode : 'survival';
    this.sample(this.mode.curveStart);
  }

  get preset() {
    return CONFIG.difficulty[this.presetKey];
  }

  get mode() {
    return CONFIG.modes[this.modeKey];
  }

  /** 기록·통계 구분 키 (모드 × 난이도) */
  get recordKey() {
    return `${this.modeKey}.${this.presetKey}`;
  }

  // 프리셋 배율
  get enemyAccuracy() { return this.preset.enemyAccuracy; }
  get enemyReaction() { return this.preset.enemyReaction; }
  get observeMul() { return this.preset.observeMul; }
  get cardAllowed() { return this.preset.card !== false; }
  // v1.1: 적 조준 강화(npc.aim)를 얼마나 적용할지 (쉬움 0.5) / 플레이어 무기 다루기 배율
  get aimBoost() { return this.preset.aimBoost ?? 1; }
  get handling() { return this.preset.handling || NO_HANDLING; }

  /** 진행 시간(초) → 곡선 시간(분) */
  curveMinutes(elapsed) {
    const m = this.mode;
    return m.curveStart + (elapsed / 60) * m.curveSpeed;
  }

  /** 진행 시간(초) → 위협 단계 (곡선 시간 1분마다 1단계) */
  threatLevel(elapsed) {
    return Math.min(CONFIG.threat.maxLevel, 1 + Math.floor(this.curveMinutes(elapsed)));
  }

  /** 다음 위협 단계까지 남은 진행 시간(초) — HUD·디버그용 */
  secondsToNextLevel(elapsed) {
    const m = this.curveMinutes(elapsed);
    return ((Math.floor(m) + 1 - m) * 60) / this.mode.curveSpeed;
  }

  /** 곡선 시간(분)의 구간 값 + 프리셋 배율 → this.cur */
  sample(minutes) {
    const phases = CONFIG.curve.phases;
    let i = 0;
    while (i + 1 < phases.length && minutes >= phases[i + 1].at) i++;
    const ph = phases[i];
    const pr = this.preset;
    const c = this.cur;
    c.index = i;
    c.name = ph.name;
    c.note = ph.note;
    c.mix.enemy = ph.mix[0];
    c.mix.ally = ph.mix[1];
    c.mix.civilian = ph.mix[2];
    c.fakeAlly = Math.min(0.45, ph.fakeAlly * pr.disguiseMul);
    c.fakeCiv = Math.min(0.45, ph.fakeCiv * pr.disguiseMul);
    let tot = 0;
    for (let k = 0; k < 3; k++) {
      c.skill[k] = ph.skill[k] * pr.skillMul[k];
      tot += c.skill[k];
    }
    for (let k = 0; k < 3; k++) c.skill[k] = tot > 0 ? c.skill[k] / tot : k === 0 ? 1 : 0;
    c.maxDisguised = ph.maxDisguised;
    c.decoyAlly = ph.decoyAlly;
    c.decoyCiv = ph.decoyCiv;
    c.nearEnemy = ph.nearEnemy;
    return c;
  }

  /** 숙련도 뽑기 (곡선 분포) — rng: { next() } */
  rollSkill(rng) {
    const w = this.cur.skill;
    let r = rng.next();
    for (let k = 0; k < 3; k++) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 2;
  }
}
