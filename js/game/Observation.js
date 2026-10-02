// 관찰 모드 (Q 누르고 있기) — 총을 내리고 집중해 화면 중앙의 인물에게서 사실을 하나씩 알아챈다
// · 사격 불가, Q 를 떼면 총을 다시 드는 데 0.3초 / 시야 약 2배 확대·가장자리 어둡게·주변 소리 줄이고 심장 소리
// · 대상: 화면 중앙에 가장 가까운 NPC (2단계 조준 유틸 getAimedNPC 재사용)
// · 약 0.5초마다 사실 하나 (멀수록 느림, 가려지면 불가). 장비 사실은 거리 제한 + 어두운 실내에선 손전등이 비춰야 보임
// · 행동 사실은 그 NPC 에게 실제로 일어난 일만 (npc.behavior)
// · 메모에는 사실만 쓴다 — "적입니다" 같은 결론은 절대 쓰지 않는다. 이상한 사실을 하나라도 찾으면 8초간 노란 윤곽
// · 관찰 중에도 게임은 실시간 — 가까운 위장 적에게는 기습 기회가 된다 (npc/Disguise.js)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { gameRand as R } from '../core/Random.js';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class ObservationSystem {
  constructor(game) {
    this.game = game;
    this.reset();
  }

  reset() {
    this.active = false;
    this.t = 0; // 화면 전환 0~1
    this.raiseT = 99; // Q 를 뗀 뒤 경과 (총 드는 중)
    this.target = null;
    this.distance = 0;
    this.progress = 0;
    this.status = '';
    this.memoNpc = null;
    this.memoT = 0;
    this.lastFact = null;
    this.factsFound = 0;
    this.anomaliesFound = 0;
    this.usedOnce = false;
    this._outlined = new Set();
    for (const n of this.game.npcs ? this.game.npcs.list : []) n.rig.setHighlight(0);
  }

  /** 총을 내리고 있음 (관찰 중이거나 다시 드는 중) — 사격·정조준 불가 */
  get weaponDown() {
    return this.active || this.raiseT < CONFIG.observe.raiseTime;
  }

  update(dt, input) {
    const O = CONFIG.observe;
    const g = this.game;
    const want = input.isAction('observe') && g.player.alive && g.state === 'playing';
    if (want && !this.active) {
      this.active = true;
      this.target = null;
      this.progress = 0;
      g.audio.observe(true);
      g.events.emit(Events.OBSERVE_START, { first: !this.usedOnce });
      this.usedOnce = true;
    } else if (!want && this.active) {
      this.active = false;
      this.raiseT = 0;
      this.memoT = O.memoLinger;
      g.audio.observe(false);
    }
    if (!this.active) {
      this.raiseT += dt;
      this.memoT = Math.max(0, this.memoT - dt);
    }
    const k = dt / O.blendTime;
    this.t = THREE.MathUtils.clamp(this.t + (this.active ? k : -k), 0, 1);
    if (this.active) this._observe(dt);
    this._updateOutlines();
  }

  // 손전등이 비추는지 (어두운 실내 장비 확인용)
  _lit(npc, dist) {
    const O = CONFIG.observe;
    if ((npc._indoor || 0) < O.darkInterior) return true;
    const g = this.game;
    if (!g.player.flashlightOn) return false;
    const F = CONFIG.player.flashlight;
    if (dist > F.range) return false;
    g.camera.getWorldDirection(_f);
    npc.getChestPosition(_v).sub(g.camera.position).normalize();
    return THREE.MathUtils.radToDeg(Math.acos(THREE.MathUtils.clamp(_f.dot(_v), -1, 1))) < F.angle;
  }

  _observe(dt) {
    const O = CONFIG.observe;
    const g = this.game;
    const a = g.npcs.getAimedNPC({ maxDistance: O.maxDistance, coneDeg: O.coneDeg });
    const npc = a && a.npc.alive ? a.npc : null;
    if (npc !== this.target) {
      this.target = npc;
      this.progress = 0;
    }
    if (!npc) {
      this.status = '대상 없음 — 화면 가운데에 인물을 두세요';
      return;
    }
    this.memoNpc = npc;
    this.memoT = O.memoLinger;
    const d = a.distance;
    this.distance = d;
    const ob = npc.getObserved();
    const lit = this._lit(npc, d);
    const gearOK = lit && d <= O.gearMaxDist;
    const all = npc.observationFacts();
    const near = d <= O.gearMaxDist;
    const avail = all.filter((f) => !ob.found.has(f.key) && (f.kind === 'behavior' || gearOK || (f.glow && near)));
    const gearLeft = all.some((f) => !ob.found.has(f.key) && f.kind === 'gear' && !(f.glow && near));
    if (!avail.length) {
      this.progress = 0;
      if (gearLeft && !lit) this.status = '어두워서 장비가 안 보임 — 손전등(F)';
      else if (gearLeft) this.status = '너무 멀어서 장비가 안 보임';
      else this.status = '더 알아낸 것 없음';
      return;
    }
    this.status = gearLeft && !gearOK ? (lit ? '멀어서 장비는 안 보임' : '어두워서 장비가 안 보임 — 손전등(F)') : '관찰 중…';
    const interval = O.factInterval * (1 + Math.max(0, d - O.nearDist) * O.slowPerMeter);
    this.progress += dt / interval;
    if (this.progress < 1) return;
    this.progress = 0;
    const fact = R.pick(avail);
    ob.found.set(fact.key, fact);
    this.lastFact = fact;
    this.factsFound++;
    if (fact.anomalous) {
      ob.anomalies++;
      ob.outlineUntil = g.time + O.outlineTime;
      this.anomaliesFound++;
    }
    g.audio.notice(fact.anomalous);
    g.events.emit(Events.OBSERVE_FACT, { npc, fact, distance: d });
  }

  // 이상 단서를 찾은 대상: 노란 윤곽 (8초, 끝날 무렵 깜박임)
  _updateOutlines() {
    const g = this.game;
    const now = g.time;
    for (const n of this._outlined) {
      if (!n.alive || !n.observed || n.observed.outlineUntil <= now) {
        n.rig.setHighlight(0);
        this._outlined.delete(n);
      }
    }
    for (const n of g.npcs.list) {
      const o = n.observed;
      if (!o || !n.alive || o.outlineUntil <= now) continue;
      const left = o.outlineUntil - now;
      const blink = left < 1.5 ? 0.5 + 0.5 * Math.sin(now * 18) : 1;
      n.rig.setHighlight((0.75 + 0.25 * Math.sin(now * 5)) * blink);
      this._outlined.add(n);
    }
  }

  /** 메모에 보일 대상과 사실 목록 */
  memo() {
    const n = this.memoNpc;
    if (!n || (!this.active && this.memoT <= 0)) return null;
    const ob = n.observed;
    return {
      npc: n,
      facts: ob ? [...ob.found.values()] : [],
      distance: this.active && this.target === n ? this.distance : null,
      status: this.active ? (this.target ? this.status : this.status) : '',
      progress: this.active && this.target ? this.progress : 0,
      outlined: !!(ob && ob.outlineUntil > this.game.time),
    };
  }
}
