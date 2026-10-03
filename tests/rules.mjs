// 규칙 테스트: 강제 생성(진짜 아군·민간인 / 위장 적 숙련도 0·1·2)으로 문답·관찰·점수·페널티·난이도 곡선 규칙 확인
// v1.1: 엄폐 규칙(유효한 엄폐에서만 웅크림·측면을 잡히면 자리를 옮김), 적 조준(배율·수렴), 무기(허리 연사 vs 정조준 단발·클릭 한 번 = 한 발),
//       아군 사선 피하기(웅크리지 않고 비킴), 쉬움 = 변화 폭 절반
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

// ---------------------------------------------------------------------
// v1.1
// ---------------------------------------------------------------------
console.log('· v1.1 엄폐 규칙: 전투 NPC 는 유효한 엄폐에서만 웅크린다');
const cover = await page.evaluate(() => {
  const g = window.__game;
  g.npcs.clear();
  g.director.elapsed = 200;
  const V = g.camera.position.constructor;
  const a = new V();
  const b = new V();
  const eye = new V();
  const nodes = g.world.nav.nodes.filter((n) => !n.removed && !n.indoor && (n.type === 'street' || n.type === 'yard'));
  const st = { samples: 0, crouched: 0, invalidFlag: 0, exposedRay: 0, peeks: 0, validCrouch: 0 };
  let moveT = 0;
  for (let t = 0; t < 75; t += 0.25) {
    // 12초마다 플레이어가 다른 자리로 (측면 우회 상황)
    moveT -= 0.25;
    if (moveT <= 0) {
      moveT = 12;
      const f = g.player.feet;
      const near = nodes.filter((n) => { const d = Math.hypot(n.x - f.x, n.z - f.z); return d > 8 && d < 26; });
      const n = near[Math.floor(Math.random() * near.length)];
      if (n) g.debugTeleport(n.x, n.y + 0.05, n.z, g.player.yaw);
    }
    window.step(0.25);
    for (const n of g.npcs.list) {
      if (!n.alive || n.disguised || !n.coverEval) continue;
      st.samples++;
      if (n.coverPhase === 'peek' && n.inCoverSpot) st.peeks++;
      if (!(n.crouch > 0.55 && n.crouchTarget > 0.5)) continue;
      st.crouched++;
      if (!n.coverOK) st.invalidFlag++;
      else st.validCrouch++;
      // 독립 레이 판정: 위협의 눈(적 → 선 플레이어 눈, 아군 → 가장 가까운 빨간 표식)에서 웅크린 머리·몸통이 가려지는지
      if (n.threatEye(eye)) {
        a.set(n.position.x, n.position.y + 1.05, n.position.z);
        b.set(n.position.x, n.position.y + 0.72, n.position.z);
        if (g.world.hasLineOfSight(eye, a) || g.world.hasLineOfSight(eye, b)) st.exposedRay++;
      }
    }
  }
  return st;
});
check('웅크린 전투 NPC 가 모두 유효한 엄폐 판정', cover.crouched > 0 && cover.invalidFlag === 0, JSON.stringify(cover));
check('독립 레이 판정으로도 웅크린 몸이 위협에게 가려짐 (전환 순간 2% 이하)', cover.exposedRay <= Math.max(1, cover.crouched * 0.02), `${cover.exposedRay}/${cover.crouched}`);
check('엄폐에서 내밀어 쏘는 교전이 일어남', cover.peeks > 0, String(cover.peeks));

const flank = await page.evaluate(() => {
  const g = window.__game;
  g.npcs.clear();
  g.director.update = function () {};
  const V = g.camera.position.constructor;
  const e = new V();
  // 플레이어 기준 유효한 엄폐 노드 하나를 찾아 그 자리에 적을 둠 → 반대편(측면)으로 플레이어를 옮김
  const nav = g.world.nav;
  const covers = nav.nodes.filter((n) => !n.removed && n.type === 'cover' && n.coverDir && Math.abs(n.x) < 50 && Math.abs(n.z) < 50);
  for (const c of covers) {
    const px = c.x + c.coverDir.x * 16;
    const pz = c.z + c.coverDir.z * 16;
    const pn = nav.nearest(px, 0, pz, (n) => !n.indoor, 6);
    if (!pn) continue;
    e.set(pn.x, pn.y + 1.65, pn.z);
    if (!g.npcs.coverCheck(c.x, c.y, c.z, e).valid) continue;
    // 반대편: 엄폐물 뒤쪽 12m
    const qn = nav.nearest(c.x - c.coverDir.x * 12, 0, c.z - c.coverDir.z * 12, (n) => !n.indoor, 6);
    if (!qn) continue;
    e.set(qn.x, qn.y + 1.65, qn.z);
    if (g.npcs.coverCheck(c.x, c.y, c.z, e).protected) continue;
    g.debugTeleport(pn.x, pn.y + 0.05, pn.z);
    const npc = g.debugSpawn('enemy', { type: 'rifleman', at: { x: c.x, y: c.y, z: c.z } });
    npc.placeAt(c.x, c.y, c.z, 0);
    npc.navNode = c.id;
    npc._releaseCover();
    npc.coverNode = c;
    c.reservedBy = npc;
    npc._enterCoverSpot(c.x, c.y, c.z);
    npc.coverPhase = 'hide';
    npc.phaseT = 5;
    npc.spawnTime -= 10;
    npc._setState('cover', '테스트: 엄폐');
    window.step(1.0);
    const before = { crouchT: +npc.crouchTarget.toFixed(2), ok: npc.coverOK, state: npc.state };
    g.debugTeleport(qn.x, qn.y + 0.05, qn.z);
    let maxCrouchExposed = 0;
    let left = false;
    for (let t = 0; t < 2.5; t += 1 / 30) {
      window.step(1 / 30);
      if (!npc.coverOK && npc.crouchTarget > 0.3) maxCrouchExposed++;
      if (npc.state !== 'cover') left = true;
    }
    return { found: true, before, maxCrouchExposed, left, state: npc.state, reason: npc.stateReason };
  }
  return { found: false };
});
check('측면을 잡히면 웅크리지 않고 엄폐를 떠남', flank.found && flank.before.ok && flank.maxCrouchExposed === 0 && flank.left, JSON.stringify(flank));

console.log('· v1.1 적 조준: 배율·수렴 (아군은 그대로)');
const aim = await page.evaluate(() => {
  const g = window.__game;
  g.npcs.clear();
  const e = g.debugSpawn('enemy', { type: 'rifleman', distRange: [12, 25] });
  const sq = g.debugSpawn('ally', { size: 1, distRange: [6, 14] });
  const ally = sq && sq.alive !== undefined ? sq : g.npcs.byFaction('ally')[0];
  e.target = 'player';
  e.aware = true;
  e.hasLOS = true;
  e.convTarget = null;
  const c0 = e._convFactor();
  e._updateConvergence(0.1);
  for (let i = 0; i < 40; i++) e._updateConvergence(0.1);
  const cMax = e._convFactor();
  g.player.speed = 4.3; // 움직이면 초기화
  e._updateConvergence(0.1);
  const cMove = e._convFactor();
  g.player.speed = 0;
  return { aimMul: e.aimMul, c0: +c0.toFixed(3), cMax: +cMax.toFixed(3), cMove: +cMove.toFixed(3), allyAcc: ally ? ally.tcfg.accuracy : null, allyAimMul: ally ? ally.aimMul : null };
});
check('적 명중률 전체 배율 = npc.aim.enemyMul', Math.abs(aim.aimMul - 1.4) < 1e-6, String(aim.aimMul));
check('가만히 있으면 조준 수렴 (start → max), 움직이면 초기화', aim.cMax > aim.c0 + 0.3 && Math.abs(aim.cMove - aim.c0) < 1e-6, JSON.stringify(aim));
check('아군 명중률은 그대로 (0.12, 적 조준 배율 없음)', aim.allyAcc === 0.12 && aim.allyAimMul == null, JSON.stringify(aim));

console.log('· v1.1 무기: 허리 연사는 흩어지고 정조준 단발은 정확 · 클릭 한 번 = 한 발');
const gun = await page.evaluate(() => {
  const g = window.__game;
  const V = g.camera.position.constructor;
  const tmp = new V();
  const nav = g.world.nav;
  const outdoor = nav.nodes.filter((n) => !n.removed && !n.indoor && n.y < 0.5 && (n.type === 'street' || n.type === 'yard'));
  let pair = null;
  for (let i = 0; i < outdoor.length && !pair; i += 5) {
    const a = outdoor[i];
    for (const b of outdoor) {
      if (Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - 20) > 1) continue;
      if (g.world.hasLineOfSight(new V(a.x, a.y + 1.65, a.z), new V(b.x, b.y + 1.25, b.z)) && g.world.hasLineOfSight(new V(a.x, a.y + 1.65, a.z), new V(b.x, b.y + 0.5, b.z))) { pair = [a, b]; break; }
    }
  }
  if (!pair) return null;
  const [a, b] = pair;
  const run = (ads, burst, pause, rounds) => {
    g.npcs.clear();
    g.input.clear();
    g.weapon.reset();
    g.debugTeleport(a.x, a.y + 0.05, a.z);
    const npc = g.debugSpawn('enemy', { type: 'rifleman', at: { x: b.x, y: b.y, z: b.z } });
    npc.placeAt(b.x, b.y, b.z, 0);
    npc.think = function () { this.crouchTarget = 0; this.aimTarget = 0; this.curSpeed = 0; };
    let hits = 0;
    npc.takeDamage = () => { hits++; };
    const aimAt = () => {
      npc.getChestPosition(tmp);
      const cam = g.camera.position;
      g.player.yaw = Math.atan2(-(tmp.x - cam.x), -(tmp.z - cam.z)) - g.player.recoilYaw * 0.2;
      g.player.pitch = Math.atan2(tmp.y - cam.y, Math.hypot(tmp.x - cam.x, tmp.z - cam.z)) - g.player.recoilPitch * 0.6;
    };
    g.input.mouseDown[2] = ads;
    for (let t = 0; t < 0.5; t += 1 / 60) { aimAt(); g._updatePlaying(1 / 60); g.input.endFrame(); }
    const s0 = g.weapon.shotsFired;
    let bs = s0;
    let pt = 0;
    let fire = true;
    while (g.weapon.shotsFired - s0 < rounds) {
      aimAt();
      if (fire && g.weapon.shotsFired - bs >= burst) { fire = false; pt = pause; }
      if (!fire) { pt -= 1 / 60; if (pt <= 0) { fire = true; bs = g.weapon.shotsFired; } }
      g.input.mouseDown[0] = fire;
      g._updatePlaying(1 / 60);
      g.input.endFrame();
      if (g.weapon.ammo === 0) g.weapon.ammo = 30;
    }
    g.input.clear();
    return hits / rounds;
  };
  const hip = (run(false, 20, 0, 20) + run(false, 20, 0, 20)) / 2;
  const tap = (run(true, 1, 0.25, 12) + run(true, 1, 0.25, 12)) / 2;
  // 클릭 한 번 (한 프레임만 누름) → 한 발
  g.input.clear();
  g.weapon.reset();
  for (let i = 0; i < 30; i++) { g._updatePlaying(1 / 60); g.input.endFrame(); }
  const f0 = g.weapon.shotsFired;
  g.input.mouseDown[0] = true;
  g._updatePlaying(1 / 60);
  g.input.endFrame();
  g.input.mouseDown[0] = false;
  for (let i = 0; i < 10; i++) { g._updatePlaying(1 / 60); g.input.endFrame(); }
  return { hip: +hip.toFixed(2), tap: +tap.toFixed(2), click: g.weapon.shotsFired - f0 };
});
check('20m: 허리 연사 명중률 ≤ 35%', gun && gun.hip <= 0.35, JSON.stringify(gun));
check('20m: 정조준 단발 명중률 ≥ 80%', gun && gun.tap >= 0.8, JSON.stringify(gun));
check('클릭 한 번 = 한 발 (예전엔 쉬다 쏘면 두 발)', gun && gun.click === 1, JSON.stringify(gun));

console.log('· v1.1 아군 사선 피하기: 웅크리지 않고 비킴');
const line = await page.evaluate(() => {
  const g = window.__game;
  g.npcs.clear();
  const nav = g.world.nav;
  const f = g.player.feet;
  const yaw = g.player.yaw;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  const n = nav.nearest(f.x + fx * 8, f.y, f.z + fz * 8, (q) => !q.indoor, 6);
  if (!n) return null;
  const ally = g.debugSpawn('ally', { size: 1, at: { x: n.x, y: n.y, z: n.z } });
  const a = g.npcs.byFaction('ally')[0];
  window.step(0.8);
  // 플레이어가 아군 가슴을 정확히 겨누고 쏘는 중
  const V = g.camera.position.constructor;
  const c = new V();
  let maxCrouch = 0;
  let lat = 0;
  for (let t = 0; t < 2.5; t += 1 / 30) {
    a.getChestPosition(c);
    if (t < 0.05) {
      const cam = g.camera.position;
      g.player.yaw = Math.atan2(-(c.x - cam.x), -(c.z - cam.z));
      g.player.pitch = Math.atan2(c.y - cam.y, Math.hypot(c.x - cam.x, c.z - cam.z));
    }
    g.weapon.timeSinceShot = 0; // 쏘는 중으로 취급 (실제로 쏘지는 않음)
    window.step(1 / 30);
    maxCrouch = Math.max(maxCrouch, a.crouchTarget);
  }
  const cam = g.camera.position;
  const d = new V();
  g.camera.getWorldDirection(d);
  a.getChestPosition(c);
  const v = c.clone().sub(cam);
  const t = v.dot(d);
  lat = v.addScaledVector(d, -t).length();
  return { maxCrouch: +maxCrouch.toFixed(2), lateral: +lat.toFixed(2), reason: a.stateReason, ok: !!ally };
});
check('사선 위 아군: 웅크리지 않음 + 조준선에서 비켜남', line && line.maxCrouch <= 0.3 && line.lateral > 0.8, JSON.stringify(line));

console.log('· v1.1 쉬움 = 변화 폭 절반');
const easy = await page.evaluate(() => {
  const g = window.__game;
  g.difficulty.set('easy', 'survival');
  const e = g.debugSpawn('enemy', { distRange: [15, 30] });
  const easyAim = e.aimMul;
  g.weapon.reset();
  g.input.clear();
  const sEasy = g.weapon.currentSpread(g.player);
  g.difficulty.set('normal', 'survival');
  const sNormal = g.weapon.currentSpread(g.player);
  return { easyAim, sEasy: +sEasy.toFixed(2), sNormal: +sNormal.toFixed(2) };
});
check('쉬움: 적 조준 배율 1.2 (보통 1.4 의 절반 폭) · 허리 퍼짐 작음', Math.abs(easy.easyAim - 1.2) < 1e-6 && easy.sEasy < easy.sNormal, JSON.stringify(easy));
await close();
finish(errors);
