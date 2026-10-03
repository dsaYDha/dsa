// 규칙 테스트: 강제 생성(진짜 아군·민간인 / 위장 적 숙련도 0·1·2)으로 문답·관찰·점수·페널티·난이도 곡선 규칙 확인
// 사용: node tests/rules.mjs
import { openGame, STEP, check, finish } from './lib.mjs';

const { page, errors, close } = await openGame('?nolock&gfx=low');
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state === 'playing');
await page.evaluate(`window.step = ${STEP};`);
await page.evaluate(() => {
  const g = window.__game;
  g.player.takeDamage = function () {};
  // 문답 도우미: 대상에게 바로 대화를 열고(조준 없이) 질문 → 대답 이벤트 모음
  window.ask = (npc, slot, wait = 4) => {
    const d = g.dialogue;
    const answers = [];
    const off = g.events.on('dialogue:answer', (e) => { if (e.npc === npc) answers.push(e.outcome + (e.fail ? '!' : '')); });
    const h0 = g.voice.history.length;
    d.target = npc;
    d.lastTarget = npc;
    d.reaction = 'stop';
    d.busyT = 0;
    d.idleT = 99;
    npc.holdForTalk(5);
    d.ask(slot);
    window.step(wait);
    off();
    const said = g.voice.history.slice(h0).filter((l) => l.speaker !== '나').map((l) => l.text);
    if (d.target) d.close('key');
    return { answers, said };
  };
});

console.log('· 난이도 곡선: 첫 1분(적응)엔 위장 적 없음');
const c0 = await page.evaluate(() => {
  const g = window.__game;
  return { phase: g.director.curve.name, cap: g.director.capFor('disguised'), fake: g.director.curve.fakeAlly };
});
check('적응 구간 위장 상한 0', c0.cap === 0 && c0.fake === 0, JSON.stringify(c0));
const c1 = await page.evaluate(() => {
  const g = window.__game;
  window.step(62);
  return { phase: g.director.curve.name, cap: g.director.capFor('disguised'), threat: g.director.threat, skill0: g.director.curve.skill[0] };
});
check('1분 뒤 위장 등장 구간 (상한 2, 숙련 0 위주)', c1.phase === '위장 등장' && c1.cap === 2 && c1.skill0 > 0.8 && c1.threat === 2, JSON.stringify(c1));

console.log('· 진짜 아군 문답');
const ally = await page.evaluate(() => {
  const g = window.__game;
  const leader = g.debugSpawn('ally', { size: 1, distRange: [6, 14] });
  window.step(1);
  const cs = g.countersign;
  g.time += 30; // 교체 직후 '실수 → 정정' 구간을 벗어나게
  const pw = window.ask(leader, 1, 3);
  const unit = window.ask(leader, 3, 3);
  return { reply: cs.current.reply, pw, unit, unitName: leader.unit && leader.unit.name, patch: leader.rig.outfit.patch, unitPatch: leader.unit && leader.unit.patch };
});
check('암구호: 현재 답어', ally.pw.said.some((s) => s.includes(ally.reply)) && !ally.pw.answers.some((a) => a.endsWith('!')), JSON.stringify(ally.pw));
check('소속: 자기 부대 + 패치 일치', ally.unit.said.some((s) => s.includes(ally.unitName)) && ally.patch === ally.unitPatch, `${ally.unitName} / ${ally.patch}`);

console.log('· 위장 아군 숙련도별 암구호·소속');
const fakes = await page.evaluate(() => {
  const g = window.__game;
  const out = [];
  for (const skill of [0, 1, 2]) {
    const n = g.debugSpawn('disguised', { as: 'ally', skill, distRange: [6, 14] });
    if (!n) continue;
    window.step(0.5);
    n.ctl.patience = 999; // 테스트 중 기습하지 않게
    n.ctl.closeT = 0;
    const pw = window.ask(n, 1, 4);
    const unit = n.alive && n.disguised ? window.ask(n, 3, 4) : null;
    out.push({ skill, gear: n.disguise.gear.length, pw, unit, prev: g.countersign.previous.reply, cur: g.countersign.current.reply, claim: n.disguise.unitClaim, patchUnit: n.disguise.patchUnit, revealed: !n.disguised });
    n.takeDamage({ amount: 999, zone: 'torso', attacker: 'test' });
  }
  return out;
});
for (const f of fakes) console.log('  ', JSON.stringify(f));
const s0 = fakes.find((f) => f.skill === 0);
const s1 = fakes.find((f) => f.skill === 1);
const s2 = fakes.find((f) => f.skill === 2);
check('숙련 0: 장비 단서 2~3개', s0 && s0.gear >= 2);
check('숙련 0: 암구호 실패(엉뚱한 단어·도주·기습)', s0 && (s0.revealed || s0.pw.answers.some((a) => a.endsWith('!')) || s0.pw.said.length === 0));
check('숙련 1: 장비 단서 1개 + 이전(유출) 답어', s1 && s1.gear === 1 && s1.pw.said.some((s) => s.includes(s1.prev)));
check('숙련 2: 장비 단서 0개 + 현재 답어', s2 && s2.gear === 0 && s2.pw.said.some((s) => s.includes(s2.cur)));
check('숙련 2: 진짜 부대명을 댐', s2 && (s2.unit ? s2.unit.said.some((s) => /철방패대대|샛별중대|봉우리대대/.test(s)) : true));

console.log('· 민간인 "손 들어!"·신분증');
const civ = await page.evaluate(() => {
  const g = window.__game;
  const real = g.debugSpawn('civilian', { distRange: [5, 12] });
  window.step(1.5);
  const hands = window.ask(real, 1, 1.0);
  const handsUp = real.handsUp;
  const id = window.ask(real, 2, 1.5);
  const card = !!(real.rig.card && real.rig.card.visible);
  const fake = g.debugSpawn('disguised', { as: 'civilian', skill: 1, distRange: [5, 12] });
  window.step(0.5);
  fake.ctl.patience = 999;
  const fid = window.ask(fake, 2, 3.5);
  return { handsUp: +handsUp.toFixed(2), hands, card, id, fid, failed: fake.dialogueFailed };
});
check('진짜 민간인: 즉시 손 듦', civ.handsUp > 0.5, `handsUp ${civ.handsUp}`);
check('진짜 민간인: 신분증 보여 줌', civ.card);
check('위장 민간인 숙련 1: 신분증 분실 → 문답 실패 기록', civ.failed && civ.fid.answers.some((a) => a.endsWith('!')), JSON.stringify(civ.fid));

console.log('· 점수·페널티');
const score = await page.evaluate(() => {
  const g = window.__game;
  const s0 = g.score.score;
  const fake = g.debugSpawn('disguised', { as: 'ally', skill: 0, distRange: [6, 14] });
  window.step(0.5);
  fake.getObserved().anomalies = 1;
  let kill = null;
  const off = g.events.on('score:kill', (e) => { if (e.victim === fake) kill = e; });
  fake.takeDamage({ amount: 999, zone: 'torso', attacker: 'player', direction: g.camera.position.clone().sub(fake.position).normalize(), distance: 8 });
  off();
  const s1 = g.score.score;
  const ally = g.debugSpawn('ally', { size: 1, distRange: [6, 14] });
  window.step(0.5);
  ally.takeDamage({ amount: 10, zone: 'torso', attacker: 'player', distance: 8 });
  const s2 = g.score.score;
  ally.takeDamage({ amount: 999, zone: 'torso', attacker: 'player', distance: 8 });
  return { labels: kill && kill.labels, gain: s1 - s0, hitPenalty: s2 - s1, warnings: g.penalty.warnings, lock: g.score.comboLockT };
});
check('위장 적 사전 식별 + 근거 있는 판단', score.labels && score.labels.includes('위장 적 식별') && score.labels.includes('근거 있는 판단'), JSON.stringify(score.labels));
check('아군 피격 −200', score.hitPenalty === -200, String(score.hitPenalty));
check('아군 사살 → 경고 1 + 콤보 잠금', score.warnings === 1 && score.lock > 9);

console.log('· 관찰 사실 (장비 단서는 진짜에게 없음)');
const facts = await page.evaluate(() => {
  const g = window.__game;
  const real = g.debugSpawn('ally', { size: 1, distRange: [6, 14] });
  const fake = g.debugSpawn('disguised', { as: 'civilian', skill: 0, distRange: [6, 14] });
  window.step(0.5);
  const anom = (n) => n.observationFacts().filter((f) => f.kind === 'gear' && f.anomalous).length;
  return { real: anom(real), fake: anom(fake) };
});
check('진짜 아군 이상 장비 사실 0개', facts.real === 0);
check('숙련 0 위장 민간인 이상 장비 사실 2개 이상', facts.fake >= 2, String(facts.fake));

console.log('· 난이도 프리셋 반영');
const diff = await page.evaluate(() => {
  const g = window.__game;
  g.settings.difficulty = 'hard';
  g.difficulty.set('hard', 'survival');
  const e = g.debugSpawn('enemy', { distRange: [15, 30] });
  const hardAcc = e.accMul;
  g.difficulty.set('easy', 'survival');
  const e2 = g.debugSpawn('enemy', { distRange: [15, 30] });
  const easyAcc = e2.accMul;
  const card = g.difficulty.cardAllowed;
  g.difficulty.set('normal', 'survival');
  g.settings.difficulty = 'normal';
  return { hardAcc, easyAcc, card };
});
check('어려움 적 명중률 > 쉬움', diff.hardAcc > diff.easyAcc, JSON.stringify(diff));
await close();
finish(errors);
