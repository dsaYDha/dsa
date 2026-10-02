// 4단계 말 걸기 — 실시간 문답 (게임을 멈추지 않고, 총도 계속 들고 있음)
// · E: 조준 중인 인물에게 "정지!" + 대화 메뉴 (실외 20m / 실내 10m, 시야가 트여 있어야 함 — 2단계 조준 유틸 getAimedNPC 재사용)
//   빨간 표식에겐 무반응. 메뉴는 화면 하단에 1~4 선택지. 4초 동안 입력이 없거나 대상이 시야에서 사라지면 닫힘, E 를 다시 누르면 닫힘
// · 사격하면 대화 종료 (WEAPON_FIRED). 대답을 기다리는 동안에도 다른 적은 계속 움직이고, 묻는 행위가 위장 적의 기습을 부를 수 있다
// · 자막(2단계 VoiceSystem): [나] / [파란 표식 병사] / [민간인] — 겉모습 라벨만, 판정 표시 없음 (맞는지는 플레이어가 판단)
// · 대답 규칙: dialogue/Responses.js, 대사: dialogue/DialogueLines.js, 암구호·실내 기준수: dialogue/Countersign.js
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { gameRand as R } from '../core/Random.js';
import { SPEAKER, dline, numWord } from './DialogueLines.js';
import { QUESTIONS, haltReaction, respond, talkKind } from './Responses.js';
import { bearingDeg, dirName } from './Callouts.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const PLAYER_VOICE = { id: 'player', pitch: 0.92, rate: 1.05 };

export class DialogueSystem {
  constructor(game) {
    this.game = game;
    this.reset();
    const ev = game.events;
    ev.on(Events.WEAPON_FIRED, (e) => {
      if (e.isPlayer && this.target) this.close('fired');
    });
    ev.on(Events.DISGUISE_REVEALING, (e) => {
      if (e.npc === this.target) this.close('revealed');
    });
    ev.on(Events.DISGUISE_REVEALED, (e) => {
      // 문답 중(또는 막 끝난 직후) 그 상대에게 기습당함
      if (!e.ambush) return;
      const recent = e.npc === this.lastTarget && this.game.time - this.closedAt < 4;
      if (e.npc === this.target || recent) this.stats.ambushed++;
    });
    ev.on(Events.NPC_KILLED, (e) => {
      if (e.victim === this.target) this.close('dead');
    });
    ev.on(Events.PLAYER_DIED, () => this.close('player'));
    ev.on(Events.OPERATION_DISMISSED, () => this.close('player'));
  }

  reset() {
    this.target = null;
    this.lastTarget = null;
    this.closedAt = -99;
    this.reaction = null;
    this.steps = [];
    this.busyT = 0;
    this.idleT = 0;
    this.lostT = 0;
    this.losCheckT = 0;
    this.canSee = true;
    this.notice = null; // { text, t } — '대상 없음' 등 짧은 안내
    this.usedOnce = false;
    this.usedIndoor = false;
    this.stats = { talks: 0, questions: 0, ambushed: 0, exposed: 0, confirmed: 0 };
    this._exposed = new Set();
    this._confirmed = new Set();
  }

  get open() {
    return !!this.target;
  }

  /** 메뉴에 보일 선택지 (HUD 용) */
  options() {
    const t = this.target;
    if (!t) return [];
    const list = QUESTIONS[t.apparentFaction === 'civilian' ? 'civilian' : 'ally'];
    const indoorOK = this.sameBuilding();
    return list.map((q, i) => ({
      slot: i + 1,
      key: q.key,
      label: q.label,
      disabled: this.busyT > 0 || (q.indoorOnly && !indoorOK),
      note: q.indoorOnly && !indoorOK ? '실내 전용' : '',
    }));
  }

  /** 플레이어와 대상이 같은 건물 안 (실내 확인 문답 조건) */
  sameBuilding() {
    const t = this.target;
    if (!t) return false;
    const w = this.game.world;
    const a = w.getIndoorInfo(this.game.player.position);
    const b = w.getIndoorInfo(t.position);
    return !!(a && b && a.building.id === b.building.id);
  }

  _range(npc) {
    const w = this.game.world;
    const C = CONFIG.dialogue;
    const indoor = w.isIndoors(this.game.player.position) || w.isIndoors(npc.position);
    return indoor ? C.rangeIndoor : C.rangeOutdoor;
  }

  _notice(text) {
    this.notice = { text, t: this.game.time };
  }

  _sayPlayer(text) {
    this.game.voice.say({ speaker: SPEAKER.player, text, channel: 'player', priority: 3, voice: PLAYER_VOICE, force: true, nodedupe: true });
  }

  // ------------------------------------------------------------------
  update(dt, input) {
    const g = this.game;
    // 대본 실행 (대답·행동)
    if (this.steps.length) {
      for (const s of this.steps) s.at -= dt;
      const due = this.steps.filter((s) => s.at <= 0);
      if (due.length) {
        this.steps = this.steps.filter((s) => s.at > 0);
        for (const s of due) this._runStep(s);
      }
    }
    if (input.wasAction('interact')) {
      if (this.target) this.close('key');
      else this.tryOpen();
    }
    const t = this.target;
    if (!t) return;
    // 닫힘 조건: 죽음·정체를 드러냄·너무 멀어짐·시야에서 사라짐·입력 없음
    if (!t.alive || t.apparentFaction === 'enemy') {
      this.close(t.alive ? 'revealed' : 'dead');
      return;
    }
    const d = t.position.distanceTo(g.player.feet);
    if (d > this._range(t) + CONFIG.dialogue.leaveExtra) {
      this.close('lost');
      return;
    }
    this.losCheckT -= dt;
    if (this.losCheckT <= 0) {
      this.losCheckT = 0.15;
      t.getChestPosition(_a);
      t.getHeadPosition(_b);
      this.canSee = g.world.hasLineOfSight(g.camera.position, _a) || g.world.hasLineOfSight(g.camera.position, _b);
    }
    this.lostT = this.canSee ? 0 : this.lostT + dt;
    if (this.lostT > CONFIG.dialogue.losGrace) {
      this.close('lost');
      return;
    }
    // 대답을 기다리는 동안은 시간 제한을 세지 않음
    if (this.busyT > 0) {
      this.busyT -= dt;
      if (this.busyT <= 0) this.idleT = CONFIG.dialogue.menuTimeout;
    } else {
      this.idleT -= dt;
      if (this.idleT <= 0) {
        this.close('timeout');
        return;
      }
    }
    // 멈춰 선 상대는 대화 동안 계속 서 있음
    if (this.reaction === 'stop' && !(t.ctl && (t.ctl.ignoring || t.ctl.mode === 'flee'))) t.holdForTalk(CONFIG.dialogue.holdTime);
    // 1~4 선택
    for (let i = 1; i <= 4; i++) {
      if (input.wasAction(`dialog${i}`)) {
        this.ask(i);
        break;
      }
    }
  }

  // E: 조준 중인 인물에게 말 걸기
  tryOpen() {
    const g = this.game;
    const C = CONFIG.dialogue;
    if (!g.player.alive) return false;
    const a = g.npcs.getAimedNPC({ maxDistance: C.rangeOutdoor + 2, coneDeg: C.coneDeg });
    if (!a || !a.npc.alive) {
      this._notice('말을 걸 대상이 없다 — 인물을 화면 가운데에 두고 E');
      return false;
    }
    const npc = a.npc;
    if (npc.apparentFaction === 'enemy') return false; // 빨간 표식에겐 무반응
    const range = this._range(npc);
    if (a.distance > range) {
      this._notice(`너무 멀다 (실외 ${C.rangeOutdoor}m · 실내 ${C.rangeIndoor}m 안)`);
      return false;
    }
    this.target = npc;
    this.lastTarget = npc;
    this.steps = [];
    this.lostT = 0;
    this.canSee = true;
    this.losCheckT = 0.15;
    this.stats.talks++;
    this._sayPlayer(dline('playerHalt'));
    const h = haltReaction(npc);
    this.reaction = h.reaction;
    this.steps.push(...h.steps);
    this.busyT = 0.7;
    this.idleT = C.menuTimeout;
    const first = !this.usedOnce;
    this.usedOnce = true;
    const indoor = this.sameBuilding();
    const firstIndoor = indoor && !this.usedIndoor;
    if (indoor) this.usedIndoor = true;
    g.events.emit(Events.DIALOGUE_OPEN, { npc, indoor, first, firstIndoor });
    return true;
  }

  // 1~4: 질문
  ask(slot) {
    const g = this.game;
    const t = this.target;
    if (!t || this.busyT > 0) return false;
    const opt = this.options()[slot - 1];
    if (!opt || opt.disabled) return false;
    const cs = g.countersign;
    const ctx = { cs, number: 0 };
    switch (opt.key) {
      case 'password':
        this._sayPlayer(dline('playerPassword', { c: cs.current.challenge }));
        break;
      case 'indoor':
        ctx.number = R.int(1, cs.indoorBase - 1); // 플레이어가 외치는 수는 게임이 무작위로
        this._sayPlayer(dline('playerIndoor', { n: numWord(ctx.number) }));
        break;
      case 'unit':
        this._sayPlayer(dline('playerUnit'));
        break;
      case 'lower':
        this._sayPlayer(dline('playerLower'));
        break;
      case 'hands':
        this._sayPlayer(dline('playerHands'));
        break;
      case 'id':
        this._sayPlayer(dline('playerId'));
        break;
      case 'evac': {
        const id = g.npcs.evacNodeFor(t);
        const n = id != null ? g.world.nav.get(id) : null;
        const dir = n ? dirName(bearingDeg(t.position.x, t.position.z, n.x, n.z)) : '저';
        this._sayPlayer(dline('playerEvac', { dir }));
        break;
      }
      default:
        return false;
    }
    this.stats.questions++;
    if (this.reaction === 'ignore') this.reaction = 'stop';
    const r = respond(t, opt.key, ctx);
    for (const s of r.steps) s.npc = t;
    this.steps.push(...r.steps);
    this.busyT = r.end;
    g.events.emit(Events.DIALOGUE_ASK, { npc: t, question: opt.key, number: ctx.number });
    return true;
  }

  _runStep(s) {
    const npc = s.npc || this.target;
    // 상대가 죽었거나 정체를 드러냈으면 남은 대사는 버림
    if (npc && (!npc.alive || (npc.apparentFaction === 'enemy' && !s.act))) return;
    if (s.say && npc) npc.sayTalk(s.say);
    if (s.act) s.act();
    if (s.answer && npc) this._recordAnswer(npc, s.answer);
  }

  _recordAnswer(npc, ans) {
    const kind = talkKind(npc);
    if (ans.fail && npc.trueFaction === 'enemy') {
      npc.dialogueFailed = true;
      if (!this._exposed.has(npc.id)) {
        this._exposed.add(npc.id);
        this.stats.exposed++;
      }
    } else if (kind !== 'fake' && !ans.fail && !this._confirmed.has(npc.id)) {
      this._confirmed.add(npc.id);
      this.stats.confirmed++;
    }
    this.game.events.emit(Events.DIALOGUE_ANSWER, { npc, outcome: ans.outcome, fail: !!ans.fail });
  }

  close(reason = 'key') {
    const t = this.target;
    if (!t) return;
    this.target = null;
    this.closedAt = this.game.time;
    this.busyT = 0;
    // 사격·정체 드러냄·죽음이면 남은 대사도 끊김. 그 밖엔 이미 시작한 대답은 마저 함
    if (reason === 'fired' || reason === 'revealed' || reason === 'dead' || reason === 'player') this.steps = [];
    if (t.ctl && t.ctl.ignoring) t.ctl.ignoring = false;
    this.game.events.emit(Events.DIALOGUE_CLOSE, { npc: t, reason });
  }
}
