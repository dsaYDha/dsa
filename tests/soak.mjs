// 장시간 점검: 시뮬레이션 N분(기본 20) 플레이 + 재시작 M회(기본 10) 뒤 메모리·GPU 자원이 늘지 않는지
// (힙: 강제 GC 뒤 usedJSHeapSize / three: geometries·textures·programs / 씬 자식 수 / DOM 노드 수)
// 사용: node tests/soak.mjs [분=20] [재시작=10]
import { openGame, check, finish } from './lib.mjs';

const MIN = Number(process.argv[2] || 20);
const RESTARTS = Number(process.argv[3] || 10);
const { page, errors, close } = await openGame('?nolock&gfx=low', { gc: true });
await page.click('#btn-start');
await page.waitForFunction(() => window.__game.state === 'playing');

const snap = (label) => page.evaluate(async (label) => {
  const g = window.__game;
  for (let i = 0; i < 2; i++) {
    if (window.gc) window.gc();
    await new Promise((r) => setTimeout(r, 30));
  }
  const m = g.renderer.info.memory;
  // 갱신 CPU 시간 (렌더 제외, 60프레임 평균) — 오래 해도 느려지지 않는지
  let ms = null;
  if (g.state === 'playing') {
    const t0 = performance.now();
    for (let i = 0; i < 60; i++) {
      g._updatePlaying(1 / 60);
      g.input.endFrame();
    }
    ms = +((performance.now() - t0) / 60).toFixed(2);
  }
  return { label, heapMB: +(performance.memory.usedJSHeapSize / 1048576).toFixed(1), geos: m.geometries, tex: m.textures, progs: g.renderer.info.programs.length, npcs: g.npcs.list.length, updMs: ms, scene: g.scene.children.length, dom: document.getElementsByTagName('*').length };
}, label);

const rows = [await snap('시작')];
for (let c = 0; c < MIN; c++) {
  await page.evaluate(() => {
    const g = window.__game;
    g.player.takeDamage = function () {};
    g.penalty.warnings = 0;
    const dt = 1 / 30;
    for (let t = 0; t < 60; t += dt) {
      if (Math.floor(t / 10) !== Math.floor((t + dt) / 10)) {
        const k = Math.floor((g.runTime / 10) % 4);
        if (k === 0) g.debugSpawn('civilian', { distRange: [10, 40] });
        else if (k === 1) g.debugSpawn('disguised', { as: Math.random() < 0.5 ? 'ally' : 'civilian', distRange: [10, 40] });
        else if (k === 2) g.debugSpawn('ally', { size: 2, distRange: [10, 40] });
        else g.debugSpawn('enemy', { distRange: [12, 40] });
        const live = g.npcs.list.filter((n) => n.alive);
        if (live.length > 34) for (const n of live.slice(0, live.length - 34)) n.takeDamage({ amount: 999, zone: 'torso', attacker: 'test' });
      }
      if (g.state === 'playing') g._updatePlaying(dt);
      g.input.endFrame();
    }
    for (let i = 0; i < 4; i++) {
      g.player.yaw += Math.PI / 2;
      g._render();
    }
  });
  if ((c + 1) % 5 === 0 || c === MIN - 1) rows.push(await snap(`플레이 ${c + 1}분`));
}
for (let i = 0; i < RESTARTS; i++) {
  await page.evaluate(() => {
    const g = window.__game;
    g.player.takeDamage = Object.getPrototypeOf(g.player).takeDamage.bind(g.player);
    g.player.takeDamage(999, g.player.position.clone(), null);
    for (let k = 0; k < 150 && g.state !== 'result'; k++) {
      g._updateDead(1 / 30);
      g.input.endFrame();
    }
    g.restart();
    for (let k = 0; k < 30 * 25; k++) {
      g._updatePlaying(1 / 30);
      g.input.endFrame();
    }
    g._render();
  });
  if ((i + 1) % 5 === 0 || i === RESTARTS - 1) rows.push(await snap(`재시작 ${i + 1}회`));
}
console.table(rows);
const first = rows[1];
const last = rows[rows.length - 1];
check('GPU 텍스처 수가 늘지 않음 (뼈 텍스처 해제)', last.tex <= first.tex + 4, `${first.tex} → ${last.tex}`);
check('지오메트리 수가 늘지 않음 (스킨 캐시 정리)', last.geos <= first.geos + 30, `${first.geos} → ${last.geos}`);
check('셰이더 프로그램 수 일정', last.progs <= first.progs + 2, `${first.progs} → ${last.progs}`);
check('JS 힙 증가 10MB 이하', last.heapMB - first.heapMB < 10, `${first.heapMB} → ${last.heapMB} MB`);
await close();
finish(errors);
