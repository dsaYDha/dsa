// 4단계 대답 규칙 — 누가(진짜 아군 / 진짜 민간인 / 위장 적 숙련도 0·1·2) 무엇을 물으면 어떻게 반응하는지 한곳에 모은 표
// 반환값은 '대본': 질문 뒤 몇 초에 무슨 말을 하고(say) 무슨 행동을 하는지(act). DialogueSystem 이 실시간으로 실행한다.
//   { steps: [{ at, say?, act?, answer?: { outcome, fail } }], end }
//   answer.fail: 위장 적이 문답에서 틀리거나 머뭇거림 → 사살 시 '근거 있는 판단' (화면에는 판정을 보여주지 않는다)
// 대사 문장은 DialogueLines.js, 행동 실행은 각 AI(AllySoldier·CivilianNPC·DisguiseController)
//
// 숙련도별 반응 (요약 — 자세한 표는 CLAUDE.md "숙련도별 반응 표")
//   정지!       진짜: 멈춰 돌아봄 / 위장: config.dialogue.halt 확률로 멈춤·못 들은 척·도주
//   암구호      진짜: 0.5~1초에 현재 답어 (교체 직후 20초 안 30%: 이전 답어 → 곧 정정)
//               숙련 0: 머뭇 → 엉뚱한 단어 | 도주 | 바로 기습 / 숙련 1: 유출된 이전 답어(정정 없음) / 숙련 2: 현재 답어
//   실내 문답   진짜: 즉시 정답 / 위장(숙련 무관): 머뭇 → 추측 (맞힐 확률 10%)
//   소속 대!    진짜: 자기 부대(패치와 일치) / 숙련 0: 머뭇 → 어색한 없는 부대 / 1: 그럴듯한 없는 부대 / 2: 진짜 부대명(패치와 다를 수 있음)
//   총 내려!    진짜: 투덜대며 내림 / 숙련 0: 거부 또는 기습 / 숙련 1~2: 따르는 척 (시선을 돌리면 기습이 빨리 참)
//   손 들어!    진짜: 즉시 빈손 / 숙련 0: 거부 또는 도주 / 1: 늦게 듦 / 2: 한 손이 늦음
//   신분증      진짜: 보여 줌 / 숙련 0~1: "잃어버렸어요" / 2: 위조 신분증(겉보기 같음)
//   대피하세요  진짜: 대피로로 감 / 위장: 가는 척하다 멈추거나 되돌아옴
//   숙련 0 이 막히면 skill0RevealOnStuck 확률로 즉시 정체를 드러냄 (예고 동작 유지), 숙련 1~2 는 '들킨 것 같으면' 기습 조건이 빨라지거나 도주
import { CONFIG } from '../config.js';
import { gameRand as R } from '../core/Random.js';
import { dline, numWord, WRONG_WORDS } from './DialogueLines.js';

const rng = (a) => R.range(a[0], a[1]);

// 신분증을 꺼내려면 들고 있던 손부터 내림
function lowerHands(npc) {
  if (npc.ctl) {
    npc.ctl.cmdHandsT = 0;
    npc.ctl.handsWant = false;
  } else npc.cmdHandsT = 0;
}

function weighted3(ws) {
  const r = R.next() * (ws[0] + ws[1] + ws[2]);
  return r < ws[0] ? 0 : r < ws[0] + ws[1] ? 1 : 2;
}

/** 대상 분류: 'ally' | 'civilian' | 'fake' */
export function talkKind(npc) {
  if (npc.disguised) return 'fake';
  return npc.trueFaction === 'ally' ? 'ally' : 'civilian';
}

/** 겉보기에 따른 질문 목록 (메뉴 1~4) */
export const QUESTIONS = {
  ally: [
    { key: 'password', label: '암구호' },
    { key: 'indoor', label: '실내 확인 문답', indoorOnly: true },
    { key: 'unit', label: '소속 확인 ("소속 대!")' },
    { key: 'lower', label: '"총 내려!"' },
  ],
  civilian: [
    { key: 'hands', label: '"손 들어!"' },
    { key: 'id', label: '"신분증 보여주세요"' },
    { key: 'evac', label: '"이쪽으로 대피하세요"' },
  ],
};

// ------------------------------------------------------------------
// '정지!' 반응
// ------------------------------------------------------------------
/** @returns {{ reaction: 'stop'|'ignore'|'flee', steps }} */
export function haltReaction(npc) {
  const kind = talkKind(npc);
  const civLook = npc.apparentFaction === 'civilian';
  let reaction = 'stop';
  if (kind === 'fake') reaction = ['stop', 'ignore', 'flee'][weighted3(CONFIG.dialogue.halt[npc.disguise.skill])];
  const steps = [];
  const at = R.range(0.25, 0.5);
  if (reaction === 'stop') {
    steps.push({ at, act: () => (kind === 'fake' ? npc.ctl.talkHalt('stop') : (npc.holdForTalk(3), npc.noteBehavior('stoppedOnHalt'))) });
    if (R.chance(0.6)) steps.push({ at: at + 0.25, say: dline(civLook ? 'civHaltStop' : 'allyHaltStop') });
  } else {
    steps.push({ at, act: () => npc.ctl.talkHalt(reaction) });
  }
  return { reaction, steps };
}

// ------------------------------------------------------------------
// 질문에 대한 대답
// ------------------------------------------------------------------
/**
 * @param npc 대상
 * @param q 'password'|'indoor'|'unit'|'lower'|'hands'|'id'|'evac'
 * @param ctx { cs: CountersignSystem, number: 플레이어가 외친 수 (실내 문답) }
 */
export function respond(npc, q, ctx) {
  const kind = talkKind(npc);
  const C = CONFIG.dialogue;
  const out = { steps: [], end: 0 };
  // 달아나는(숨은) 위장 적은 대답하지 않고 계속 달아남
  if (kind === 'fake' && (npc.ctl.mode === 'flee' || npc.ctl.mode === 'hidden' || npc.ctl.mode === 'reveal')) {
    out.end = 0.8;
    return out;
  }
  let shift = 0;
  // 못 들은 척 걷던 위장 적: 질문을 받고서야 멈춤
  if (kind === 'fake' && npc.ctl.ignoring) {
    out.steps.push({ at: 0.4, act: () => npc.ctl.stopIgnoring(), say: dline('haltLateNotice') });
    shift = 1.0;
  }
  // 진짜 아군(과 그를 흉내 내는 숙련 2 위장 아군): 30초 안에 세 번 넘게 물으면 짜증 — 대답이 늦어질 뿐 페널티는 없음
  if ((kind === 'ally' || (kind === 'fake' && npc.disguise.as === 'ally' && npc.disguise.skill >= 2)) && npc.noteQuestion(C.annoy.window) > C.annoy.maxQuestions) {
    out.steps.push({ at: shift + 0.35, say: dline('allyAnnoyed'), act: () => npc.noteBehavior('annoyed') });
    shift += rng(C.annoyExtraDelay);
  }
  if (kind === 'fake') npc.ctl.onQuestioned();
  const body = kind === 'ally' ? realAlly(npc, q, ctx) : kind === 'civilian' ? realCivilian(npc, q) : fake(npc, q, ctx);
  for (const s of body) out.steps.push({ ...s, at: s.at + shift });
  out.end = out.steps.reduce((m, s) => Math.max(m, s.at), 0) + 0.5;
  return out;
}

// ---------------- 진짜 아군 ----------------
function realAlly(npc, q, ctx) {
  const C = CONFIG.dialogue;
  const cs = ctx.cs;
  const ok = (outcome = 'correct') => ({ outcome, fail: false });
  switch (q) {
    case 'password': {
      const at = rng(C.answerDelay);
      // 교체 직후엔 이전 답어를 말했다가 곧 정정 (오판 유도)
      if (cs.stale && cs.previous && R.chance(C.countersign.realStaleChance)) {
        return [
          { at, say: dline('allyPasswordStale', { p: cs.previous.reply }), answer: ok('stale') },
          { at: at + rng(C.countersign.correctionDelay), say: dline('allyCorrection', { r: cs.current.reply }) },
        ];
      }
      return [{ at, say: dline('allyPassword', { r: cs.current.reply }), answer: ok() }];
    }
    case 'indoor':
      return [{ at: rng(C.indoorDelay), say: dline('allyIndoor', { a: numWord(cs.indoorBase - ctx.number) }), answer: ok() }];
    case 'unit':
      return [{ at: rng(C.answerDelay), say: dline('allyUnit', { unit: npc.unit ? npc.unit.name : '철방패대대', sq: npc.squad ? npc.squad.name : '알파' }), answer: ok() }];
    case 'lower':
      return [{ at: R.range(0.3, 0.6), say: dline('allyLower'), answer: ok(), act: () => (npc.lowerWeapon(C.lowered.real), npc.noteBehavior('loweredWeapon')) }];
    default:
      return [];
  }
}

// ---------------- 진짜 민간인 ----------------
function realCivilian(npc, q) {
  const C = CONFIG.dialogue;
  const ok = { outcome: 'correct', fail: false };
  switch (q) {
    case 'hands':
      return [
        { at: R.range(0.15, 0.3), act: () => npc.commandHands(C.hands.holdReal), answer: ok },
        { at: 0.45, say: dline('civHands') },
      ];
    case 'id':
      return [{ at: R.range(0.6, 1.0), say: dline('civId'), act: () => (lowerHands(npc), npc.presentCard(C.idShow), npc.noteBehavior('showedId')), answer: ok }];
    case 'evac':
      return [{ at: R.range(0.35, 0.6), say: dline('civEvac'), act: () => npc.dlgEvacuate(), answer: ok }];
    default:
      return [];
  }
}

// ---------------- 위장 적 ----------------
// 숙련 0 이 막힘 → 일정 확률로 즉시 정체를 드러냄 / 숙련 1~2 → 들킨 것 같으면 (기습 조건 가속 또는 도주)
function stuck(npc, at) {
  const ctl = npc.ctl;
  if (npc.disguise.skill === 0) {
    if (R.chance(CONFIG.dialogue.skill0RevealOnStuck)) return [{ at: at + R.range(0.3, 0.6), act: () => ctl.startReveal('questioned') }];
    return [];
  }
  return [{ at: at + 0.4, act: () => ctl.suspect() }];
}

function hesitateLine(at) {
  return { at, say: dline('fakeHesitate') };
}

function fake(npc, q, ctx) {
  const C = CONFIG.dialogue;
  const p = npc.disguise;
  const ctl = npc.ctl;
  const cs = ctx.cs;
  const skill = p.skill;
  const fail = (outcome) => ({ outcome, fail: true });
  const pass = (outcome) => ({ outcome, fail: false });
  const hes = () => npc.noteBehavior('hesitated');
  switch (q) {
    case 'password': {
      if (skill >= 2) return [{ at: rng(C.answerDelay), say: dline('allyPassword', { r: cs.current.reply }), answer: pass('correct') }];
      if (skill === 1) return [{ at: rng(C.answerDelay), say: dline('allyPassword', { r: cs.previous ? cs.previous.reply : '...' }), answer: fail('leaked') }];
      const pick = weighted3(C.skill0Password);
      if (pick === 1) return [{ at: R.range(0.3, 0.6), act: () => ctl.startFlee('question'), answer: fail('flee') }];
      if (pick === 2) return [{ at: R.range(0.25, 0.5), act: () => ctl.startReveal('questioned'), answer: fail('ambush') }];
      const at = rng(C.hesitate);
      const used = [cs.current.reply, cs.previous && cs.previous.reply];
      const w = R.pick(WRONG_WORDS.filter((x) => !used.includes(x)));
      return [hesitateLine(0.45), { at, say: dline('fakePasswordWrong', { w }), act: hes, answer: fail('wrong') }, ...stuck(npc, at)];
    }
    case 'indoor': {
      // 실내 기준수는 아군 부대 안에서만 공유 — 위장 적은 숙련도와 무관하게 모른다: 머뭇거린 뒤 추측
      const at = rng(C.hesitate);
      const right = cs.indoorBase - ctx.number;
      let a = right;
      if (!R.chance(C.indoor.fakeGuessChance)) {
        const opts = [];
        for (let v = 1; v <= 11; v++) if (v !== right) opts.push(v);
        a = R.pick(opts);
      }
      return [hesitateLine(0.45), { at, say: dline('fakeIndoorGuess', { a: numWord(a) }), act: hes, answer: fail(a === right ? 'guessRight' : 'guessWrong') }, ...stuck(npc, at)];
    }
    case 'unit': {
      if (skill >= 2) {
        const mismatch = p.unitClaim !== p.patchUnit || !!p.gear.find((g) => g.startsWith('patch'));
        return [{ at: rng(C.answerDelay), say: dline('fakeUnitConfident', { unit: p.unitClaim }), answer: mismatch ? fail('unitMismatch') : pass('correct') }];
      }
      if (skill === 1) return [{ at: rng(C.answerDelay), say: dline('fakeUnitConfident', { unit: p.unitClaim }), answer: fail('fakeUnit') }];
      const at = rng(C.hesitate);
      return [hesitateLine(0.45), { at, say: dline('fakeUnitOdd', { unit: p.unitClaim }), act: hes, answer: fail('oddUnit') }, ...stuck(npc, at)];
    }
    case 'lower': {
      if (skill >= 1) {
        return [{ at: R.range(0.4, 0.75), say: dline('fakeLowerComply'), act: () => (npc.lowerWeapon(C.lowered.fake), npc.noteBehavior('loweredWeapon')), answer: pass('comply') }];
      }
      if (R.chance(C.skill0LowerRefuse)) return [{ at: R.range(0.4, 0.7), say: dline('fakeLowerRefuse'), act: () => npc.noteBehavior('refused'), answer: fail('refuse') }];
      return [{ at: R.range(0.3, 0.5), act: () => ctl.startReveal('questioned'), answer: fail('ambush') }];
    }
    case 'hands': {
      if (skill === 0) {
        if (R.chance(C.skill0HandsFlee)) return [{ at: R.range(0.3, 0.6), act: () => ctl.startFlee('question'), answer: fail('flee') }];
        const at = R.range(0.5, 0.8);
        return [{ at, say: dline('fakeHandsRefuse'), act: () => npc.noteBehavior('refused'), answer: fail('refuse') }, ...stuck(npc, at)];
      }
      if (skill === 1) {
        const at = rng(C.hands.late);
        return [
          { at: 0.55, say: dline('fakeHandsLate') },
          { at, act: () => (ctl.commandHands(C.hands.holdReal + 1), npc.noteBehavior('lateHands')), answer: fail('late') },
        ];
      }
      const lag = rng(C.hands.lag);
      return [
        { at: R.range(0.25, 0.4), act: () => ctl.commandHands(C.hands.holdReal, lag), answer: fail('oneHandLate') },
        { at: 0.45, say: dline('civHands') },
        { at: 0.3 + lag, act: () => npc.noteBehavior('oneHandLate') },
      ];
    }
    case 'id': {
      if (skill >= 2) return [{ at: R.range(0.7, 1.1), say: dline('civId'), act: () => (lowerHands(npc), npc.presentCard(C.idShow), npc.noteBehavior('showedId')), answer: pass('forged') }];
      const at = rng(C.hesitate);
      return [hesitateLine(0.45), { at, say: dline('fakeIdLost'), act: () => npc.noteBehavior('noId'), answer: fail('lostId') }, ...stuck(npc, at)];
    }
    case 'evac':
      // 대답은 진짜와 같고, 가다가 멈추거나 되돌아오는 행동이 단서 (그때 dialogueFailed)
      return [{ at: R.range(0.35, 0.6), say: dline('civEvac'), act: () => ctl.startFakeEvac(), answer: pass('fakeEvac') }];
    default:
      return [];
  }
}
