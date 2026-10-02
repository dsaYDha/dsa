// 4단계 암구호·실내 기준수·아군 부대 — "그날의 약속"을 보관하고 위협 단계가 오를 때마다(약 1분) 교체
// · 암구호: 플레이어가 문어를 외치면 상대가 답어로 답함 (실외·실내 모두). 교체 시 작전 무전 + HUD 카드 깜박임
// · 실내 기준수(7~12): 플레이어가 외친 수 + 상대의 답 = 기준수. 암구호와 별개로 교체, 아군 부대 안에서만 공유 (위장 적은 모름)
// · 아군 부대명·어깨 패치: config.dialogue.units (작전 브리핑에 표시)
// knowledgeOf(npc) — 그 인물이 "아는 것" (진짜 아군 / 위장 적 숙련도별). 대답 규칙(Responses.js)과 디버그 표시가 같이 쓴다
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { gameRand as R } from '../core/Random.js';
import { PAIRS, SPEAKER, dline } from './DialogueLines.js';

export function unitByName(name) {
  return CONFIG.dialogue.units.find((u) => u.name === name) || null;
}

export function unitByPatch(patch) {
  return CONFIG.dialogue.units.find((u) => u.patch === patch) || null;
}

export class CountersignSystem {
  constructor(game) {
    this.game = game;
    this.reset();
    game.events.on(Events.THREAT_LEVEL, () => {
      if (game.state === 'playing') this.rotate(false);
    });
  }

  reset() {
    this.current = null;
    this.previous = null; // 직전 암구호 (교체 전) — 숙련도 1 위장 적이 아는 '유출된' 답어
    this.indoorBase = 0;
    this.prevIndoorBase = null;
    this.changedAt = -99;
    this.rotations = 0;
    this._announce = [];
  }

  /** 작전 시작: 오늘의 암구호 (직전 것은 '어제 암구호'로 — 유출본) */
  start() {
    this.reset();
    const [a, b] = this._pickPairs(2);
    this.previous = { challenge: b[0], reply: b[1] };
    this.current = { challenge: a[0], reply: a[1] };
    this.indoorBase = this._pickBase(null);
    this.changedAt = -99; // 시작 직후는 '교체 직후'가 아님 (카드에 이전 암구호를 보여주지 않음)
    this._queueAnnounce(true, 1.4);
    this.game.events.emit(Events.COUNTERSIGN_CHANGED, { current: this.current, previous: this.previous, indoorBase: this.indoorBase, prevIndoorBase: null, initial: true });
  }

  rotate(initial = false) {
    if (!this.current) return this.start();
    this.previous = this.current;
    const [a] = this._pickPairs(1, [this.current.challenge, this.previous.challenge]);
    this.current = { challenge: a[0], reply: a[1] };
    this.prevIndoorBase = this.indoorBase;
    this.indoorBase = this._pickBase(this.indoorBase);
    this.changedAt = this.game.time;
    this.rotations++;
    this._queueAnnounce(initial, 0.3);
    this.game.events.emit(Events.COUNTERSIGN_CHANGED, { current: this.current, previous: this.previous, indoorBase: this.indoorBase, prevIndoorBase: this.prevIndoorBase, initial });
  }

  _pickPairs(n, exclude = []) {
    const pool = PAIRS.filter((p) => !exclude.includes(p[0]));
    R.shuffle(pool);
    return pool.slice(0, n);
  }

  _pickBase(prev) {
    const [lo, hi] = CONFIG.dialogue.indoor.base;
    let v = R.int(lo, hi);
    if (v === prev) v = v === hi ? lo : v + 1;
    return v;
  }

  // 작전 무전 (아군 사살 무전 두절과 무관하게 들림)
  _queueAnnounce(initial, delay) {
    const c = this.current;
    this._announce.push({ t: delay, text: dline(initial ? 'csInitial' : 'csChange', { c: c.challenge, r: c.reply }) });
    this._announce.push({ t: delay + 1.6, text: dline('csIndoor', { a: this.indoorBase }) });
  }

  update(dt) {
    for (let i = this._announce.length - 1; i >= 0; i--) {
      const a = this._announce[i];
      a.t -= dt;
      if (a.t <= 0) {
        this._announce.splice(i, 1);
        this.game.voice.say({ speaker: SPEAKER.command, text: a.text, channel: 'radio', priority: 3, force: true, nodedupe: true, duration: 3.6 });
      }
    }
  }

  /** 교체 직후 (이전 암구호를 카드에 함께 표시하는 시간) */
  get stale() {
    return this.game.time - this.changedAt < CONFIG.dialogue.countersign.staleWindow;
  }

  get sinceChange() {
    return this.game.time - this.changedAt;
  }

  /**
   * 그 인물이 아는 것 (디버그·대답 규칙 공통)
   * @returns {{ current: boolean, previous: boolean, indoor: boolean, unit: string|null, real: boolean }}
   */
  knowledgeOf(npc) {
    if (npc.trueFaction === 'ally') return { current: true, previous: true, indoor: true, unit: npc.unit ? npc.unit.name : null, real: true };
    const p = npc.disguise;
    if (!p || p.as !== 'ally') return { current: false, previous: false, indoor: false, unit: null, real: npc.trueFaction !== 'enemy' };
    return { current: p.skill >= 2, previous: p.skill >= 1, indoor: false, unit: p.unitClaim || null, real: false };
  }
}
