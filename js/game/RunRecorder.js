// 5단계 판 기록 — 결과 화면의 판단 통계·등급·칭호·결정적 순간·타임라인을 위해 이벤트를 모은다
// · 판단 정확도: 플레이어 총알에 맞은 사람(한 사람 한 번) 중 진짜 적(위장 적 포함)의 비율
// · 위장 적 사전 식별률: 정체를 드러내기 전에 사살한 위장 적 / (그 수 + 스스로 정체를 드러낸 위장 적)
// · 평균 판단 시간: 화면에 처음 보인 뒤 플레이어의 첫 명중까지 (적만)
// · 결정적 순간: 이벤트마다 '흥미 점수'를 매겨 상위 3개를 시간 순으로 (예: "3:42 — 실내 문답으로 가짜 아군을 가려내 사살")
// · 등급 S~D: 전투(분당 사살)·판단(정확도·경고)·식별(사전 식별률)·생존(시간/완수) 각 0~25점의 합 (config.result)
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';

const QUESTION_KO = {
  password: '암구호 문답으로',
  indoor: '실내 문답으로',
  unit: '소속 문답으로',
  lower: '"총 내려!" 지시로',
  hands: '"손 들어!" 지시로',
  id: '신분증 확인으로',
  evac: '대피 지시로',
  halt: '"정지!"에 대한 반응으로',
};
const FF_KO = { allyHit: '아군을 오인 사격', allyKill: '아군을 오인 사살', civHit: '민간인을 오인 사격', civKill: '민간인을 오인 사살' };

export const fmtClock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

export class RunRecorder {
  constructor(game) {
    this.game = game;
    this.reset();
    const ev = game.events;
    ev.on(Events.NPC_DAMAGED, (e) => this._onHit(e));
    ev.on(Events.NPC_KILLED, (e) => this._onHit(e));
    ev.on(Events.SCORE_KILL, (e) => this._onScoreKill(e));
    ev.on(Events.FRIENDLY_FIRE, (e) => this._log('ff', { kind: e.kind, points: e.points, apparent: e.apparentFaction }));
    ev.on(Events.DISGUISE_REVEALING, (e) => {
      // 스스로 정체를 드러내기 시작 (기습·습격 요청·궁지) — 사전 식별 실패
      if (e.reason !== 'damaged' && e.reason !== 'questioned') this.revealedDisguised++;
    });
    ev.on(Events.DISGUISE_REVEALED, (e) => this._onRevealed(e));
    ev.on(Events.THREAT_LEVEL, (e) => this._log('threat', { level: e.level }));
    ev.on(Events.CURVE_PHASE, (e) => this._log('phase', { name: e.name }));
    ev.on(Events.DIALOGUE_ANSWER, (e) => {
      if (!e.fail || !e.npc) return;
      const q = this._lastQuestion.get(e.npc.id) || 'halt';
      if (!this._failQ.has(e.npc.id)) this._failQ.set(e.npc.id, q);
    });
    ev.on(Events.DIALOGUE_ASK, (e) => {
      if (e.npc) this._lastQuestion.set(e.npc.id, e.question);
    });
    ev.on(Events.AMBUSH, (e) => {
      if (e.npc && e.kind === 'enemy') this._ambushIds.add(e.npc.id);
    });
    ev.on(Events.PLAYER_DAMAGED, (e) => {
      this.damageTaken += e.amount;
      if (e.health > 0 && e.health < 18) this._lowHpAt = this._lowHpAt ?? this.t;
    });
    ev.on(Events.CIVILIAN_EVACUATED, () => this.evacuated++);
  }

  reset() {
    this.events = []; // { t, type, ... } — 타임라인·결정적 순간
    this.scoreSamples = [[0, 0]];
    this._sampleT = 0;
    this.victims = new Map(); // npc.id → { faction, apparent, first, seen }
    this.revealedDisguised = 0;
    this.identifiedDisguised = 0;
    this.damageTaken = 0;
    this.evacuated = 0;
    this._failQ = new Map();
    this._lastQuestion = new Map();
    this._ambushIds = new Set();
    this._lowHpAt = null;
    this._lowHpLogged = false;
    this._ambushedBy = new Map(); // npc.id → 기습 시각
  }

  get t() {
    return this.game.runTime;
  }

  _log(type, data) {
    this.events.push({ t: this.t, type, ...data });
    if (this.events.length > 600) this.events.shift();
  }

  // 플레이어가 맞힌 사람 (판단 정확도·판단 시간)
  _onHit(e) {
    if (e.attacker !== 'player' || !e.victim) return;
    const id = e.victim.id;
    if (this.victims.has(id)) return;
    this.victims.set(id, {
      faction: e.trueFaction,
      apparent: e.apparentFaction,
      disguised: !!e.victim.disguised || (e.trueFaction === 'enemy' && e.apparentFaction !== 'enemy'),
      seen: e.timeSinceFirstSeen,
      t: this.t,
    });
  }

  _onScoreKill(e) {
    const v = e.victim;
    const dist = v && v.lastDamage && v.lastDamage.distance != null ? v.lastDamage.distance : null;
    const seen = v && v.lastDamage ? v.lastDamage.timeSinceFirstSeen : null;
    const rec = { points: e.points, labels: e.labels, combo: e.combo, chain: e.chain, headshot: e.headshot, dist, seen, label: v && v.tcfg ? v.tcfg.label : '적' };
    if (v && v.disguise && e.labels.includes('위장 적 식별')) {
      this.identifiedDisguised++;
      rec.disguisedAs = v.disguise.as;
      const q = this._failQ.get(v.id);
      if (q) rec.evidence = { by: 'dialogue', q };
      else if (v.observed && v.observed.anomalies > 0) {
        const fact = [...v.observed.found.values()].find((f) => f.anomalous);
        rec.evidence = { by: 'observe', text: fact ? fact.text : null };
      }
    } else if (v && v.disguise) rec.revealedKill = true;
    if (v && this._ambushIds.has(v.id)) rec.ambushSpawn = v.firstSeenAt != null ? this.game.time - v.firstSeenAt : null;
    if (v && this._ambushedBy.has(v.id)) rec.counter = this.t - this._ambushedBy.get(v.id);
    this._log('kill', rec);
  }

  _onRevealed(e) {
    // 먼저 쏘거나 문답으로 몰아붙였지만 다 드러낼 때까지 못 쓰러뜨림 — 이것도 사전 식별 실패로 셈
    if (e.reason === 'damaged' || e.reason === 'questioned') this.revealedDisguised++;
    if (e.ambush) {
      this._ambushedBy.set(e.npc.id, this.t);
      this._log('ambush', { as: e.as, during: this.game.dialogue && this.game.dialogue.lastTarget === e.npc && this.game.time - this.game.dialogue.closedAt < 4 });
    }
  }

  /** 매 프레임 (Game._updatePlaying) — 점수 표본(타임라인 그래프), 저체력 버팀 */
  update(dt) {
    this._sampleT += dt;
    if (this._sampleT >= 2) {
      this._sampleT = 0;
      this.scoreSamples.push([this.t, this.game.score.score]);
      if (this.scoreSamples.length > 1200) this.scoreSamples.splice(1, 1);
    }
    const p = this.game.player;
    if (this._lowHpAt != null && !this._lowHpLogged && p.alive && this.t - this._lowHpAt > 8) {
      this._lowHpLogged = true;
      this._log('clutch', { hp: Math.round(p.health) });
    }
    if (p.health > 40) this._lowHpAt = null;
  }

  // ------------------------------------------------------------------
  // 결과 계산
  // ------------------------------------------------------------------
  summarize(r) {
    const victims = [...this.victims.values()];
    const enemyHits = victims.filter((v) => v.faction === 'enemy');
    const judgmentAccuracy = victims.length ? enemyHits.length / victims.length : null;
    const seenTimes = enemyHits.map((v) => v.seen).filter((s) => s != null && s >= 0 && s < 30);
    const avgJudgment = seenTimes.length ? seenTimes.reduce((a, b) => a + b, 0) / seenTimes.length : null;
    // 만난 위장 적 = 사전 식별 사살 + 스스로 드러내기 시작한 수 + 몰아붙였지만 다 드러내게 둔 수 (서로 겹치지 않음)
    const encountered = this.identifiedDisguised + this.revealedDisguised;
    const preIdRate = encountered > 0 ? this.identifiedDisguised / encountered : null;
    const ffCount = r.allyHits + r.allyKills + r.civHits + r.civKills;
    const out = {
      judgmentAccuracy,
      victimsHit: victims.length,
      wrongHits: victims.length - enemyHits.length,
      avgJudgment,
      preIdRate,
      disguisedEncountered: encountered,
      ffCount,
      damageTaken: Math.round(this.damageTaken),
    };
    out.gradeParts = this._gradeParts(r, out);
    const sum = out.gradeParts.combat + out.gradeParts.judgment + out.gradeParts.identify + out.gradeParts.survival;
    out.gradeScore = Math.round(sum);
    out.grade = r.reason === 'dismissed' ? 'D' : CONFIG.result.grades.find(([min]) => sum >= min)[1];
    const title = this._title(r, out);
    out.title = title.name;
    out.titleDesc = title.desc;
    out.moments = this._moments(r);
    out.timeline = {
      duration: Math.max(1, r.time),
      score: this.scoreSamples.concat([[r.time, r.score]]),
      events: this.events.filter((e) => e.type !== 'clutch').map((e) => ({ t: e.t, type: e.type, kind: e.kind, identified: !!(e.labels && e.labels.includes('위장 적 식별')), level: e.level, name: e.name })),
    };
    return out;
  }

  _gradeParts(r, s) {
    const R = CONFIG.result;
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    const combat = 25 * clamp01(r.kpm / R.kpmFull);
    let judgment = s.judgmentAccuracy == null ? (r.kills > 0 ? 25 : 0) : 25 * clamp01((s.judgmentAccuracy - 0.6) / 0.4);
    judgment = Math.max(0, judgment - 5 * r.warnings);
    const identify = s.preIdRate == null ? 12.5 : 25 * s.preIdRate;
    let survival;
    if (r.mode === 'timed') survival = r.reason === 'complete' ? 25 : 20 * clamp01(r.time / (CONFIG.modes.timed.duration || 300));
    else survival = 25 * clamp01(r.time / R.survivalFull);
    return { combat, judgment, identify, survival };
  }

  _title(r, s) {
    const acc = s.judgmentAccuracy ?? 0;
    const qk = r.kills ? r.quickKills / r.kills : 0;
    const useChecks = (r.dialogueQuestions || 0) + (r.observeSessions || 0);
    const T = (name, desc) => ({ name, desc });
    if (r.reason === 'dismissed') return T('방아쇠가 가볍다', '오인 사격 경고 누적으로 해임 — 쏘기 전에 표식부터');
    if (s.ffCount >= 2 || (s.ffCount >= 1 && acc < 0.85)) return T('방아쇠가 가볍다', '적보다 빠른 손가락 — 판단이 따라오지 못했다');
    if (acc >= 0.98 && r.disguisedKills >= 2 && useChecks >= 8) return T('의심 많은 베테랑', '묻고, 살피고, 확신이 서야 쏜다');
    if (acc >= 0.98 && r.kills >= 15 && s.ffCount === 0) return T('냉철한 판단', '단 한 발도 엉뚱한 곳에 쓰지 않았다');
    if (r.disguisedKills >= 3) return T('위장 사냥꾼', '가면을 쓴 적을 먼저 알아봤다');
    if (qk >= 0.5 && r.kills >= 10) return T('번개 같은 반응', '보이는 순간 끝낸다');
    if (r.headshotRatio >= 0.45 && r.kills >= 10) return T('저격수의 눈', '머리만 노린다');
    if (r.bestChain >= 8) return T('연쇄 사격수', '끊기지 않는 연속 사살');
    if (r.time >= 600) return T('질긴 생존자', '오래 버틴 것 자체가 전과');
    if ((r.dialogueQuestions || 0) >= 10) return T('꼼꼼한 검문관', '말로 먼저 확인한다');
    if (r.kills < 3) return T('신참 병사', '시가전은 이제 시작이다');
    return T('믿음직한 분대원', '맡은 구역을 지켰다');
  }

  _moments(r) {
    const c = [];
    let bestChain = null;
    let firstKill = null;
    let fastest = null;
    let farthest = null;
    let lastPhase = null;
    for (const e of this.events) {
      if (e.type === 'phase') lastPhase = e;
      if (e.type === 'kill') {
        if (!firstKill) firstKill = e;
        if (e.seen != null && e.seen > 0.15 && (!fastest || e.seen < fastest.seen)) fastest = e;
        if (e.dist != null && e.dist >= 25 && (!farthest || e.dist > farthest.dist)) farthest = e;
        if (e.disguisedAs && e.labels.includes('위장 적 식별')) {
          const who = e.disguisedAs === 'ally' ? '가짜 아군' : '가짜 민간인';
          if (e.evidence && e.evidence.by === 'dialogue') c.push({ t: e.t, score: 92, text: `${QUESTION_KO[e.evidence.q] || '문답으로'} ${who}을 가려내 사살` });
          else if (e.evidence && e.evidence.by === 'observe') c.push({ t: e.t, score: 88, text: `관찰로 '${e.evidence.text || '이상한 점'}'을 알아채고 ${who} 사살` });
          else c.push({ t: e.t, score: 72, text: `정체를 드러내기 전에 ${who} 사살` });
        }
        if (e.counter != null && e.counter < 4) c.push({ t: e.t, score: 66, text: `기습한 위장 적을 ${e.counter.toFixed(1)}초 만에 반격해 사살` });
        if (e.ambushSpawn != null && e.ambushSpawn < 1.6) c.push({ t: e.t, score: 64, text: `돌발 조우한 적을 ${Math.max(0.1, e.ambushSpawn).toFixed(1)}초 만에 사살` });
        const multi = e.labels.find((l) => l === '트리플킬' || /연속킬$/.test(l));
        if (multi) c.push({ t: e.t, score: 58 + (parseInt(multi, 10) || 3) * 4, text: `${multi}${e.combo > 1 ? ` (콤보 ×${e.combo.toFixed(1)})` : ''}` });
        if (e.headshot && e.dist != null && e.dist >= 40) c.push({ t: e.t, score: 44 + e.dist / 4, text: `${Math.round(e.dist)}m 거리 헤드샷` });
        if (e.chain >= 3 && (!bestChain || e.chain > bestChain.chain)) bestChain = e;
      } else if (e.type === 'ff') {
        const killed = e.kind === 'allyKill' || e.kind === 'civKill';
        c.push({ t: e.t, score: killed ? 80 : 40, text: `${FF_KO[e.kind]} (${e.points.toLocaleString('ko-KR')})` });
      } else if (e.type === 'ambush') {
        c.push({ t: e.t, score: e.during ? 62 : 54, text: `${e.as === 'ally' ? '가짜 아군' : '가짜 민간인'}에게 기습당함${e.during ? ' (문답 중)' : ''}` });
      } else if (e.type === 'clutch') {
        c.push({ t: e.t, score: 42, text: `체력 ${e.hp}로 버티며 교전 지속` });
      }
    }
    if (bestChain) c.push({ t: bestChain.t, score: 38 + bestChain.chain * 3, text: `${bestChain.chain}연속 콤보 ×${bestChain.combo.toFixed(1)}` });
    if (r.reason === 'complete') c.push({ t: r.time, score: 50, text: '5분 작전 완수' });
    // 특별한 사건이 적은 판을 위한 보조 후보 (점수가 낮아 위 사건이 있으면 밀려남)
    if (fastest && fastest.seen < 1.5) c.push({ t: fastest.t, score: 34, text: `처음 보인 지 ${fastest.seen.toFixed(1)}초 만에 ${fastest.label} 사살` });
    if (farthest) c.push({ t: farthest.t, score: 28 + farthest.dist / 5, text: `${Math.round(farthest.dist)}m 거리의 ${farthest.label} 사살` });
    if (lastPhase && lastPhase.t > 5) c.push({ t: lastPhase.t, score: 24, text: `'${lastPhase.name}' 구간 진입` });
    if (firstKill) c.push({ t: firstKill.t, score: 18, text: `첫 사살 (${firstKill.label})` });
    // 같은 종류가 몰리지 않게: 문장 앞부분이 같으면 하나만
    c.sort((a, b) => b.score - a.score);
    const picked = [];
    const kinds = new Set();
    for (const m of c) {
      const k = m.text.slice(0, 6);
      if (kinds.has(k)) continue;
      kinds.add(k);
      picked.push(m);
      if (picked.length >= 3) break;
    }
    picked.sort((a, b) => a.t - b.t);
    return picked.map((m) => ({ t: m.t, clock: fmtClock(m.t), text: m.text }));
  }
}
