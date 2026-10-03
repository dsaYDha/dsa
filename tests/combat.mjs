// v1.1 전투 측정 (밸런스 조정용 — 통과/실패 없이 수치만): CLAUDE.md "v1.1 측정 (전·후)" 표를 다시 재는 도구
//   audit  — 엄폐 감사: 실제 디렉터 + 무적 봇(보이는 빨간 표식을 정조준 3발 점사, 12초마다 다른 실외 지점으로 순간이동 = 측면 우회 상황)
//            0.25초마다 웅크린 전투 NPC(적·아군·정체를 드러낸 위장 적)를 위협 눈에서 웅크린 머리(1.05m)·몸통(0.72m)으로 레이 판정
//            ① 그 NPC 자신의 위협(npc.threatEye — 규칙의 정의) ② 적은 플레이어 기준(더 엄격 — 아군과 싸우는 적은 플레이어를 모를 수 있음)
//   stance — 자세별 적 치명도: 디렉터 정지, 소총수 3명을 정면 18~30m 에 생성하고 35초 (플레이어는 쏘지 않음, 피해는 기록만)
//            가만히 서 있음 / 뚫린 곳에서 웅크림 / 좌우로 움직임 / 엄폐물 뒤 웅크림 — 체력 100 + 5초 뒤 초당 16 회복으로 '35초 안 전사' 계산
//   gun    — 플레이어 사격 방식별 명중률: 서 있는 표적(무적), 사람 같은 조준 흔들림(허리 0.35° / 정조준 0.15°) + 반동 보정(세로 60%·가로 20%)
// 사용: node tests/combat.mjs [audit|stance|gun|all=all] [위협=3] [반복=8]   (THREE_DIR·PLAYWRIGHT_PATH 는 tests/lib.mjs 참고)
// 수치는 무작위(Math.random) 영향을 받는다 — 여러 번 돌려 범위로 본다
import { openGame } from './lib.mjs';

const WHAT = process.argv[2] || 'all';
const THREAT = Number(process.argv[3] || 3);
const REPS = Number(process.argv[4] || 8);
const run = (k) => WHAT === 'all' || WHAT === k;

async function start(query) {
  const g = await openGame(query);
  await g.page.click('#btn-start');
  await g.page.waitForFunction(() => window.__game.state === 'playing');
  return g;
}

// ---------------------------------------------------------------------
if (run('audit')) {
  const { page, errors, close } = await start('?nolock&gfx=low&seed=PIASIK-1');
  const r = await page.evaluate(async (MIN) => {
    const g = window.__game;
    g.player.takeDamage = function () {};
    const V = g.camera.position.constructor;
    const tmp = new V();
    const eyeA = new V();
    const eyeB = new V();
    const a = new V();
    const b = new V();
    const dt = 1 / 30;
    const nodes = g.world.nav.nodes.filter((n) => !n.removed && !n.indoor && (n.type === 'street' || n.type === 'yard' || n.type === 'alley'));
    const mk = () => ({ exposed: 0, episodes: 0, longest: 0, run: new Map() });
    const own = mk();
    const strict = mk();
    let crouched = 0;
    let samples = 0;
    let t = 0;
    let aimT = 0;
    let target = null;
    let reactT = 0;
    let burstT = 0;
    let fireState = 'idle';
    let burstStart = 0;
    let moveT = 12;
    let sampleT = 0;
    const covered = (n, eye) => {
      a.set(n.position.x, n.position.y + 1.05, n.position.z);
      b.set(n.position.x, n.position.y + 0.72, n.position.z);
      return !g.world.hasLineOfSight(eye, a) && !g.world.hasLineOfSight(eye, b);
    };
    const note = (st, n, ok) => {
      if (ok) {
        st.run.delete(n);
        return;
      }
      st.exposed++;
      const r0 = (st.run.get(n) || 0) + 0.25;
      st.run.set(n, r0);
      if (r0 === 1.0) st.episodes++;
      st.longest = Math.max(st.longest, r0);
    };
    while (t < MIN * 60 && g.state === 'playing') {
      aimT -= dt;
      if (aimT <= 0) {
        aimT = 0.1;
        let best = null;
        let bd = 1e9;
        for (const n of g.npcs.list) {
          if (!n.alive || n.apparentFaction !== 'enemy') continue;
          n.getChestPosition(tmp);
          if (!g.world.hasLineOfSight(g.camera.position, tmp)) continue;
          const d = tmp.distanceTo(g.camera.position);
          if (d < bd) {
            bd = d;
            best = n;
          }
        }
        if (best !== target) {
          target = best;
          reactT = 0.45;
        }
      }
      reactT -= dt;
      burstT -= dt;
      g.input.mouseDown[2] = !!target;
      if (target && target.alive) {
        target.getChestPosition(tmp);
        const cam = g.camera.position;
        g.player.yaw = Math.atan2(-(tmp.x - cam.x), -(tmp.z - cam.z));
        g.player.pitch = Math.atan2(tmp.y - cam.y, Math.hypot(tmp.x - cam.x, tmp.z - cam.z)) - g.player.recoilPitch * 0.5;
        if (fireState === 'idle' && reactT <= 0 && g.weapon.adsT > 0.8 && burstT <= 0) {
          fireState = 'burst';
          burstStart = g.weapon.shotsFired;
        }
      } else fireState = 'idle';
      if (fireState === 'burst' && g.weapon.shotsFired - burstStart >= 3) {
        fireState = 'idle';
        burstT = 0.28;
      }
      g.input.mouseDown[0] = fireState === 'burst';
      if (g.weapon.ammo === 0) g.input.pressed.add('KeyR');
      moveT -= dt;
      if (moveT <= 0) {
        moveT = 12;
        const f = g.player.feet;
        const near = nodes.filter((n) => {
          const d = Math.hypot(n.x - f.x, n.z - f.z);
          return d > 8 && d < 26;
        });
        const n = near[Math.floor(Math.random() * near.length)];
        if (n) g.debugTeleport(n.x, n.y + 0.05, n.z, g.player.yaw);
      }
      g.penalty.warnings = 0;
      g._updatePlaying(dt);
      g.input.endFrame();
      t += dt;
      sampleT -= dt;
      if (sampleT > 0) continue;
      sampleT = 0.25;
      for (const n of g.npcs.list) {
        if (!n.alive || n.disguised || (n.trueFaction !== 'enemy' && n.trueFaction !== 'ally')) continue;
        samples++;
        if (n.crouch <= 0.55) {
          own.run.delete(n);
          strict.run.delete(n);
          continue;
        }
        crouched++;
        // 그 NPC 의 위협 (v1.1 threatEye — 없는 이전 버전이면 적 = 플레이어, 아군 = 가장 가까운 빨간 표식)
        let e1 = null;
        if (n.threatEye) e1 = n.threatEye(eyeA);
        else if (n.trueFaction === 'enemy') e1 = eyeA.copy(g.player.eye);
        else {
          let bd = 60 * 60;
          for (const e of g.npcs.byApparent('enemy')) {
            const d = e.position.distanceToSquared(n.position);
            if (d < bd) {
              bd = d;
              e1 = e.getEyePosition(eyeA);
            }
          }
        }
        note(own, n, !e1 || covered(n, e1));
        const e2 = n.trueFaction === 'enemy' ? eyeB.copy(g.player.eye) : e1;
        note(strict, n, !e2 || covered(n, e2));
      }
    }
    g.input.mouseDown[0] = g.input.mouseDown[2] = false;
    const fmt = (st) => `${st.exposed} (${((st.exposed / Math.max(1, crouched)) * 100).toFixed(1)}%) · 1초 이상 ${st.episodes}회 · 최장 ${st.longest.toFixed(2)}초`;
    return { minutes: +(t / 60).toFixed(1), samples, crouched, own: fmt(own), strict: fmt(strict), prevented: g.npcs.coverStats ? g.npcs.coverStats.prevented : '-', kills: g.score.kills };
  }, 3);
  console.log(`· 엄폐 감사 (${r.minutes}분, 전투 NPC 표본 ${r.samples} · 그중 웅크림 ${r.crouched} · 봇 사살 ${r.kills})`);
  console.log(`  웅크린 채 위협에게 보임 — 그 NPC 의 위협 기준: ${r.own}`);
  console.log(`  웅크린 채 위협에게 보임 — 적은 플레이어 기준:   ${r.strict}`);
  console.log(`  무효라서 막은 웅크림 누계 ${r.prevented} · 콘솔 에러 ${errors.length}`);
  await close();
}

// ---------------------------------------------------------------------
if (run('stance')) {
  const { page, errors, close } = await start('?nolock&gfx=low&seed=PIASIK-1');
  const res = await page.evaluate(async ({ REPS, THREAT }) => {
    const g = window.__game;
    const V = g.camera.position.constructor;
    const nav = g.world.nav;
    g.director.update = function () {};
    let dmg = 0;
    let hits = 0;
    let shots = 0;
    g.player.takeDamage = function (amount) {
      dmg += amount;
      hits++;
    };
    g.events.on('weapon:fired', (e) => {
      if (!e.isPlayer && e.shooter && e.shooter.trueFaction === 'enemy' && e.shooter.target === 'player') shots++;
    });
    const outdoor = nav.nodes.filter((n) => !n.removed && !n.indoor && n.y < 0.5);
    const covers = outdoor.filter((n) => n.type === 'cover' && n.coverDir);
    const spots = outdoor
      .filter((n) => n.type === 'street' || n.type === 'yard')
      .map((n) => ({ n, c: covers.filter((c) => { const d = Math.hypot(c.x - n.x, c.z - n.z); return d > 12 && d < 32; }).length }))
      .filter((s) => s.c >= 6)
      .sort((p, q) => q.c - p.c);
    const stances = ['still', 'crouch', 'strafe', 'cover'];
    const out = {};
    for (const s of stances) out[s] = { dmg: 0, hits: 0, shots: 0, deaths: 0 };
    const E = new V();
    for (let rep = 0; rep < REPS; rep++) {
      // 엄폐 자세: 적 생성 지점 3곳 모두에 대해 웅크린 몸이 레이 판정으로 가려지는 엄폐 노드
      const cv = covers.filter((c) => Math.abs(c.x) < 50 && Math.abs(c.z) < 50);
      let coverNode = cv[(rep * 37) % cv.length];
      let coverPick = null;
      for (let k = 0; k < cv.length; k++) {
        const c = cv[(rep * 37 + k * 11) % cv.length];
        const f = Math.atan2(c.coverDir.x, c.coverDir.z);
        const cand = outdoor.filter((n) => {
          const dx = n.x - c.x;
          const dz = n.z - c.z;
          const d = Math.hypot(dx, dz);
          if (d < 18 || d > 30) return false;
          const an = Math.atan2(dx, dz) - f;
          return Math.abs(Math.atan2(Math.sin(an), Math.cos(an))) < 0.8;
        });
        // 적 눈 → 웅크린 머리(1.08m)·몸통 좌우(0.72m, ±0.2m) 세 레이가 모두 막히는 자리 (게임 코드와 무관한 판정 — 이전 버전에서도 같은 기준)
        const col = g.world.collision;
        const ok = cand.filter((n) => {
          E.set(n.x, n.y + 1.62, n.z);
          let sx = -(c.z - n.z);
          let sz = c.x - n.x;
          const sl = Math.hypot(sx, sz) || 1;
          sx /= sl;
          sz /= sl;
          return col.segmentBlocked(E, new V(c.x, c.y + 1.08, c.z)) && col.segmentBlocked(E, new V(c.x + sx * 0.2, c.y + 0.72, c.z + sz * 0.2)) && col.segmentBlocked(E, new V(c.x - sx * 0.2, c.y + 0.72, c.z - sz * 0.2));
        });
        if (ok.length >= 3) {
          coverNode = c;
          coverPick = ok;
          break;
        }
      }
      const spot = spots[(rep * 5) % Math.min(spots.length, 30)].n;
      for (const stance of stances) {
        const p = stance === 'cover' ? coverNode : spot;
        const facing = stance === 'cover' ? Math.atan2(p.coverDir.x, p.coverDir.z) : (rep * 2.39) % (Math.PI * 2);
        const cand = outdoor.filter((n) => {
          const dx = n.x - p.x;
          const dz = n.z - p.z;
          const d = Math.hypot(dx, dz);
          if (d < 18 || d > 30) return false;
          const an = Math.atan2(dx, dz) - facing;
          return Math.abs(Math.atan2(Math.sin(an), Math.cos(an))) < (stance === 'cover' ? 0.8 : 1.05);
        });
        const pool = stance === 'cover' && coverPick ? coverPick : cand;
        const at = [0, 1, 2].map((k) => (pool.length ? pool[(rep * 13 + k * Math.max(1, Math.floor(pool.length / 3))) % pool.length] : null)).filter(Boolean);
        g.npcs.clear();
        g.director.threat = THREAT;
        g.director.elapsed = (THREAT - 1) * 60 + 5;
        g.input.clear();
        g.player.crouching = false;
        g.debugTeleport(p.x, p.y + 0.05, p.z);
        g.player.yaw = Math.atan2(-Math.sin(facing), -Math.cos(facing));
        g.player.pitch = 0;
        for (const q of at) g.debugSpawn('enemy', { type: 'rifleman', at: { x: q.x, y: q.y, z: q.z } });
        dmg = 0;
        hits = 0;
        shots = 0;
        let hp = 100;
        let lastHit = -99;
        let died = false;
        let lastDmg = 0;
        const dt = 1 / 30;
        let flip = 0;
        let dir = 1;
        for (let t = 0; t < 35; t += dt) {
          if (stance === 'crouch' || stance === 'cover') g.player.crouching = true;
          if (stance === 'strafe') {
            flip -= dt;
            if (flip <= 0) {
              flip = 0.8 + ((t * 7.3) % 0.6);
              dir = -dir;
            }
            g.input.down.delete('KeyA');
            g.input.down.delete('KeyD');
            g.input.down.add(dir > 0 ? 'KeyD' : 'KeyA');
          }
          g._updatePlaying(dt);
          g.input.endFrame();
          if (dmg > lastDmg) {
            hp -= dmg - lastDmg;
            lastDmg = dmg;
            lastHit = t;
          } else if (t - lastHit > 5) hp = Math.min(100, hp + 16 * dt);
          if (hp <= 0) died = true;
        }
        g.input.clear();
        const o = out[stance];
        o.dmg += dmg;
        o.hits += hits;
        o.shots += shots;
        if (died) o.deaths++;
      }
    }
    const rows = {};
    for (const s of stances) {
      const o = out[s];
      rows[s] = { '피해/35초': +(o.dmg / REPS).toFixed(1), '명중률%': +((o.hits / Math.max(1, o.shots)) * 100).toFixed(1), '35초 안 전사%': Math.round((o.deaths / REPS) * 100) };
    }
    return rows;
  }, { REPS, THREAT });
  console.log(`· 자세별 적 치명도 (위협 ${THREAT}, 소총수 3명 18~30m, 35초 × ${REPS}회)`);
  console.table(res);
  console.log(`  콘솔 에러 ${errors.length}`);
  await close();
}

// ---------------------------------------------------------------------
if (run('gun')) {
  const { page, errors, close } = await start('?nolock&gfx=low&seed=PIASIK-1');
  const res = await page.evaluate(async ({ REPS, DISTS }) => {
    const g = window.__game;
    const V = g.camera.position.constructor;
    g.director.update = function () {};
    g.player.takeDamage = function () {};
    const tmp = new V();
    const outdoor = g.world.nav.nodes.filter((n) => !n.removed && !n.indoor && n.y < 0.5 && (n.type === 'street' || n.type === 'yard'));
    const pairs = {};
    for (const d of DISTS) {
      pairs[d] = [];
      for (let i = 0; i < outdoor.length && pairs[d].length < 12; i += 7) {
        const a = outdoor[i];
        for (const b of outdoor) {
          if (Math.abs(Math.hypot(b.x - a.x, b.z - a.z) - d) > 1.2) continue;
          const e1 = new V(a.x, a.y + 1.65, a.z);
          if (g.world.hasLineOfSight(e1, new V(b.x, b.y + 1.25, b.z)) && g.world.hasLineOfSight(e1, new V(b.x, b.y + 0.5, b.z))) {
            pairs[d].push([a, b]);
            break;
          }
        }
      }
    }
    const styles = {
      '허리 연사': { ads: false, burst: 20, pause: 0, move: false },
      '허리 3발 점사': { ads: false, burst: 3, pause: 0.3, move: false },
      '정조준 3발 점사': { ads: true, burst: 3, pause: 0.3, move: false },
      '정조준 연사': { ads: true, burst: 20, pause: 0, move: false },
      '정조준 단발': { ads: true, burst: 1, pause: 0.22, move: false },
      '허리 연사 + 이동': { ads: false, burst: 20, pause: 0, move: true },
    };
    const rows = {};
    for (const [name, s] of Object.entries(styles)) {
      const row = {};
      for (const d of DISTS) {
        let shots = 0;
        let hits = 0;
        for (let rep = 0; rep < REPS; rep++) {
          const pr = pairs[d][rep % Math.max(1, pairs[d].length)];
          if (!pr) continue;
          const [a, b] = pr;
          g.npcs.clear();
          g.input.clear();
          g.weapon.reset();
          g.player.crouching = false;
          g.debugTeleport(a.x, a.y + 0.05, a.z);
          const npc = g.debugSpawn('enemy', { type: 'rifleman', at: { x: b.x, y: b.y, z: b.z } });
          npc.placeAt(b.x, b.y, b.z, Math.atan2(a.x - b.x, a.z - b.z));
          npc.think = function () {
            this.crouchTarget = 0;
            this.aimTarget = 0;
            this.curSpeed = 0;
          };
          let h = 0;
          npc.takeDamage = function () {
            h++;
          };
          const dt = 1 / 60;
          let jx = 0;
          let jy = 0;
          const aim = () => {
            npc.getChestPosition(tmp);
            const cam = g.camera.position;
            const amp = ((s.ads ? 0.15 : 0.35) * Math.PI) / 180;
            const th = 3;
            const sg = amp * Math.sqrt(2 * th * dt) * Math.sqrt(3);
            jx += -th * jx * dt + (Math.random() * 2 - 1) * sg;
            jy += -th * jy * dt + (Math.random() * 2 - 1) * sg;
            g.player.yaw = Math.atan2(-(tmp.x - cam.x), -(tmp.z - cam.z)) + jx - g.player.recoilYaw * 0.2;
            g.player.pitch = Math.atan2(tmp.y - cam.y, Math.hypot(tmp.x - cam.x, tmp.z - cam.z)) + jy - g.player.recoilPitch * 0.6;
          };
          g.input.mouseDown[2] = s.ads;
          for (let t = 0; t < 0.5; t += dt) {
            aim();
            g._updatePlaying(dt);
            g.input.endFrame();
          }
          let state = 'fire';
          let pauseT = 0;
          let flip = 0;
          let dir = 1;
          const t0 = g.time;
          const shots0 = g.weapon.shotsFired;
          let burstStart = shots0;
          while (g.weapon.shotsFired - shots0 < 21 && g.time - t0 < 12) {
            if (s.move) {
              flip -= dt;
              if (flip <= 0) {
                flip = 0.9;
                dir = -dir;
              }
              g.input.down.delete('KeyA');
              g.input.down.delete('KeyD');
              g.input.down.add(dir > 0 ? 'KeyD' : 'KeyA');
            }
            aim();
            if (state === 'fire' && g.weapon.shotsFired - burstStart >= s.burst) {
              state = 'pause';
              pauseT = s.pause;
            }
            if (state === 'pause') {
              pauseT -= dt;
              if (pauseT <= 0) {
                state = 'fire';
                burstStart = g.weapon.shotsFired;
              }
            }
            g.input.mouseDown[0] = state === 'fire';
            if (g.weapon.ammo === 0) g.weapon.ammo = 30;
            g._updatePlaying(dt);
            g.input.endFrame();
          }
          g.input.clear();
          shots += g.weapon.shotsFired - shots0;
          hits += h;
        }
        row[`${d}m`] = `${((hits / Math.max(1, shots)) * 100).toFixed(0)}%`;
      }
      rows[name] = row;
    }
    return rows;
  }, { REPS: 4, DISTS: [10, 20, 35] });
  console.log('· 플레이어 사격 방식별 명중률 (서 있는 표적, 거리별 4자리 × 21발)');
  console.table(res);
  console.log(`  콘솔 에러 ${errors.length}`);
  await close();
}
