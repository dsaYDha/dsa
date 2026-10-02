// 위장 적 — 가짜 아군(파란 표식) / 가짜 민간인(사복). trueFaction 은 처음부터 enemy (점수·페널티 판정은 바뀌지 않음)
//
// 위장 프로필 (4단계 암구호·실내 문답에서 얼마나 잘 대답할지 정할 때 사용):
//   { as: 'ally'|'civilian', role: 'ambusher'(기습형)|'scout'(정찰형), mode: 'approach'|'escort'|'watch',
//     skill: 0~2 (위장 숙련도), gear: [장비 단서 키], traits: Set(행동 성향 키), revealed, revealedAt, revealReason }
//   장비 단서 키: npc/Clues.js GEAR_CLUES — 진짜 아군·민간인에겐 절대 없는 확정 증거
//   행동 성향: 아군형 loner·noFire|fireAir·ignoreRadio·stare·fromEnemySide / 민간인형 hideHands·noCower·lateHands|noHands
//   (정찰형은 '오래 지켜봄', 민간인 기습형은 '이쪽으로 다가옴'이 자연히 생긴다)
//
// 흐름: 등장 → 섞이기(blend: 분대 곁에 서기 / 민간인처럼 숨기) → 접근(approach)·동행(escort)·감시(watch)
//   → 기회(등을 보임·재장전·관찰 모드) 또는 오랜 대기 → 예고 동작(0.5~0.8초: 무기 꺼내기·표식 뜯기 + 장전음 "철컥")
//   → 정체를 드러냄(apparentFaction = enemy, 근거리 고명중) → 일반 적 상태 머신
// 정찰형: 창가·골목에서 플레이어를 지켜보다가 무전으로 근처에 습격을 부르고, 습격과 함께 정체를 드러낸다.
// 드러내기 전: 적은 공격하지 않고(진짜 소속이 적), 아군·민간인은 겉모습에 속는다(looksHostile = false).
// 4단계 말 걸기: '정지!'에 멈춤/못 들은 척/도주(talkHalt), 문답 압박(onQuestioned — 붙어 있은 시간이 빨리 참),
//   '들킨 것 같으면'(suspect) 기습 조건이 빨라지거나 도주(flee → 숨었다가 다시 접근하거나 습격을 부름),
//   "총 내려!"에 따르는 척(시선을 돌리면 기습이 빨리 참), "손 들어!"(늦게·한 손 늦게), 가짜 대피(fakeEvac).
//   문답에서 막혀 즉시 드러내는 경우는 reason 'questioned' (예고 동작 유지). 대답 규칙 자체는 dialogue/Responses.js
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { gameRand as R } from '../core/Random.js';
import { allyOutfit, civilianOutfit } from './Outfits.js';
import { FAKE_UNITS_PLAUSIBLE, FAKE_UNITS_ODD } from '../dialogue/DialogueLines.js';
import { GEAR_CLUES } from './Clues.js';
import {
  moveToward, escortTarget, pickApproachNode, yawToPlayer, yawOfPlayerForward,
  trackApproach, trackSquad, trackFightFire, nearestVisibleHostile,
} from './Behaviors.js';
import { line } from '../dialogue/Callouts.js';

const _e = new THREE.Vector3();
const _f = new THREE.Vector3();
const _v = new THREE.Vector3();
const _m = new THREE.Vector3();
const _d = new THREE.Vector3();

// 위협 단계 보간 (위장 적이 나오기 시작하는 단계 → 최고 단계)
export function disguiseT(threat) {
  const D = CONFIG.disguise;
  return Math.min(1, Math.max(0, (threat - D.fromThreat) / Math.max(1, CONFIG.threat.maxLevel - D.fromThreat)));
}
export function lerpD(pair, threat) {
  const t = disguiseT(threat);
  return pair[0] + (pair[1] - pair[0]) * t;
}
export function lerpRangeD(pairs, threat) {
  const t = disguiseT(threat);
  return [pairs[0][0] + (pairs[1][0] - pairs[0][0]) * t, pairs[0][1] + (pairs[1][1] - pairs[0][1]) * t];
}

/** 위장 프로필 생성 — 위협 단계가 오를수록 장비 단서가 줄고(2~3개 → 0~1개) 숙련도가 오른다 */
export function rollDisguiseProfile(as, threat, opts = {}) {
  const D = CONFIG.disguise;
  const [lo, hi] = lerpRangeD(D.gearClues, threat);
  let count = R.int(Math.round(lo), Math.round(hi));
  // 테스트·디버그: 숙련도를 지정하면 그에 맞는 장비 단서 수
  if (opts.skill != null) count = opts.skill >= 2 ? 0 : opts.skill === 1 ? 1 : R.int(2, 3);
  const role = opts.role || (R.chance(D.scoutChance[as]) ? 'scout' : 'ambusher');
  const pool = as === 'ally' ? ['curvedRifle', 'enemyHelmet', 'patch', 'tapeBand'] : ['combatBoots', 'waistBulge', 'backRifle', 'radio', 'vestStraps', 'tacticalGloves'];
  R.shuffle(pool);
  let gear = pool.slice(0, count).map((k) => (k === 'patch' ? (R.chance(0.55) ? 'patchMissing' : 'patchWrong') : k));
  // 정찰병은 무전기를 지닌 경우가 많다
  if (as === 'civilian' && role === 'scout' && gear.length && !gear.includes('radio') && R.chance(0.5)) gear[0] = 'radio';
  gear = [...new Set(gear)];
  const skill = gear.length >= 2 ? 0 : gear.length === 1 ? 1 : 2;
  let mode = 'approach';
  if (role === 'scout') mode = 'watch';
  else if (as === 'ally' && R.chance(D.escortChance)) mode = 'escort';
  if (opts.mode) mode = opts.mode;
  // 행동 성향 — 숙련될수록 적게
  const tpool = as === 'ally' ? ['loner', 'combat', 'ignoreRadio', 'stare', 'fromEnemySide'] : ['hideHands', 'noCower', 'hands'];
  R.shuffle(tpool);
  let n = R.int(D.behaviorTraits[0], D.behaviorTraits[1]);
  if (skill === 2) n = Math.max(1, n - 1);
  const traits = new Set();
  for (const k of tpool.slice(0, n)) {
    if (k === 'combat') traits.add(R.chance(0.5) ? 'noFire' : 'fireAir');
    else if (k === 'hands') traits.add(R.chance(0.55) ? 'lateHands' : 'noHands');
    else traits.add(k);
  }
  if (opts.fromEnemySide) traits.add('fromEnemySide');
  // 4단계: 어깨에 단 부대 패치(장비 단서가 없을 때)와 "소속 대!"에 댈 부대명
  const units = CONFIG.dialogue.units;
  const patchUnit = R.pick(units);
  let unitClaim = null;
  if (as === 'ally') {
    if (skill >= 2) unitClaim = R.chance(CONFIG.dialogue.skill2UnitMismatch) ? R.pick(units.filter((u) => u !== patchUnit)).name : patchUnit.name;
    else if (skill === 1) unitClaim = R.pick(FAKE_UNITS_PLAUSIBLE);
    else unitClaim = R.pick(FAKE_UNITS_ODD);
  }
  return {
    as, role, mode, skill, gear, traits,
    handsMode: R.chance(0.5) ? 'back' : 'pocket',
    revealed: false, revealedAt: null, revealReason: null,
    infiltrate: !!opts.infiltrate,
    patchUnit: patchUnit.name, // 어깨 패치 부대 (패치 단서가 있으면 무시됨)
    unitClaim, // "소속 대!" 대답 — 숙련도 0: 어색한 가짜 이름, 1: 그럴듯한 가짜 이름, 2: 진짜 부대명(패치와 다를 수 있음)
  };
}

/** 위장 복장 — 겉보기 진영의 복장에 장비 단서를 덧입힘 (표식 테이프는 spawn 쪽에서 Insignia 로) */
export function disguiseOutfit(profile) {
  let o;
  if (profile.as === 'ally') o = allyOutfit(CONFIG.dialogue.units.find((u) => u.name === profile.patchUnit));
  else {
    o = civilianOutfit(undefined, R.chance(0.1));
    if (o.bag === 'carry' && profile.traits.has('hideHands')) o.bag = null;
  }
  for (const g of profile.gear) {
    const c = GEAR_CLUES[profile.as][g];
    if (c && c.apply) c.apply(o);
  }
  return o;
}

export class DisguiseController {
  constructor(npc) {
    this.npc = npc;
    this.game = npc.game;
    this.p = npc.disguise;
    const D = CONFIG.disguise;
    const A = D.ambush;
    const th = npc.threat;
    this.mode = 'enter';
    this.modeT = 0;
    this.blendT = R.range(...D.blendTime) * (this.p.role === 'scout' ? 0.25 : this.p.infiltrate ? 0.2 : 1);
    this.closeT = 0;
    this.oppT = 0;
    this.oppNeed = R.range(...A.opportunityDelay);
    this.patience = R.range(...lerpRangeD(this.p.mode === 'escort' ? A.escortPatience : A.patience, th));
    this.watchT = 0;
    this.watchNeed = R.range(...lerpRangeD(D.scout.watchToCall, th));
    this.noLosT = 0;
    this.post = null;
    this.revealAt = null;
    this.calls = 0;
    this.senseT = 0;
    this.dist = 99;
    this.los = false;
    this.aimedT = 0;
    this.notAimedT = 99;
    this.handsWant = false;
    this.lateNeed = R.range(1.3, 2.1);
    this.panicNeed = R.range(2.2, 3.4) * (1 + this.p.skill * 0.3);
    this.fakeCowerT = 0;
    this.lookT = 0;
    this.lookYaw = 0;
    this.trackT = R.range(0, 0.5);
    this.combatT = 0;
    this.seesEnemy = null;
    this.fireT = R.range(1.5, 3.5);
    this.burstLeft = 0;
    this.burstT = 0;
    this.lastFireT = -99;
    this.target = null;
    this.retargetT = 0;
    this.side = R.sign() * R.range(1.8, 2.8);
    this.anchor = null;
    this.anchorOff = { x: R.range(-5, 5), z: R.range(-5, 5) };
    this.spoke = false;
    this.revealT = 0;
    this.revealDur = 0.6;
    this.swapped = false;
    // 4단계
    this.ignoring = false; // '정지!'를 못 들은 척 계속 걷는 중
    this.suspectT = 0; // '들킨 것 같음' — 기습 조건이 빨라짐
    this.questions = 0;
    this.pressured = false;
    this.cmdHandsT = 0; // "손 들어!"로 든 손 유지
    this.panicAcc = 0; // 조준당한 누적 (궁지 기습)
    this.talkAimedAt = -99;
    this.fleeTarget = null;
    this.hideT = 0;
    this.evacNode = null;
    this.evacT = 0;
    this.standT = 0;
    this.speeds = this.p.as === 'ally'
      ? { walk: CONFIG.ally.walk, run: CONFIG.ally.run }
      : { walk: CONFIG.civilian.walk * R.range(1.0, 1.15), run: CONFIG.civilian.run };
  }

  get label() {
    return this.mode;
  }

  _setMode(m) {
    this.mode = m;
    this.modeT = 0;
    this.target = null;
    this.retargetT = 0;
  }

  // ------------------------------------------------------------------
  update(dt) {
    const n = this.npc;
    this.modeT += dt;
    if (this.mode === 'reveal') {
      this._reveal(dt);
      return;
    }
    this._sense(dt);
    // 기본 자세 (모드가 덮어씀)
    n.aimTarget = this.p.as === 'ally' ? 0.35 : 0;
    n.crouchTarget = 0;
    n.aimPitch *= 0.9;
    this.lookT = Math.max(0, this.lookT - dt);

    // 손 들기 (가짜 민간인: 조준당하면 — 늦게 들거나 안 듦 / "손 들어!" 명령)
    this.notAimedT += dt;
    if (this.notAimedT > 0.3) {
      this.aimedT = Math.max(0, this.aimedT - dt * 2);
      if (this.game.time - this.talkAimedAt > 0.3) this.panicAcc = Math.max(0, this.panicAcc - dt * 2);
    }
    this.suspectT = Math.max(0, this.suspectT - dt);
    if (this.cmdHandsT > 0) {
      this.cmdHandsT -= dt;
      this.handsWant = true;
    } else if (this.handsWant && this.notAimedT > CONFIG.civilian.handsUpRelease) this.handsWant = false;
    n.handsUp += ((this.handsWant ? 1 : 0) - n.handsUp) * Math.min(1, dt * 8);
    // 가짜 웅크림 (총성에 웅크리는 척)
    if (this.fakeCowerT > 0) this.fakeCowerT -= dt;
    n.cower += ((this.fakeCowerT > 0 ? 1 : 0) - n.cower) * Math.min(1, dt * 6);
    // 손 숨기기 성향
    const hide = this.p.traits.has('hideHands') && this.p.as === 'civilian' && n.handsUp < 0.2 && this.fakeCowerT <= 0 && n.radioTalk < 0.2;
    n.handsMode = this.p.handsMode;
    n.hideHands += ((hide ? 1 : 0) - n.hideHands) * Math.min(1, dt * 4);

    const away = this.mode === 'flee' || this.mode === 'hidden' || this.mode === 'fakeEvac';
    if (n.handsUp > 0.5 || this.fakeCowerT > 0) {
      n.curSpeed = 0;
      if (this.fakeCowerT > 0) n.crouchTarget = 1;
      if (n.handsUp > 0.5) n.faceTowards(this.game.player.feet.x, this.game.player.feet.z);
    } else if (n.talkHoldT > 0 && !away && !this.ignoring) {
      // 4단계: 대화 중 — 멈춰 서서 플레이어를 바라봄 (진짜 아군·민간인과 같은 모습)
      n.curSpeed = 0;
      n.crouchTarget = 0;
      n.faceTowards(this.game.player.feet.x, this.game.player.feet.z);
      n.aimTarget = this.p.as === 'ally' ? 0.3 : 0;
    } else {
      switch (this.mode) {
        case 'enter': this._enter(); break;
        case 'blend': this._blend(dt); break;
        case 'approach': this._approach(dt); break;
        case 'escort': this._escort(dt); break;
        case 'loiter': this._loiter(dt); break;
        case 'watch': this._watch(dt); break;
        case 'call': this._call(dt); break;
        case 'flee': this._flee(dt); break;
        case 'hidden': this._hidden(dt); break;
        case 'fakeEvac': this._fakeEvac(dt); break;
        case 'stand': this._stand(dt); break;
        default: break;
      }
    }
    if (n.lowerT > 0) n.aimTarget = 0;
    if (this.lookT > 0 && n.curSpeed < 0.5) n.targetYaw = this.lookYaw;
    if (this.p.as === 'ally' && n.talkHoldT <= 0 && n.lowerT <= 0 && !away) this._allyCombatAct(dt);
    this._track(dt);
    this._checkAmbush(dt);
  }

  // 플레이어까지 거리·시야 (0.2초마다)
  _sense(dt) {
    this.senseT -= dt;
    if (this.senseT > 0) return;
    this.senseT = 0.2;
    const g = this.game;
    const n = this.npc;
    this.dist = n.position.distanceTo(g.player.feet);
    n.getEyePosition(_e);
    this.los = g.player.alive && this.dist < 60 && g.world.hasLineOfSight(_e, g.player.eye);
  }

  lookAt(pos, t = 1.2) {
    const n = this.npc;
    this.lookYaw = Math.atan2(pos.x - n.position.x, pos.z - n.position.z);
    this.lookT = t;
  }

  _enter() {
    this._setMode(this.p.role === 'scout' ? 'watch' : 'blend');
  }

  // 섞이기: 아군형은 분대 곁에 서고(혼자 성향이면 홀로 서성임), 민간인형은 민간인처럼 숨어 있음
  _blend(dt) {
    const n = this.npc;
    const g = this.game;
    if (this.p.as === 'ally') {
      if (!this.p.traits.has('loner')) {
        if (!this.anchor || this.anchor.done || this.modeT % 4 < dt) {
          let best = null;
          let bd = 40 * 40;
          for (const sq of g.npcs.squads) {
            if (sq.done || sq.straggler) continue;
            const c = sq.centroid(_v);
            const d2 = c.distanceToSquared(n.position);
            if (d2 < bd) {
              bd = d2;
              best = sq;
            }
          }
          this.anchor = best;
        }
      }
      if (this.anchor && !this.anchor.done) {
        const c = this.anchor.centroid(_v);
        const arrived = moveToward(n, dt, c.x + this.anchorOff.x, c.z + this.anchorOff.z, { walk: this.speeds.walk * 1.2, run: this.speeds.run, runDist: 14, stopDist: 2.2, repath: 2.0, y: c.y });
        if (arrived) {
          n.aimTarget = 0.5;
          n.crouchTarget = 0.35;
        }
      } else {
        n.curSpeed = 0;
        n.aimTarget = 0.45;
      }
    } else {
      // 민간인처럼: 근처 숨을 곳으로 가서 웅크림
      if (!this.target) {
        const id = g.npcs.pickCivilianHideNode(n, [2, 10]);
        this.target = id != null ? g.world.nav.get(id) : n.navNode != null ? g.world.nav.get(n.navNode) : null;
      }
      if (this.target) {
        const arrived = moveToward(n, dt, this.target.x, this.target.z, { walk: this.speeds.walk, run: this.speeds.run, runDist: 6, stopDist: 0.6, repath: 3, y: this.target.y });
        if (arrived) n.crouchTarget = 0.85;
      }
    }
    if (this.modeT > this.blendT) this._setMode(this.p.mode);
  }

  // 접근: 플레이어 주변(4.5~8m)으로 걸어옴 — 아군형은 등 뒤·옆, 민간인형은 앞에서 다가오기도 함
  _approach(dt) {
    const n = this.npc;
    const g = this.game;
    this.retargetT -= dt;
    if (!this.target || this.retargetT <= 0) {
      this.retargetT = 3.5;
      this.target = pickApproachNode(g, n, [4.5, 8], this.p.as === 'ally');
    }
    if (this.p.as === 'civilian' && !this.spoke && this.dist < 18 && this.los && (this.p.skill >= 1 || R.chance(0.3))) {
      // 숙련된 가짜 민간인은 도움을 청하는 진짜 민간인처럼 외치며 다가온다
      this.spoke = true;
      g.voice.say({ speaker: '민간인', text: line('civHelp'), channel: 'civilian', priority: 1, voice: n.voice });
      n.noteBehavior('helpCry');
    }
    if (this.target) {
      moveToward(n, dt, this.target.x, this.target.z, { walk: this.speeds.walk * 1.15, run: this.speeds.run * 0.85, runDist: 20, stopDist: 1.0, repath: 1.2, y: this.target.y });
    }
    if (this.p.traits.has('stare') || this.p.as === 'civilian') n.targetYaw = yawToPlayer(n);
    if (this.dist <= CONFIG.disguise.ambush.range * 0.85 && this.los) this._setMode('loiter');
  }

  // 동행: 플레이어 3~5m 뒤에 붙어 엄호하는 척 (진짜 동행 아군과 같은 이동 로직)
  _escort(dt) {
    const n = this.npc;
    const g = this.game;
    if (!this.spoke && this.dist < 14) {
      this.spoke = true;
      g.voice.say({ speaker: n.talkLabel, text: line('allyEscort'), channel: 'shout', priority: 1, voice: n.voice });
    }
    const t = escortTarget(g, n, 4.2, this.side);
    let arrived = true;
    if (t) arrived = moveToward(n, dt, t.x, t.z, { walk: this.speeds.walk * 1.3, run: this.speeds.run, runDist: 7, stopDist: 1.6, repath: 0.8 });
    else {
      n.path = null;
      n.curSpeed = 0;
    }
    if (arrived) {
      n.targetYaw = this.p.traits.has('stare') ? yawToPlayer(n) : yawOfPlayerForward(g);
      n.aimTarget = 0.6;
    }
    if (this.dist < 9) n.noteBehavior('escorting');
  }

  // 플레이어 곁에서 서성임 (기회를 기다림)
  _loiter(dt) {
    const n = this.npc;
    const g = this.game;
    n.curSpeed = 0;
    if (this.p.as === 'ally') {
      n.aimTarget = 0.45;
      n.targetYaw = this.p.traits.has('stare') ? yawToPlayer(n) : yawOfPlayerForward(g);
    } else {
      n.targetYaw = yawToPlayer(n);
      if (this.modeT % 5 < dt && R.chance(0.4)) this.lookAt(g.player.feet, 1.5);
    }
    if (this.dist > CONFIG.disguise.ambush.range + 3) this._setMode('approach');
  }

  // 정찰: 창가·골목에서 플레이어를 지켜봄 → 일정 시간 지켜보면 무전으로 습격을 부름
  _watch(dt) {
    const n = this.npc;
    const S = CONFIG.disguise.scout;
    if (!this.post || (this.noLosT > 6 && this.modeT > 3)) {
      this.post = this._pickPost();
      this.noLosT = 0;
      this.modeT = 0;
    }
    let atPost = true;
    if (this.post) atPost = moveToward(n, dt, this.post.x, this.post.z, { walk: this.speeds.walk, run: this.speeds.run, runDist: 14, stopDist: 0.5, repath: 2.5, y: this.post.y });
    if (!atPost) return;
    n.curSpeed = 0;
    // 창가: 창 쪽으로 반걸음 다가서서 내다봄 (창 노드는 벽에서 1m 안쪽)
    if (this.post && this.post.type === 'window' && this.post.out) {
      const tx = this.post.x + this.post.out.x * 0.55;
      const tz = this.post.z + this.post.out.z * 0.55;
      const dx = tx - n.position.x;
      const dz = tz - n.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.05) {
        const step = Math.min(d, this.speeds.walk * dt);
        n.position.x += (dx / d) * step;
        n.position.z += (dz / d) * step;
      }
    }
    n.crouchTarget = this.post && this.post.type === 'window' ? 0 : 0.2;
    n.targetYaw = yawToPlayer(n);
    if (this.los) {
      this.watchT += dt;
      this.noLosT = 0;
      if (this.watchT > S.longWatchClue) n.noteBehavior('longWatch', this.post && this.post.type === 'window' ? 'window' : null);
    } else this.noLosT += dt;
    if (this.calls === 0 && this.watchT >= this.watchNeed) this._setMode('call');
  }

  // 감시 자리: 플레이어가 보이는 창가(같은 건물 우선)나 골목·도로 지점. 보이는 자리가 없으면 플레이어 쪽으로 다가가 다시 찾음
  _pickPost() {
    const n = this.npc;
    const g = this.game;
    const nav = g.world.nav;
    const S = CONFIG.disguise.scout;
    const pf = g.player.feet;
    const info = g.world.getIndoorInfo(n.position);
    const cands = [];
    const add = (node, bonus) => {
      const dx = pf.x - node.x;
      const dz = pf.z - node.z;
      const d = Math.hypot(dx, dz);
      if (d < S.watchRange[0] || d > S.watchRange[1]) return;
      if (node.reservedBy && node.reservedBy.alive && node.reservedBy !== n) return;
      // 창가는 바깥(out)이 플레이어 쪽을 향해야 함
      if (node.type === 'window' && (!node.out || (node.out.x * dx + node.out.z * dz) / (d || 1) < 0.25)) return;
      const s = -Math.hypot(node.x - n.position.x, node.z - n.position.z) * 0.25 - Math.abs(d - 20) * 0.3 + bonus + R.range(0, 2);
      cands.push({ node, s });
    };
    if (info) {
      for (const w of info.building.windowNodes) {
        const node = nav.get(w.id);
        if (node && !node.removed) add(node, 6);
      }
    }
    for (const node of nav.inRadius(pf.x, pf.y, pf.z, S.watchRange[1], (q) => !q.indoor || q.type === 'window')) {
      if (info && node.type === 'window' && node.buildingId === info.building.id) continue;
      add(node, node.type === 'window' ? 3 : 0);
    }
    cands.sort((a, b) => b.s - a.s);
    let checks = 0;
    for (const c of cands) {
      if (checks++ >= 40) break;
      const q = c.node;
      const lean = q.type === 'window' && q.out ? 0.55 : 0;
      _v.set(q.x + (lean ? q.out.x * lean : 0), q.y + 1.55, q.z + (lean ? q.out.z * lean : 0));
      if (g.world.hasLineOfSight(_v, g.player.eye)) return q;
    }
    return pickApproachNode(g, n, [14, 22], false);
  }

  // 무전으로 습격 요청 (왼손을 귀로 — 3D 동작으로 보임)
  _call(dt) {
    const n = this.npc;
    const g = this.game;
    const S = CONFIG.disguise.scout;
    n.curSpeed = 0;
    n.radioTalk = Math.min(1, n.radioTalk + dt * 5);
    n.targetYaw = yawToPlayer(n) + 0.8;
    if (this.modeT < dt * 1.5) {
      n.noteBehavior('radioTalk');
      g.audio.enemyRadio(n.position);
    }
    if (this.modeT >= S.callTime) {
      n.radioTalk = 0;
      this.calls++;
      g.director.callInAssault(n);
      this.revealAt = g.time + R.range(...S.revealAfterCall);
      this.mode = 'watch';
      this.modeT = 4;
    }
  }

  // ------------------------------------------------------------------
  // 4단계: 말 걸기에 대한 행동 (규칙은 dialogue/Responses.js 가 정하고 여기서 실행)
  // ------------------------------------------------------------------
  /** '정지!' 반응 실행: 'stop' | 'ignore' | 'flee' */
  talkHalt(reaction) {
    const n = this.npc;
    if (reaction === 'stop') {
      n.holdForTalk(3);
      n.noteBehavior('stoppedOnHalt');
    } else if (reaction === 'ignore') {
      this.ignoring = true;
      n.noteBehavior('ignoredHalt');
    } else this.startFlee('halt');
  }

  /** 못 들은 척하다가 질문을 받고서야 멈춤 */
  stopIgnoring() {
    this.ignoring = false;
    this.npc.holdForTalk(3);
  }

  /** 질문을 받음 — 질문 자체가 압박: '오래 붙어 있음' 기습까지 남은 시간이 줄고, 계속 물으면 들킨 것 같다고 느낌 */
  onQuestioned() {
    const C = CONFIG.dialogue;
    this.questions++;
    // 질문 압박: 기습까지 남은 시간이 줄지만, 묻자마자 터지지는 않게 최소 pressureMinLeft 초는 남김
    this.closeT = Math.max(this.closeT, Math.min(this.closeT + C.questionPressure, this.patience - C.pressureMinLeft));
    if (!this.pressured && this.p.skill >= 1 && this.questions >= C.suspect.pressureQuestions) {
      this.pressured = true;
      this.suspect();
    }
  }

  /** '들킨 것 같으면' (숙련도 1~2): 기습 조건이 빨라지거나 거리를 벌려 도주 */
  suspect() {
    const S = CONFIG.dialogue.suspect;
    if (this.mode === 'reveal' || this.mode === 'flee' || this.mode === 'hidden') return;
    if (R.chance(S.boostChance)) {
      // 기습 조건 가속: 계속 붙어 있으면 revealIn 초 안에 기습 — 플레이어에겐 틀린 대답을 듣고 판단할 몇 초가 남는다
      this.suspectT = S.boostTime;
      this.closeT = Math.max(this.closeT, this.patience - R.range(...S.revealIn));
    } else this.startFlee('question');
  }

  /** 도주: 플레이어에게서 멀리, 가능하면 안 보이는 곳으로 → 숨었다가 다시 접근하거나 습격을 부름 */
  startFlee(variant) {
    const n = this.npc;
    const g = this.game;
    const F = CONFIG.dialogue.flee;
    if (this.mode === 'reveal' || this.p.revealed) return;
    this.ignoring = false;
    n.talkHoldT = 0;
    n.lowerT = 0;
    this.cmdHandsT = 0;
    this.handsWant = false;
    n.noteBehavior('fledTalk', variant);
    const pf = g.player.feet;
    const cands = g.world.nav.inRadius(n.position.x, n.position.y, n.position.z, F.dist[1] + 6, (q) => !q.removed && Math.abs(q.y - n.position.y) < 4);
    let best = null;
    let bestS = -Infinity;
    for (const q of cands) {
      const dp = Math.hypot(q.x - pf.x, q.z - pf.z);
      if (dp < F.dist[0]) continue;
      // 플레이어에게서 멀어지는 쪽, 너무 멀지 않게
      const away = (q.x - pf.x) * (n.position.x - pf.x) + (q.z - pf.z) * (n.position.z - pf.z);
      const s = (away > 0 ? 4 : -4) - Math.abs(dp - (F.dist[0] + F.dist[1]) / 2) * 0.15 + R.range(0, 3);
      if (s > bestS) {
        bestS = s;
        best = q;
      }
    }
    this.fleeTarget = best;
    this.hideT = R.range(...F.hideTime);
    this._setMode('flee');
  }

  _flee(dt) {
    const n = this.npc;
    n.crouchTarget = 0;
    n.aimTarget = 0;
    let arrived = true;
    if (this.fleeTarget) arrived = moveToward(n, dt, this.fleeTarget.x, this.fleeTarget.z, { walk: this.speeds.run, run: this.speeds.run * 1.05, runDist: 2, stopDist: 1.2, repath: 1.5, y: this.fleeTarget.y });
    if (arrived || this.modeT > 14) this._setMode('hidden');
  }

  // 숨어서 기다림 (플레이어에게 보이는 동안은 시간이 가지 않음) → 습격을 부르거나 다른 위치에서 다시 접근
  _hidden(dt) {
    const n = this.npc;
    n.curSpeed = 0;
    n.crouchTarget = 0.6;
    if (!n.visibleToPlayer) this.hideT -= dt;
    if (this.hideT > 0) return;
    if (this.calls === 0 && R.chance(CONFIG.dialogue.flee.callChance)) {
      this.closeT = 0;
      this._setMode('call');
    } else {
      this.closeT = 0;
      this.blendT = 0;
      this._setMode('approach');
    }
  }

  /** 가짜 대피: 대피로로 가는 척하다 멈추거나 되돌아옴 (행동 기록에 남음) */
  startFakeEvac() {
    const n = this.npc;
    const id = this.game.npcs.evacNodeFor(n);
    this.evacNode = id != null ? this.game.world.nav.get(id) : null;
    this.evacT = R.range(...CONFIG.dialogue.fakeEvac.walk);
    n.talkHoldT = 0;
    this._setMode('fakeEvac');
  }

  _fakeEvac(dt) {
    const n = this.npc;
    this.evacT -= dt;
    if (this.evacNode && this.evacT > 0) {
      moveToward(n, dt, this.evacNode.x, this.evacNode.z, { walk: this.speeds.walk * 1.2, run: this.speeds.run, runDist: 999, stopDist: 1, repath: 3, y: this.evacNode.y });
      return;
    }
    const ret = R.chance(CONFIG.dialogue.fakeEvac.returnChance);
    n.noteBehavior('fakeEvac', ret ? 'return' : 'stop');
    n.dialogueFailed = true;
    if (ret) {
      this.closeT = 0;
      this._setMode('approach');
    } else {
      this.standT = R.range(5, 9);
      this._setMode('stand');
    }
  }

  // 멈춰 서서 두리번거림 → 다시 접근
  _stand(dt) {
    const n = this.npc;
    n.curSpeed = 0;
    this.standT -= dt;
    if (this.modeT % 2.5 < dt) this.lookAt(this.game.player.feet, 1.2);
    if (this.standT <= 0) this._setMode('approach');
  }

  /** "손 들어!": lag 면 한 손이 늦게 (숙련도 2) */
  commandHands(hold, lagSec = 0) {
    const n = this.npc;
    this.cmdHandsT = hold;
    this.handsWant = true;
    this.aimedT = Math.max(this.aimedT, 0);
    if (lagSec > 0) n.lagHands(lagSec);
  }

  // 가짜 아군의 교전 흉내: 허공에 쏘기 / 아예 안 쏘기 / 적 근처로 빗나가게 쏘기(숙련)
  _allyCombatAct(dt) {
    const n = this.npc;
    this.combatT -= dt;
    if (this.combatT <= 0) {
      this.combatT = 0.5;
      this.seesEnemy = nearestVisibleHostile(n, 35);
    }
    if (this.burstLeft > 0) {
      this.burstT -= dt;
      n.curSpeed = 0;
      n.aimTarget = 1;
      if (this.burstAir) n.aimPitch = 0.75;
      if (this.burstT <= 0) {
        this.burstT = CONFIG.npc.shotInterval * R.range(0.9, 1.3);
        this.burstLeft--;
        this._fireBlank();
      }
      return;
    }
    const e = this.seesEnemy;
    if (!e || !e.alive || this.mode === 'call') return;
    const T = this.p.traits;
    if (T.has('noFire')) return;
    this.fireT -= dt;
    if (this.fireT > 0) return;
    this.fireT = R.range(1.6, 3.4);
    this.burstLeft = R.int(3, 5);
    this.burstT = 0.05;
    this.burstAir = T.has('fireAir');
    this.burstTarget = e;
    if (!this.burstAir) this.lookAt(e.position, 1.5);
  }

  // 피해 없는 사격 (허공 또는 대상 옆으로 크게 빗나감)
  _fireBlank() {
    const n = this.npc;
    const g = this.game;
    n.rig.getMuzzleWorld(_m);
    if (this.burstAir || !this.burstTarget || !this.burstTarget.alive) {
      _d.set(Math.sin(n.yaw) * 0.6, 1, Math.cos(n.yaw) * 0.6).normalize();
      n.noteBehavior('fireAir');
    } else {
      this.burstTarget.getChestPosition(_v);
      _v.x += R.range(1.8, 3.2) * R.sign();
      _v.y += R.range(0.6, 2.0);
      _d.subVectors(_v, _m).normalize();
      n.faceTowards(_v.x, _v.z);
      n.noteBehavior('firedAtEnemy');
    }
    n.rig.onFire();
    n.gunSound(_m);
    g.effects.enemyMuzzle(_m, _d);
    g.events.emit(Events.WEAPON_FIRED, { shooter: n, isPlayer: false, position: _m.clone(), direction: _d.clone() });
    const res = g.world.raycast(_m, _d, 70);
    if (res) g.effects.impact(res.point, res.normal, res.surface, res.distance > 4);
    if (R.chance(0.5)) g.effects.tracer(_m, res ? res.point : _v.copy(_m).addScaledVector(_d, 70), false);
    this.lastFireT = g.time;
  }

  // 행동 기록 (진짜 인물과 같은 기준)
  _track(dt) {
    this.trackT -= dt;
    if (this.trackT > 0) return;
    const step = 0.5;
    this.trackT = step;
    const n = this.npc;
    if (this.p.as === 'ally') {
      trackSquad(n, step);
      trackApproach(n, step, { key: 'stare', needFacing: true, need: 2.5 });
      trackFightFire(n, step, !!this.seesEnemy, this.p.traits.has('fireAir') ? -99 : this.lastFireT);
    } else {
      trackApproach(n, step, { key: 'towardPlayer', needFacing: false, need: 2.0, range: 30 });
      if (n.hideHands > 0.5) n.noteBehavior('hideHands', this.p.handsMode);
    }
  }

  // ------------------------------------------------------------------
  // 기습 조건: 가까이(range m 안, 서로 보임) 있으면서
  //   · 기회(등을 보임·재장전·관찰 모드)가 opportunityDelay 만큼 이어지면, 또는 · 붙어 있은 지 patience 초가 지나면
  // ------------------------------------------------------------------
  _checkAmbush(dt) {
    if (this.mode === 'enter' || this.mode === 'call' || this.mode === 'flee' || this.mode === 'hidden') return;
    const A = CONFIG.disguise.ambush;
    const g = this.game;
    const n = this.npc;
    if (!g.player.alive) return;
    if (this.revealAt != null && g.time >= this.revealAt && this.los && this.dist < 45) {
      this.startReveal('scout');
      return;
    }
    // 정찰형은 습격을 부르기 전엔 거리를 두고 지켜봄 (플레이어가 바짝 다가올 때만 기습)
    const range = this.p.role === 'scout' && this.calls === 0 ? 6 : A.range;
    if (this.dist > range || !this.los) {
      this.oppT = Math.max(0, this.oppT - dt * 2);
      this.closeT = Math.max(0, this.closeT - dt * 0.25);
      return;
    }
    this.closeT += dt;
    const cam = g.camera;
    cam.getWorldDirection(_f);
    _v.subVectors(n.position, cam.position);
    _f.y = 0;
    _v.y = 0;
    const ang = THREE.MathUtils.radToDeg(_f.angleTo(_v));
    this.backAngle = ang;
    // 4단계: "총 내려!"에 따르는 척하는 중이면 플레이어가 조금만 시선을 돌려도 기회 (기습 조건이 빨리 참)
    const L = CONFIG.dialogue.lowered;
    const lowered = n.lowerT > 0;
    const back = lowered ? ang > L.backAngle : this.p.mode !== 'escort' && ang > A.backAngle;
    const reload = g.weapon.reloading;
    const observing = g.observation && g.observation.active && this.dist < 7;
    let need = this.oppNeed;
    if (observing && !back && !reload) need *= 1 + this.p.skill * 0.6;
    if (lowered) need *= L.oppMul;
    const S = CONFIG.dialogue.suspect;
    if (this.suspectT > 0) need *= S.oppMul;
    const patience = this.patience;
    this.oppNow = back ? '등' : reload ? '재장전' : observing ? '관찰' : null;
    if (this.oppNow) this.oppT += dt;
    else this.oppT = Math.max(0, this.oppT - dt * 2);
    if (this.oppT >= need) this.startReveal(reload ? 'reload' : observing ? 'observe' : 'back');
    else if (this.closeT >= patience) this.startReveal('patience');
  }

  /** 기습 진행도 (디버그): 0~1 */
  get ambushProgress() {
    const sus = this.suspectT > 0;
    return Math.max(this.oppT / (this.oppNeed * (sus ? CONFIG.dialogue.suspect.oppMul : 1)), this.closeT / this.patience);
  }

  // ------------------------------------------------------------------
  // 외부 자극
  // ------------------------------------------------------------------
  // 근처 총성 (민간인처럼 보이는 위장 적): 웅크리는 척하거나(성향 없음) 웅크리지 않음(noCower)
  onGunfire(pos, dist) {
    if (this.p.as !== 'civilian' || this.mode === 'reveal') return;
    if (dist > CONFIG.civilian.hearRadius) return;
    if (this.p.traits.has('noCower')) {
      this.npc.noteBehavior('noCower');
      this.lookAt(pos, 1.2);
      return;
    }
    if (this.fakeCowerT <= 0) {
      this.fakeCowerT = R.range(1.2, 2.8);
      this.npc.noteBehavior('cowered');
    }
  }

  // 플레이어가 총으로 겨눔 (0.1초마다): 진짜 민간인은 곧바로 손을 듦 — 위장 적은 늦게 들거나 안 듦, 오래 겨눠지면 먼저 기습
  onAimedAt(step) {
    if (this.p.as !== 'civilian' || this.mode === 'reveal') return;
    const n = this.npc;
    this.aimedT += step;
    this.notAimedT = 0;
    const T = this.p.traits;
    const need = T.has('noHands') ? Infinity : T.has('lateHands') ? this.lateNeed : CONFIG.civilian.aimReactTime;
    if (this.aimedT > need && !this.handsWant) {
      this.handsWant = true;
      n.rig.onHit(0);
      n.noteBehavior(T.has('lateHands') ? 'lateHands' : 'handsUpQuick');
      if (this.p.skill >= 1 || R.chance(0.4)) this.game.voice.say({ speaker: '민간인', text: line('civAimed'), channel: 'civilian', priority: 2, voice: n.voice });
    }
    if (T.has('noHands') && this.aimedT > 1.2) n.noteBehavior('noHands');
    this._panic(step);
  }

  // 궁지: 오래 겨눠지면 먼저 기습
  _panic(step) {
    this.panicAcc += step;
    if (this.panicAcc > this.panicNeed && this.dist < 10 && this.los) this.startReveal('cornered');
  }

  // 4단계: 대화 중 겨눠짐 — 손 들기 반응 없이 궁지 압박만 (숙련될수록 태연한 척: 덜 쌓임)
  onTalkAimed(step) {
    if (this.p.as !== 'civilian' || this.mode === 'reveal') return;
    this.talkAimedAt = this.game.time; // 손 들기 반응(notAimedT)은 건드리지 않음 — 진짜 민간인처럼 곧 손을 내림
    this._panic(step * (this.p.skill >= 1 ? CONFIG.dialogue.aimPanicMulInTalk : 1));
  }

  // 아군 무전 콜아웃이 들림: 진짜 아군처럼 그쪽을 돌아보거나, 성향에 따라 무시
  onRadioCallout(enemy) {
    if (this.p.as !== 'ally' || this.mode === 'reveal' || this.dist > 40) return;
    if (this.p.traits.has('ignoreRadio')) {
      this.npc.noteBehavior('ignoreRadio');
      return;
    }
    this.lookAt(enemy.position, 1.6);
    this.npc.noteBehavior('radioAck');
  }

  // ------------------------------------------------------------------
  // 정체 드러내기 — 0.5~0.8초 예고(무기 꺼내기·표식 뜯기 + 장전음) 후 일반 적
  // ------------------------------------------------------------------
  startReveal(reason) {
    if (this.mode === 'reveal' || this.p.revealed) return;
    const A = CONFIG.disguise.ambush;
    const n = this.npc;
    const g = this.game;
    this.mode = 'reveal';
    this.modeT = 0;
    this.revealT = 0;
    this.p.revealStarted = true;
    this.p.revealReason = reason;
    this.ignoring = false;
    this.cmdHandsT = 0;
    n.talkHoldT = 0;
    n.lowerT = 0;
    n.cardT = 0;
    this.revealDur = reason === 'damaged' ? A.damagedTelegraph : R.range(A.telegraph[0], A.telegraph[1]);
    n.path = null;
    n.curSpeed = 0;
    this.burstLeft = 0;
    this.handsWant = false;
    _v.copy(n.position);
    _v.y += 1.3;
    g.audio.rack(_v);
    if (this.dist < 30) g.audio.revealSting();
    g.events.emit(Events.DISGUISE_REVEALING, { npc: n, reason });
  }

  _reveal(dt) {
    const n = this.npc;
    const g = this.game;
    this.revealT += dt;
    const k = Math.min(1, this.revealT / this.revealDur);
    n.curSpeed = 0;
    n.crouchTarget = 0;
    n.hideHands = Math.max(0, n.hideHands - dt * 8);
    n.handsUp = Math.max(0, n.handsUp - dt * 8);
    n.cower = Math.max(0, n.cower - dt * 8);
    n.radioTalk = 0;
    n.faceTowards(g.player.feet.x, g.player.feet.z);
    const swapAt = this.p.revealReason === 'damaged' ? 0.8 : 0.5; // 먼저 맞았으면 몸을 추스르느라 조금 늦게
    if (this.p.as === 'ally') {
      // 왼손으로 완장을 뜯어냄 → 밑에 감춰 둔 빨간 완장
      n.tear = k < 0.55 ? Math.min(1, k / 0.3) : Math.max(0, 1 - (k - 0.55) / 0.3);
      if (!this.swapped && k >= swapAt - 0.05) {
        this.swapped = true;
        n.setApparentFaction('enemy');
        _v.copy(n.position);
        _v.y += 1.3;
        g.effects.shreds(_v, this.p.gear.includes('tapeBand') ? CONFIG.insignia.tapeColor : CONFIG.factions.ally.insignia.color);
        g.audio.tapeRip(_v);
      }
      n.aimTarget = k > 0.55 ? 1 : 0.4;
    } else {
      // 오른손을 등 뒤 옷 속으로 → 숨긴 총을 꺼내 듦 (+ 빨간 완장)
      n.reach = k < 0.5 ? Math.min(1, k / 0.3) : Math.max(0, 1 - (k - 0.5) / 0.35);
      if (!this.swapped && k >= swapAt) {
        this.swapped = true;
        const o = { ...n.rig.outfit, rifle: true, rifleStyle: 'curved', backRifle: false, waistBulge: false };
        n.setApparentFaction('enemy', o);
        n.insignia.setShape('armband');
      }
      n.aimTarget = k > 0.5 ? 1 : 0;
    }
    if (k >= 1) this._complete();
  }

  _complete() {
    const n = this.npc;
    const g = this.game;
    const p = this.p;
    p.revealed = true;
    p.revealedAt = g.time;
    n.tear = 0;
    n.reach = 0;
    n.hideHands = 0;
    n.hotUntil = g.time + CONFIG.disguise.ambush.hotTime;
    n.spawnTime = Math.min(n.spawnTime, g.time - 10);
    n.aware = true;
    n.target = 'player';
    n.hasLOS = this.los;
    n.lastLOST = g.time;
    n.losStartT = g.time - 2;
    n.reactT = 0.05;
    n.lastKnown.copy(g.player.feet);
    n.burstLeft = 0;
    n.burstPauseT = 0.05;
    if (this.post && this.post.type === 'window' && this.post.out && n.navNode === this.post.id) {
      n.postOut = this.post.out;
      n.goalNode = this.post.id;
      n.coverPhase = 'peek';
      n.phaseT = R.range(2, 3.5);
      n._setState('post');
    } else n._enterEngage();
    g.events.emit(Events.DISGUISE_REVEALED, { npc: n, as: p.as, role: p.role, reason: p.revealReason, ambush: p.revealReason !== 'damaged' });
  }

  /** 정체를 다 드러내기 전에 사살됐는지 (먼저 맞아서, 또는 4단계 문답에 막혀 드러내던 중이면 플레이어의 판단으로 인정) */
  get identifiedKill() {
    return !this.p.revealed && (!this.p.revealStarted || this.p.revealReason === 'damaged' || this.p.revealReason === 'questioned');
  }

  // 드러내기 전에 사살됨: 숨긴 무기가 떨어지거나 테이프 완장이 벗겨지는 연출 (점수는 ScoreSystem 이 NPC_KILLED 로 처리)
  onKilled() {
    const n = this.npc;
    const g = this.game;
    const identified = this.identifiedKill;
    _v.copy(n.position);
    _v.y += 1.0;
    if (this.swapped) {
      // 이미 무기를 꺼냈거나 완장을 뜯은 뒤
    } else if (this.p.as === 'ally') {
      g.effects.shreds(_v, n.insignia.color ?? CONFIG.factions.ally.insignia.color);
      n.insignia.setColor(CONFIG.factions.enemy.insignia.color);
      n.insignia.setShape('band');
    } else {
      g.effects.dropRifle(n.position, n.yaw, n._indoor || 0);
      g.audio.clatter(n.position);
      n.rig.applyOutfit({ ...n.rig.outfit, backRifle: false, waistBulge: false });
    }
    if (identified) g.events.emit(Events.DISGUISE_KILLED, { npc: n, as: this.p.as });
  }
}
