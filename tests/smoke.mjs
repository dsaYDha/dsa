// 스모크 테스트: 시작 → 자동 플레이(봇) → 게임 오버 → 결과 화면 → 재시작(완전 초기화) → 5분 작전 완수 → 설정·키 설정 → 터치 기기 안내
// 사용: node tests/smoke.mjs   (THREE_DIR=... 로 오프라인 three 사본 지정 가능 — tests/lib.mjs)
import path from 'node:path';
import { openGame, OUT, STEP, check, finish } from './lib.mjs';

const { page, errors, close } = await openGame('?nolock&gfx=medium');
console.log('· 시작 화면');
await page.screenshot({ path: path.join(OUT, 'start.png') });
check('버전 표시 v1.0', (await page.textContent('#version')) === 'v1.0');
await page.click('#mode-seg button[data-v="survival"]');
await page.click('#diff-seg button[data-v="normal"]');
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state === 'playing');

console.log('· 자동 플레이 (빨간 표식만 쏘는 봇, 90초)');
const play = await page.evaluate(`(() => {
  const step = ${STEP};
  const g = window.__game;
  const V = g.camera.position.constructor;
  const tmp = new V();
  let t = 0, target = null, react = 0, scan = 0;
  while (t < 90 && g.state === 'playing') {
    scan -= 1 / 30;
    if (scan <= 0) {
      scan = 0.1;
      let best = null, bd = 1e9;
      for (const n of g.npcs.list) {
        if (!n.alive || n.apparentFaction !== 'enemy') continue;
        n.getChestPosition(tmp);
        if (!g.world.hasLineOfSight(g.camera.position, tmp)) continue;
        const d = tmp.distanceTo(g.camera.position);
        if (d < bd) { bd = d; best = n; }
      }
      if (best !== target) { target = best; react = 0.4; }
    }
    react -= 1 / 30;
    if (target && target.alive) {
      target.getChestPosition(tmp);
      const c = g.camera.position;
      g.player.yaw = Math.atan2(-(tmp.x - c.x), -(tmp.z - c.z));
      g.player.pitch = Math.atan2(tmp.y - c.y, Math.hypot(tmp.x - c.x, tmp.z - c.z));
      g.input.mouseDown[0] = react <= 0;
    } else g.input.mouseDown[0] = false;
    if (g.weapon.ammo === 0) g.input.pressed.add('KeyR');
    step(1 / 30);
    t += 1 / 30;
  }
  g.input.mouseDown[0] = false;
  g._render();
  return { t: Math.round(g.runTime), kills: g.score.kills, score: g.score.score, state: g.state, threat: g.director.threat, curve: g.director.curve.name, npcs: g.npcs.list.length };
})()`);
console.log('  ', JSON.stringify(play));
check('적을 사살함', play.kills > 0, `사살 ${play.kills}`);
check('위협 단계 상승 (1분 경과)', play.threat >= 2 || play.state !== 'playing', `단계 ${play.threat}, 곡선 ${play.curve}`);
await page.screenshot({ path: path.join(OUT, 'play.png') });

console.log('· 게임 오버 → 결과 화면');
await page.evaluate(`(() => {
  const step = ${STEP};
  const g = window.__game;
  if (g.state === 'playing') g.player.takeDamage(999, g.player.position.clone(), null);
  step(5);
})()`);
await page.waitForFunction(() => window.__game.state === 'result', null, { timeout: 20000 });
const res = await page.evaluate(() => {
  const r = window.__game.lastResult;
  return {
    grade: r.grade, title: r.title, gradeScore: r.gradeScore, judgment: r.judgmentAccuracy, moments: r.moments.length,
    svg: !!document.querySelector('#result-timeline svg polyline'), recentRows: document.querySelectorAll('#result-recent tbody tr').length,
    combatRows: document.querySelectorAll('#result-combat .row').length, judgRows: document.querySelectorAll('#result-judgment .row').length,
  };
});
console.log('  ', JSON.stringify(res));
check('등급 S~D', /^[SABCD]$/.test(res.grade), res.grade);
check('칭호', !!res.title, res.title);
check('전투·판단 통계', res.combatRows >= 6 && res.judgRows >= 6);
check('타임라인 그래프', res.svg);
check('최근 기록 표', res.recentRows >= 1);
await page.screenshot({ path: path.join(OUT, 'result.png') });

console.log('· 다시 시작 → 완전 초기화');
await page.click('#btn-restart');
await page.waitForFunction(() => window.__game.state === 'playing');
const reset = await page.evaluate(() => {
  const g = window.__game;
  return {
    score: g.score.score, kills: g.score.kills, combo: g.score.combo, chain: g.score.chain, lock: g.score.comboLockT, warnings: g.penalty.warnings,
    threat: g.director.threat, elapsed: g.director.elapsed, credits: Object.values(g.director.credits).reduce((a, b) => a + b, 0), pending: g.director.pending.length,
    cs: g.countersign.rotations, base: g.countersign.indoorBase > 0, runTime: g.runTime, npcs: g.npcs.list.filter((n) => !n.initial).length,
    events: g.recorder.events.length, hp: g.player.health, obs: g.observation.factsFound, talks: g.dialogue.stats.talks, ammo: g.weapon.ammo, shots: g.weapon.shotsFired,
    radioMute: g.voice.muteRemaining('radio'), flashlight: g.player.flashlightOn,
  };
});
console.log('  ', JSON.stringify(reset));
check('점수·사살·콤보·경고 0', reset.score === 0 && reset.kills === 0 && reset.combo === 1 && reset.chain === 0 && reset.lock === 0 && reset.warnings === 0);
check('디렉터·암구호·타이머 초기화', reset.threat === 1 && reset.elapsed === 0 && reset.credits === 0 && reset.cs === 0 && reset.base && reset.runTime === 0);
check('기록·관찰·문답·체력·탄약 초기화', reset.events === 0 && reset.hp === 100 && reset.obs === 0 && reset.talks === 0 && reset.ammo === 30 && reset.shots === 0 && reset.radioMute === 0);

console.log('· 5분 작전 (무적, 끝까지)');
const timed = await page.evaluate(`(() => {
  const step = ${STEP};
  const g = window.__game;
  g.state = 'result';
  g.settings.mode = 'timed';
  g.restart();
  g.player.takeDamage = function () {};
  g.penalty.warnings = -99;
  step(301);
  step(4);
  return { state: g.state, reason: g.lastResult && g.lastResult.reason, mode: g.lastResult && g.lastResult.mode, threat: g.lastResult && g.lastResult.threat };
})()`);
console.log('  ', JSON.stringify(timed));
check('5분 작전 → 작전 완료 결과', timed.state === 'result' && timed.reason === 'complete' && timed.mode === 'timed', `마지막 위협 단계 ${timed.threat}`);

console.log('· 예외 상황: 대화·관찰 중 포인터 고정 해제(일시정지), 탭 숨김, 창 크기 변경');
const edge = await page.evaluate(`(async () => {
  const step = ${STEP};
  const g = window.__game;
  g.state = 'result';
  g.settings.mode = 'survival';
  g.restart();
  g.player.takeDamage = function () {};
  step(1);
  const civ = g.debugSpawn('civilian', { distRange: [5, 12] });
  step(0.5);
  const d = g.dialogue;
  d.target = civ; d.lastTarget = civ; d.reaction = 'stop'; d.busyT = 0; d.idleT = 4;
  g.input.down.add('KeyQ');
  step(0.3);
  const obsBefore = g.observation.active;
  g.pause('test');                       // 포인터 고정이 풀린 것과 같은 경로
  const paused = g.state === 'paused';
  g.resume();
  step(0.5);
  const obsAfter = g.observation.active;  // 키 입력이 지워져 관찰이 풀려야 함
  const weaponDown = g.observation.weaponDown;
  step(0.5);
  Object.defineProperty(document, 'hidden', { value: true, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  const hiddenPaused = g.state === 'paused';
  Object.defineProperty(document, 'hidden', { value: false, configurable: true });
  g.resume();
  return { obsBefore, paused, obsAfter, weaponDown, hiddenPaused, dialogueOpen: !!d.target };
})()`);
console.log('  ', JSON.stringify(edge));
check('관찰 중 일시정지 → 복귀하면 관찰 해제', edge.obsBefore && edge.paused && !edge.obsAfter);
check('탭 숨김 → 자동 일시정지', edge.hiddenPaused);
await page.setViewportSize({ width: 900, height: 600 });
await page.waitForFunction(() => Math.abs(window.__game.camera.aspect - 1.5) < 0.01, null, { timeout: 15000 }).catch(() => {});
const rs = await page.evaluate(() => {
  const g = window.__game;
  g._updatePlaying(1 / 60);
  g._render();
  const t = g.post.target;
  const V2 = g.post.uniforms.uTexel.value.constructor; // THREE.Vector2
  const v = g.renderer.getDrawingBufferSize(new V2());
  return { aspect: +g.camera.aspect.toFixed(3), rt: t ? [t.width, t.height] : null, buf: [v.x, v.y] };
});
check('창 크기 변경 → 카메라·후처리 버퍼 갱신', Math.abs(rs.aspect - 1.5) < 0.01 && (!rs.rt || (rs.rt[0] === rs.buf[0] && rs.rt[1] === rs.buf[1])), JSON.stringify(rs));
await page.setViewportSize({ width: 1280, height: 720 });

console.log('· 설정 화면 (그래픽 프리셋·키 설정·색각 보조)');
await page.evaluate(() => {
  const g = window.__game;
  g.settings.mode = 'survival';
  g.toMenu();
});
await page.click('#btn-open-settings');
await page.click('#gfx-seg button[data-v="low"]');
const low = await page.evaluate(() => ({ key: window.__game.gfxKey, post: window.__game.post.enabled, shadow: window.__game.world.atmosphere.sun.castShadow }));
check('그래픽 낮음 적용 (후처리·그림자 끔)', low.key === 'low' && !low.post && !low.shadow, JSON.stringify(low));
await page.click('#gfx-seg button[data-v="high"]');
const high = await page.evaluate(() => ({ key: window.__game.gfxKey, post: window.__game.post.enabled, aa: window.__game.post.aa }));
check('그래픽 높음 적용 (MSAA)', high.key === 'high' && high.post && high.aa === 'msaa', JSON.stringify(high));
await page.click('.key-btn[data-a="reload"]');
await page.keyboard.press('KeyT');
const keys = await page.evaluate(() => ({ reload: window.__game.settings.keys.reload, stored: JSON.parse(localStorage.getItem('piasik.settings.v1')).keys.reload }));
check('키 바꾸기 (재장전 → T, 저장)', keys.reload[0] === 'KeyT' && keys.stored[0] === 'KeyT');
await page.click('#btn-keys-reset');
await page.check('#set-colorblind');
await page.screenshot({ path: path.join(OUT, 'settings.png') });
const cb = await page.evaluate(() => window.__game.settings.colorblind);
check('색각 보조 무늬 설정 저장', cb === true);
await page.uncheck('#set-colorblind');
await page.click('#btn-settings-back');
check('설정 → 시작 화면으로', (await page.evaluate(() => window.__game.menus.current)) === 'start');
const errs = errors.slice();
await close();

console.log('· 첫 실행 그래픽 자동 추천 (메뉴 화면 FPS 측정)');
const a = await openGame('?nolock');
await a.page.waitForFunction(() => window.__game.settings.graphicsMeasured != null, null, { timeout: 30000 }).catch(() => {});
const auto = await a.page.evaluate(() => ({ key: window.__game.gfxKey, fps: window.__game.settings.graphicsMeasured, note: document.getElementById('gfx-auto-note').textContent }));
check('자동 추천 프리셋 적용·저장', auto.fps != null && ['low', 'medium', 'high'].includes(auto.key) && auto.note.length > 0, JSON.stringify(auto));
errs.push(...a.errors);
await a.close();

console.log('· 터치 기기 안내');
const t = await openGame('?nolock&gfx=low', { touch: true, viewport: { width: 390, height: 844 } });
const touch = await t.page.evaluate(() => !document.getElementById('touch-notice').classList.contains('hidden'));
check('"PC 키보드·마우스가 필요합니다" 표시', touch);
await t.page.screenshot({ path: path.join(OUT, 'touch.png') });
errs.push(...t.errors);
await t.close();
finish(errs);
