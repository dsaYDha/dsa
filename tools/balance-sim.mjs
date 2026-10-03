#!/usr/bin/env node
// 피아식별 밸런스 시뮬레이션 — 3D 없이 config.js 의 수치 + 확률 모델로 세 가지 플레이 스타일을 비교한다
//   난사형: 튀어나온 사람을 확인 없이 바로 쏜다 (처음부터 곁에 있던 분대·숨어 있던 민간인은 제외)
//   균형형: 표식을 빨리 확인하고 빨간 표식은 바로 쏜다. 파란 표식·사복은 한눈에 장비를 훑고, 수상하면(행동·장비) 문답·관찰로 확인
//   신중형: 파란 표식·사복은 모두 말을 걸어 문답으로 확인한 뒤에만 판단한다 (빨간 표식도 조금 더 오래 확인)
// 사용: node tools/balance-sim.mjs [판 수=400] [모드=survival|timed|all] [난이도=normal|easy|hard|all]
// 출력: 스타일별 평균 점수(3분·5분·끝), 생존 시간, 작전 해임·전사 비율, 사살·오인 사격·위장 적 식별·기습당함
//
// 모델 요약 (게임 코드와 같은 config 수치를 씀):
//   · 디렉터: 소강→산발→습격→정리 리듬(config.director·threat), 위협 단계 = 곡선 시간 1분마다(config.curve·modes),
//     적 1명 출현마다 아군·민간인 크레딧(곡선 mix, 습격 중 아군 ×2)과 위장 크레딧(fakeAlly·fakeCiv), 상한(threat.maxActive·ally·civilian·maxDisguised),
//     돌발 조우(director.ambush), 위장 숙련도 분포(곡선 skill × 난이도 skillMul) → 장비 단서 수(disguise.gearBySkill)
//   · 적 사격: 유형별 명중률 × 위협 단계 배율 × 난이도 배율 × 거리·이동·엄폐 보정, 등장 유예·반응 지연, 점사 속도, 유형별 피해
//   · 위장 적: 섞이기·접근 뒤 참을성(disguise.ambush.patience) 만큼 지나면 기습 — 예고 동작 중에 쏘면 막음
//   · 점수: config.score(사살·헤드샷·즉응·멀티킬·콤보·위장 적 식별·근거) / 오인 사격: config.penalty(총알마다 감점, 사살 시 경고·콤보 잠금)
//   · v1.1: 적 조준(npc.aim) — 전체 배율(enemyMul × 난이도 aimBoost), 조준 수렴(플레이어가 멈춰 있는 동안 start → max, 움직이면 초기화),
//     예측 사격(움직이는 플레이어의 이동 감점 일부 상쇄), 점사 속도(유형별 burst·burstPause 로 계산)
//     플레이어: 스타일마다 움직이는 시간 비율(moveFrac) · 허리 사격 비율(hipFrac — 무기 퍼짐·반동 강화로 사살 시간 증가),
//     적의 조준 회피(npc.evade — 오래 겨누면 숨거나 비켜서 사살이 늦어짐)
import { CONFIG } from '../js/config.js';

// ---------------------------------------------------------------------
// 난수 (시드 고정 — 결과 재현)
// ---------------------------------------------------------------------
function rng(seed) {
  let s = seed >>> 0;
  const next = () => {
    let t = (s = (s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (a, b) => a + (b - a) * next(),
    int: (a, b) => a + Math.floor(next() * (b - a + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    weighted(map) {
      let tot = 0;
      for (const k in map) tot += Math.max(0, map[k]);
      let r = next() * tot;
      for (const k in map) {
        r -= Math.max(0, map[k]);
        if (r <= 0) return k;
      }
      return Object.keys(map)[0];
    },
  };
}

const lerp = (a, b, t) => a + (b - a) * t;
const threatT = (lvl) => Math.min(1, Math.max(0, (lvl - 1) / (CONFIG.threat.maxLevel - 1)));
const lerpT = (pair, lvl) => lerp(pair[0], pair[1], threatT(lvl));
const lerpRangeT = (pp, lvl) => [lerp(pp[0][0], pp[1][0], threatT(lvl)), lerp(pp[0][1], pp[1][1], threatT(lvl))];
const disguiseT = (lvl) => Math.min(1, Math.max(0, (lvl - CONFIG.disguise.fromThreat) / Math.max(1, CONFIG.threat.maxLevel - CONFIG.disguise.fromThreat)));
const lerpRangeD = (pp, lvl) => [lerp(pp[0][0], pp[1][0], disguiseT(lvl)), lerp(pp[0][1], pp[1][1], disguiseT(lvl))];

// ---------------------------------------------------------------------
// 플레이 스타일 (시간 단위 초, 확률 0~1) — 근거는 CLAUDE.md "밸런스 시뮬레이션"
// ---------------------------------------------------------------------
export const STYLES = {
  spray: {
    label: '난사형',
    acquire: [0.2, 0.35], // 새 대상 쪽으로 돌려 조준
    checkRed: [0, 0], // 표식 확인 없음
    ttk: [0.35, 0.9], // 쏘기 시작해 쓰러뜨리기까지 (적)
    headshot: 0.15,
    shootsEveryone: true, // 아군·민간인도 그대로 쏨
    glance: null,
    questionAll: false,
    reactTelegraph: 0.85, // 정체를 드러내는 예고 동작 중에 쏴서 막을 확률
    crossfire: 0, // (전부 쏘므로 따로 없음)
    exposure: 1.0, // 받는 피해 배율 (확인·문답에 쓰는 시간 동안 덜 움직이고 노출됨)
    moveFrac: 0.55, // v1.1: 움직이는 시간 비율 (적의 조준 수렴을 끊음 — 대신 움직이며 쏘면 허리 사격)
    moveSeg: 1.1, // 움직임/멈춤 한 구간 평균 길이(초)
    hipFrac: 0.85, // 허리 사격·이동 사격 비율 (실측: 허리 연사는 사살당 발사 +35%)
  },
  balanced: {
    label: '균형형',
    acquire: [0.25, 0.4],
    checkRed: [0.25, 0.45], // 빨간 표식 확인
    ttk: [0.4, 1.0],
    headshot: 0.25,
    glance: [0.35, 0.65], // 파란 표식·사복을 한눈에 훑는 시간
    gearSpot: [0.7, 0.35, 0], // 훑는 동안 장비 단서를 알아챌 확률 (숙련 0/1/2)
    suspectReal: 0.06, // 평범한 진짜 인물이 수상해 보일 확률 (→ 확인)
    suspectDecoy: 0.9, // 오판 유도 행동(낙오병·동행·얼어붙음·도움 요청)이 수상해 보일 확률
    suspectFake: 0.75, // 위장 적의 행동 성향이 드러나 수상해 보일 확률
    check: [1.8, 3.2], // 수상하면 문답·관찰로 확인하는 시간
    identify: [0.95, 0.9, 0.5], // 확인했을 때 위장을 가려낼 확률 (숙련 0/1/2 — 숙련 2 는 소속·패치 대조·실내 문답이 될 때만)
    questionAll: false,
    reactTelegraph: 0.45,
    crossfire: 0.05, // 적과 붙어 나온 아군·민간인이 탄퍼짐에 맞을 확률
    exposure: 1.0,
    moveFrac: 0.45, // 점사 사이에 옆으로 움직임
    moveSeg: 1.0,
    hipFrac: 0.2, // 가까운 적만 허리 사격, 나머지는 정조준 점사
  },
  careful: {
    label: '신중형',
    acquire: [0.3, 0.5],
    checkRed: [0.45, 0.8],
    ttk: [0.45, 1.1],
    headshot: 0.3,
    glance: null,
    questionAll: true, // 파란 표식·사복은 모두 문답으로 확인
    question: [2.4, 4.2], // 말 걸기 + 질문 + 대답 (+ 관찰)
    identify: [0.97, 0.95, 0.6],
    questionReveal: 0.35, // 숙련 0 이 문답에 막혀 바로 정체를 드러낼 확률 (config.dialogue.skill0RevealOnStuck)
    reactTelegraph: 0.6,
    crossfire: 0.03,
    exposure: 1.08, // 말 거는 동안 멈춰 서 있어 조금 더 맞음
    moveFrac: 0.25, // 말 걸고 관찰하느라 오래 멈춰 섬 (적의 조준이 수렴)
    moveSeg: 1.4,
    hipFrac: 0.1,
  },
};

// 적 사격 모델 보정 (게임 실측 대략치): 평균 교전 거리·플레이어 엄폐 활용·사선 확보 비율
// approach: 생성 뒤 사선이 트이기까지(초) — 실제 게임 봇의 분당 사살·생존 시간에 맞춤 (CLAUDE.md "밸런스 시뮬레이션")
// fireDuty: 적이 실제로 쏘는 시간 비율(엄폐에서 내밀기·이동 포함) — v1.0 보정값(초당 2.6발)을 유형별 점사 속도로 바꾼 뒤의 배율
// moveSpeedFrac: 움직이는 플레이어의 평균 속도/전력질주 속도 (이동 감점), leadAvg: 예측 사격이 걸리는 평균 정도 (방향을 자주 바꿈)
const ENEMY = { distFactor: 0.62, playerCover: 0.4, fireDuty: 1.0, ambushShots: [3, 6], hotAcc: 0.55, approach: [4, 17], moveSpeedFrac: 0.55, leadAvg: 0.4 };
// v1.1 무기 다루기(퍼짐·반동 강화): 실제 게임 봇 실측 — 허리 연사 사살당 발사 +34%, 정조준 점사는 변화 없음
const HIP_TTK_MUL = 1.4;
// 적의 조준 회피로 늦어지는 시간 (숨었다 다시 내밀 때까지)
const EVADE_DELAY = [0.6, 1.5];

// 유형별 초당 발사 수 (점사 발수 / (점사 시간 + 점사 간격))
function fireRate(type) {
  const c = CONFIG.npc.types[type];
  const burst = (c.burst[0] + c.burst[1]) / 2;
  const pause = (c.burstPause[0] + c.burstPause[1]) / 2;
  return burst / (burst * CONFIG.npc.shotInterval * 1.05 + pause);
}

// ---------------------------------------------------------------------
// 한 판
// ---------------------------------------------------------------------
export function simulateRun(styleKey, { mode = 'survival', difficulty = 'normal', seed = 1, maxMinutes = 10 } = {}) {
  const R = rng(seed);
  const S = STYLES[styleKey];
  const M = CONFIG.modes[mode];
  const P = CONFIG.difficulty[difficulty];
  const D = CONFIG.director;
  const T = CONFIG.threat;
  const SC = CONFIG.score;
  const PEN = CONFIG.penalty;
  const duration = M.duration > 0 ? M.duration : maxMinutes * 60;
  const dt = 0.1;

  // 상태
  let t = 0;
  let threat = 1;
  const people = [];
  let nextId = 1;
  const player = { hp: 100, lastHit: -99, busyUntil: 0, task: null };
  const st = { score: 0, kills: 0, warnings: 0, ff: 0, ffKills: 0, identified: 0, ambushed: 0, evac: 0, quick: 0, disguised: 0, at3: null, at5: null, end: null, reason: null };
  let combo = 1;
  let chain = 0;
  let comboTimer = 0;
  let lockT = 0;
  let multiT = 0;
  let multiN = 0;
  const credits = { ally: 0, civ: 0, fakeAlly: 0, fakeCiv: 0 };
  // 디렉터 리듬
  let phase = 'lull';
  let phaseT = R.range(...D.firstLull);
  let phaseE = 0;
  let firstCycle = true;
  let spawnT = 0;
  let ambushT = D.ambush.firstAfter + R.range(0, 10);
  const waveIds = new Set();

  const curveAt = () => {
    const minutes = M.curveStart + (t / 60) * M.curveSpeed;
    const ph = CONFIG.curve.phases;
    let i = 0;
    while (i + 1 < ph.length && minutes >= ph[i + 1].at) i++;
    return { ph: ph[i], minutes };
  };
  const cap = () => T.maxActive[Math.min(T.maxActive.length - 1, threat - 1)];
  const alive = (f) => people.filter((p) => !p.gone && f(p));
  const activeEnemies = () => alive((p) => p.kind === 'enemy' || (p.kind === 'fake' && p.revealed)).length;

  const rollSkill = (ph) => {
    const w = ph.skill.map((v, k) => v * P.skillMul[k]);
    const tot = w.reduce((a, b) => a + b, 0) || 1;
    let r = R.next() * tot;
    for (let k = 0; k < 3; k++) {
      r -= w[k];
      if (r <= 0) return k;
    }
    return 2;
  };

  // v1.1 적 조준: 전체 배율(쉬움은 강화 폭 절반) · 수렴 범위
  const AIM = CONFIG.npc.aim;
  const boost = P.aimBoost ?? 1;
  const aimMul = 1 + (AIM.enemyMul - 1) * boost;
  const convStart = 1 - (1 - AIM.converge.start) * boost;
  const convMax = 1 + (AIM.converge.max - 1) * boost;
  const enemyStats = (type) => {
    const c = CONFIG.npc.types[type];
    const acc = c.accuracy * lerpT(T.accuracyMul, threat) * P.enemyAccuracy * aimMul;
    const react = lerpRangeT(T.reactionDelay, threat).map((v) => v * P.enemyReaction);
    return { acc, react: R.range(react[0], react[1]), dmg: CONFIG.npc.hitDamage[type] || 8, rate: fireRate(type), conv: 0 };
  };
  // 무기 다루기 강화 폭 (쉬움 handling.spreadMul 0.75 → 절반)
  const handlingFrac = Math.max(0, Math.min(1, ((P.handling ? P.handling.spreadMul : 1) - 0.5) / 0.5));
  const hipMul = 1 + (HIP_TTK_MUL - 1) * handlingFrac;
  // 플레이어 움직임 (구간마다 움직임/멈춤 — 움직이면 적의 조준 수렴이 끊김)
  let moving = R.chance(S.moveFrac);
  let moveT = R.range(0.3, 1) * S.moveSeg;

  const spawn = (kind, o = {}) => {
    const p = { id: nextId++, kind, spawnAt: t, gone: false, handled: !!o.known, ...o };
    const lead = o.ambush ? R.range(0.25, 0.6) : R.range(0.8, 3.0);
    p.visibleAt = t + lead;
    // 적은 시야 밖에서 생성돼 자리를 잡고 사선이 트일 때까지 시간이 걸린다 (소총수·창문 사수는 길고, 돌격병은 짧게)

    if (kind === 'enemy') {
      const lvl = threat;
      const tw = lvl >= T.windowFromLevel ? (() => {
        const [a, b] = T.typeWeights;
        const tt = threatT(lvl);
        const out = {};
        for (const k of Object.keys(a)) out[k] = lerp(a[k], b[k], tt);
        return out;
      })() : { rifleman: 0.78, assault: 0.22, window: 0 };
      p.type = o.type || R.weighted(tw);
      Object.assign(p, enemyStats(p.type));
      // 적은 시야 밖에서 생성돼 자리를 잡고 사선이 트일 때까지 시간이 걸린다 (돌격병은 짧게)
      if (!o.ambush) p.visibleAt += p.type === 'assault' ? R.range(2, 9) : R.range(ENEMY.approach[0], ENEMY.approach[1]);
      p.shootFrom = p.visibleAt + CONFIG.npc.spawnGrace + p.react;
    } else if (kind === 'fake') {
      st.disguised++;
      p.skill = rollSkill(curveAt().ph);
      const gr = CONFIG.disguise.gearBySkill[p.skill];
      p.gear = R.int(gr[0], gr[1]);
      const blend = R.range(...CONFIG.disguise.blendTime) * (o.infiltrate ? 0.2 : 1);
      const approach = R.range(5, 14);
      const pat = R.range(...lerpRangeD(CONFIG.disguise.ambush.patience, threat));
      p.ambushAt = p.visibleAt + blend + approach + pat * R.range(0.55, 1.0);
      p.suspicious = R.chance(S.suspectFake ?? 0.7);
      Object.assign(p, enemyStats('assault'));
    } else if (kind === 'ally') {
      p.leaveAt = t + R.range(...CONFIG.ally.tour);
      p.suspicious = !!o.decoy;
    } else if (kind === 'civ') {
      p.leaveAt = p.visibleAt + R.range(18, 60);
      p.suspicious = !!o.decoy;
    }
    people.push(p);
    return p;
  };

  // 크레딧 적립 (적 1명 출현마다)
  const accrue = () => {
    const { ph } = curveAt();
    const mul = phase === 'assault' ? D.assaultAllyMul : 1;
    const fa = ph.maxDisguised > 0 ? Math.min(0.45, ph.fakeAlly * P.disguiseMul) : 0;
    const fc = ph.maxDisguised > 0 ? Math.min(0.45, ph.fakeCiv * P.disguiseMul) : 0;
    const a = (ph.mix[1] / ph.mix[0]) * mul;
    const c = ph.mix[2] / ph.mix[0];
    credits.ally += a * (1 - fa);
    credits.fakeAlly += a * fa;
    credits.civ += c * (1 - fc);
    credits.fakeCiv += c * fc;
  };
  const spawnEnemy = (o = {}) => {
    if (activeEnemies() >= cap()) return null;
    const p = spawn('enemy', o);
    accrue();
    return p;
  };

  // 초기 배치: 아군 분대(곁에 있음 — 알고 있음), 숨어 있는 민간인
  for (let i = 0; i < R.int(2, 3); i++) spawn('ally', { known: true, initial: true });
  for (let i = 0; i < R.int(...CONFIG.civilian.initialCount); i++) spawn('civ', { known: true, initial: true });

  // --- 점수 ---
  const addKill = (p, { identified = false, evidence = false } = {}) => {
    st.kills++;
    let pts = SC.kill;
    if (R.chance(S.headshot)) pts += SC.headshot;
    if (t - p.visibleAt <= SC.quickKillWindow) {
      pts += SC.quickKill;
      st.quick++;
    }
    if (identified) {
      pts += SC.disguiseId;
      st.identified++;
      if (evidence) pts += SC.evidence;
    }
    if (multiT > 0) multiN++;
    else multiN = 1;
    multiT = SC.multiKillWindow;
    if (multiN === 2) pts += SC.multiKill2;
    else if (multiN >= 3) pts += SC.multiKill3;
    if (lockT > 0) {
      chain = 0;
      combo = 1;
    } else if (comboTimer > 0) {
      chain++;
      combo = Math.min(SC.comboMax, 1 + SC.comboStep * (chain - 1));
    } else {
      chain = 1;
      combo = 1;
    }
    comboTimer = lockT > 0 ? 0 : SC.comboWindow;
    st.score += Math.round(pts * combo);
    p.gone = true;
  };
  const friendlyFire = (p, kill) => {
    const civ = p.kind === 'civ';
    const hits = civ ? 1 : R.int(2, 3);
    st.score += (civ ? PEN.civHit : PEN.allyHit) * hits;
    st.ff++;
    combo = 1;
    chain = 0;
    comboTimer = 0;
    if (kill) {
      st.score += civ ? PEN.civKill : PEN.allyKill;
      lockT = Math.max(lockT, civ ? PEN.civKillComboLock : PEN.allyKillComboLock);
      st.warnings++;
      st.ffKills++;
      p.gone = true;
    }
  };
  const damagePlayer = (amount) => {
    player.hp -= amount;
    player.lastHit = t;
  };

  // --- 플레이어가 할 일 고르기 ---
  const pickTask = () => {
    const vis = people.filter((p) => !p.gone && p.visibleAt <= t);
    // 1) 빨간 표식 (적, 정체를 드러낸 위장 적) — 가장 오래 보인 순
    const reds = vis.filter((p) => p.kind === 'enemy' || (p.kind === 'fake' && p.revealed));
    if (reds.length) {
      reds.sort((a, b) => a.visibleAt - b.visibleAt);
      const p = reds[0];
      const cover = p.type === 'rifleman' || p.type === 'window' ? R.range(0, 1.2) : 0; // 엄폐 뒤에서 고개를 내밀 때까지
      // v1.1: 허리 사격이면 사살이 늦어지고(퍼짐·반동), 오래 겨누면 적이 숨거나 비켜섬
      let ttk = R.range(...S.ttk) * (R.chance(S.hipFrac) ? hipMul : 1);
      const E = CONFIG.npc.evade;
      if (ttk > (E.aimTime[0] + E.aimTime[1]) / 2 && R.chance(E.chance * 0.6)) ttk += R.range(...EVADE_DELAY);
      return { kind: 'kill', p, until: t + R.range(...S.acquire) + R.range(...S.checkRed) + ttk + cover };
    }
    // 2) 아직 판단하지 않은 파란 표식·사복
    const others = vis.filter((p) => !p.handled && (p.kind === 'ally' || p.kind === 'civ' || (p.kind === 'fake' && !p.revealed)));
    if (!others.length) return null;
    others.sort((a, b) => a.visibleAt - b.visibleAt);
    const p = others[0];
    if (S.shootsEveryone) return { kind: 'shootAny', p, until: t + R.range(...S.acquire) + R.range(0.25, 0.6) };
    if (S.questionAll) return { kind: 'question', p, until: t + R.range(...S.acquire) + R.range(...S.question) };
    return { kind: 'glance', p, until: t + R.range(...S.acquire) + R.range(...S.glance) };
  };

  const finishTask = (task) => {
    const p = task.p;
    if (task.kind === 'kill') {
      if (!p.gone) addKill(p);
      return;
    }
    if (p.gone) return;
    if (task.kind === 'shootAny') {
      p.handled = true;
      if (p.kind === 'fake') addKill(p, { identified: !p.revealing });
      else friendlyFire(p, true);
      return;
    }
    if (task.kind === 'glance') {
      p.handled = true;
      if (p.kind === 'fake' && R.chance(S.gearSpot[p.skill] * (p.gear > 0 ? 1 : 0))) {
        // 장비 단서(확정 증거)를 봤다 → 바로 사격
        player.busyUntil = t + R.range(0.4, 0.9);
        player.task = { kind: 'idKill', p, evidence: false, until: player.busyUntil };
        return;
      }
      const sus = p.kind === 'fake' ? p.suspicious : p.suspicious ? R.chance(S.suspectDecoy) : R.chance(S.suspectReal);
      if (sus) {
        player.busyUntil = t + R.range(...S.check);
        player.task = { kind: 'checked', p, until: player.busyUntil };
      }
      return;
    }
    if (task.kind === 'checked' || task.kind === 'question') {
      p.handled = true;
      if (p.kind !== 'fake') return; // 진짜 확인 — 점수 없음
      if (task.kind === 'question' && p.skill === 0 && R.chance(S.questionReveal)) {
        // 문답에 막혀 바로 정체를 드러냄 (예고 동작 중에 쏘면 '사전 식별')
        if (R.chance(0.8)) addKill(p, { identified: true, evidence: true });
        else ambush(p);
        return;
      }
      if (R.chance(S.identify[p.skill])) {
        player.busyUntil = t + R.range(0.4, 0.9);
        player.task = { kind: 'idKill', p, evidence: true, until: player.busyUntil };
      }
      return;
    }
    if (task.kind === 'idKill') addKill(p, { identified: true, evidence: task.evidence });
  };

  // 위장 적 기습
  const ambush = (p) => {
    if (p.gone || p.revealed) return;
    p.revealed = true;
    p.handled = true;
    // 예고 동작(0.5~0.8초) — 지금 손이 비어 있으면 막을 기회
    const free = player.busyUntil <= t || (player.task && player.task.p === p);
    if (R.chance(S.reactTelegraph * (free ? 1 : 0.5))) {
      addKill(p); // 반응 사격 — 사전 식별 아님
      return;
    }
    st.ambushed++;
    const shots = R.int(...ENEMY.ambushShots);
    for (let i = 0; i < shots; i++) if (R.chance(Math.min(AIM.max, ENEMY.hotAcc * P.enemyAccuracy * aimMul))) damagePlayer(p.dmg * 1.0);
    p.visibleAt = t; // 이제 빨간 표식 적
    p.shootFrom = t + 0.4;
  };

  // --- 메인 루프 ---
  for (; t < duration; t += dt) {
    const { ph, minutes } = curveAt();
    const lvl = Math.min(T.maxLevel, 1 + Math.floor(minutes));
    threat = lvl;
    // 디렉터 리듬
    phaseT -= dt;
    phaseE += dt;
    const act = activeEnemies();
    if (phase === 'lull') {
      if (phaseT <= 0) {
        if (firstCycle) {
          firstCycle = false;
          phase = 'sporadic';
          phaseT = R.range(...D.sporadicDuration);
          spawnT = 0.2;
        } else if (R.chance(D.chanceLullToAssault)) startAssault();
        else {
          phase = 'sporadic';
          phaseT = R.range(...D.sporadicDuration);
          spawnT = R.range(0.3, 1.5);
        }
        phaseE = 0;
      }
    } else if (phase === 'sporadic') {
      spawnT -= dt;
      if (spawnT <= 0) {
        const [a, b] = lerpRangeT(T.sporadicInterval, lvl);
        spawnT = R.chance(0.2) ? R.range(0.4, 1.2) : R.range(a, b) * R.range(0.6, 1.5);
        if (act < Math.ceil(cap() * 0.75)) {
          spawnEnemy();
          if (R.chance(0.22 + lvl * 0.02)) spawnEnemy();
        }
      }
      if (phaseT <= 0) {
        if (R.chance(D.chanceSporadicToAssault)) startAssault();
        else {
          phase = 'lull';
          phaseT = R.range(...lerpRangeT(T.lullDuration, lvl));
        }
        phaseE = 0;
      }
    } else if (phase === 'assault') {
      let left = 0;
      for (const p of people) if (!p.gone && waveIds.has(p.id)) left++;
      if ((left <= 1 && phaseE > 4) || phaseT <= 0) {
        phase = 'relax';
        phaseT = D.relaxMaxTime;
        phaseE = 0;
      }
    } else if (phase === 'relax') {
      if (act <= 1 || phaseT <= 0) {
        phase = 'lull';
        phaseT = R.range(...lerpRangeT(T.lullDuration, lvl)) * R.range(0.7, 1.2);
        phaseE = 0;
      }
    }
    function startAssault() {
      phase = 'assault';
      phaseT = D.assaultTimeout;
      phaseE = 0;
      waveIds.clear();
      const [a, b] = lerpRangeT(T.waveSize, lvl);
      const n = Math.min(Math.round(R.range(a, b)), cap() - activeEnemies());
      for (let i = 0; i < n; i++) {
        const p = spawnEnemy();
        if (p) {
          p.visibleAt += i * R.range(0.15, 0.7);
          waveIds.add(p.id);
        }
      }
      // 습격의 혼란을 틈탄 위장 적
      if (ph.maxDisguised > 0 && alive((p) => p.kind === 'fake' && !p.revealed).length < ph.maxDisguised && R.chance(lerp(...CONFIG.disguise.assaultInfiltrate, disguiseT(lvl)))) {
        spawn('fake', { as: R.chance(0.55) ? 'ally' : 'civ', infiltrate: true });
      }
    }
    // 아군·민간인·위장 적 등장 (크레딧)
    credits.ally = Math.min(credits.ally, CONFIG.ally.squadSize[1] * 1.5);
    credits.civ = Math.min(credits.civ, 4);
    credits.fakeAlly = Math.min(credits.fakeAlly, 1.5);
    credits.fakeCiv = Math.min(credits.fakeCiv, 1.5);
    if (credits.ally >= 2 && alive((p) => p.kind === 'ally').length + 2 <= CONFIG.ally.maxActive) {
      const n = Math.min(R.int(2, 4), Math.floor(credits.ally));
      const decoy = R.chance(ph.decoyAlly);
      const near = R.chance(ph.nearEnemy);
      for (let i = 0; i < n; i++) spawn('ally', { decoy: decoy && i === 0, near });
      credits.ally -= n;
    }
    if (credits.civ >= 1 && alive((p) => p.kind === 'civ').length < CONFIG.civilian.maxActive) {
      spawn('civ', { decoy: R.chance(ph.decoyCiv), near: R.chance(ph.nearEnemy) });
      credits.civ -= 1;
    }
    const fakes = alive((p) => p.kind === 'fake' && !p.revealed).length;
    if (ph.maxDisguised > 0 && fakes < ph.maxDisguised) {
      if (credits.fakeAlly >= 1) {
        spawn('fake', { as: 'ally' });
        credits.fakeAlly -= 1;
      } else if (credits.fakeCiv >= 1) {
        spawn('fake', { as: 'civ' });
        credits.fakeCiv -= 1;
      }
    }
    // 돌발 조우
    ambushT -= dt;
    if (ambushT <= 0) {
      const [a, b] = lerpRangeT([D.ambush.interval, D.ambush.intervalAtMax], lvl);
      ambushT = R.range(a, b);
      const k = R.weighted(D.ambush.mix);
      if (k === 'enemy') spawnEnemy({ ambush: true, type: R.chance(0.6) ? 'assault' : 'rifleman' });
      else spawn(k === 'ally' ? 'ally' : 'civ', { ambush: true });
    }

    // 사람들 퇴장 (아군 교대·민간인 대피)
    for (const p of people) {
      if (p.gone) continue;
      if ((p.kind === 'ally' || p.kind === 'civ') && p.leaveAt != null && t >= p.leaveAt) {
        p.gone = true;
        if (p.kind === 'civ') {
          st.score += SC.evacuation;
          st.evac++;
        }
      }
      if (p.kind === 'fake' && !p.revealed && t >= p.ambushAt) ambush(p);
    }

    // 플레이어 행동
    if (player.busyUntil <= t) {
      if (player.task) {
        const task = player.task;
        player.task = null;
        finishTask(task);
      }
      if (player.busyUntil <= t) {
        const task = pickTask();
        if (task) {
          player.task = task;
          player.busyUntil = task.until;
        }
      }
    }
    // 적과 붙어 나온 아군·민간인이 탄퍼짐에 맞음 (적을 쏘는 중일 때)
    if (S.crossfire > 0 && player.task && player.task.kind === 'kill') {
      for (const p of people) {
        if (p.gone || !p.near || p.crossChecked || p.visibleAt > t || (p.kind !== 'ally' && p.kind !== 'civ')) continue;
        p.crossChecked = true;
        if (R.chance(S.crossfire)) friendlyFire(p, R.chance(0.12));
      }
    }

    // 플레이어 움직임 구간 (말 걸기·확인 중엔 멈춰 섬)
    moveT -= dt;
    if (moveT <= 0) {
      moving = R.chance(S.moveFrac);
      moveT = R.range(0.5, 1.5) * S.moveSeg;
    }
    const still = !moving || (player.task && (player.task.kind === 'question' || player.task.kind === 'checked'));
    // 적 사격 → 플레이어 피해 (v1.1: 수렴 — 멈춰 있으면 쌓이고 움직이면 초기화 / 움직이면 이동 감점 − 예측 사격)
    const C = AIM.converge;
    const moveMul = 1 - CONFIG.npc.accuracy.moveFactor * ENEMY.moveSpeedFrac * (1 - AIM.lead.comp * boost * ENEMY.leadAvg);
    for (const p of people) {
      if (p.gone) continue;
      const red = p.kind === 'enemy' || (p.kind === 'fake' && p.revealed);
      if (!red || t < p.shootFrom) continue;
      if (still) p.conv = (p.conv || 0) + dt;
      else p.conv = 0;
      const conv = convStart + (convMax - convStart) * Math.min(1, (p.conv || 0) / C.time);
      const ramp = Math.min(1, (t - p.shootFrom) / CONFIG.npc.graceRamp);
      const hc = Math.min(AIM.max, p.acc * ENEMY.distFactor * ENEMY.playerCover * (0.25 + 0.75 * ramp) * conv * (still ? 1 : moveMul)) * S.exposure;
      const expected = (p.rate || 2.6) * ENEMY.fireDuty * dt * hc;
      if (R.chance(expected)) damagePlayer(p.dmg);
    }
    // 회복
    if (t - player.lastHit > CONFIG.player.regenDelay && player.hp < 100) player.hp = Math.min(100, player.hp + CONFIG.player.regenRate * dt);
    // 콤보·멀티킬 타이머
    if (lockT > 0) lockT = Math.max(0, lockT - dt);
    if (comboTimer > 0) {
      comboTimer -= dt;
      if (comboTimer <= 0) {
        combo = 1;
        chain = 0;
      }
    }
    if (multiT > 0) multiT -= dt;

    if (st.at3 == null && t >= 180) st.at3 = st.score;
    if (st.at5 == null && t >= 300) st.at5 = st.score;
    if (player.hp <= 0) {
      st.reason = 'killed';
      break;
    }
    if (st.warnings >= PEN.maxWarnings) {
      st.reason = 'dismissed';
      break;
    }
  }
  st.end = t;
  if (!st.reason) st.reason = M.duration > 0 ? 'complete' : 'timeout';
  // 끝난 판은 그 뒤 점수가 그대로 (해임·전사 시점 점수)
  if (st.at3 == null) st.at3 = st.score;
  if (st.at5 == null) st.at5 = st.score;
  return st;
}

// ---------------------------------------------------------------------
// 여러 판 평균
// ---------------------------------------------------------------------
export function compare({ runs = 400, mode = 'survival', difficulty = 'normal', maxMinutes = 10 } = {}) {
  const out = {};
  for (const key of Object.keys(STYLES)) {
    const acc = { score: 0, at3: 0, at5: 0, end: 0, killed: 0, dismissed: 0, kills: 0, ff: 0, ffKills: 0, identified: 0, ambushed: 0, disguised: 0, warnings: 0, quick: 0 };
    for (let i = 0; i < runs; i++) {
      const r = simulateRun(key, { mode, difficulty, seed: 1000 + i * 7919, maxMinutes });
      acc.score += r.score;
      acc.at3 += r.at3;
      acc.at5 += r.at5;
      acc.end += r.end;
      acc.killed += r.reason === 'killed' ? 1 : 0;
      acc.dismissed += r.reason === 'dismissed' ? 1 : 0;
      acc.kills += r.kills;
      acc.ff += r.ff;
      acc.ffKills += r.ffKills;
      acc.identified += r.identified;
      acc.ambushed += r.ambushed;
      acc.disguised += r.disguised;
      acc.warnings += r.warnings;
      acc.quick += r.quick;
    }
    for (const k of Object.keys(acc)) acc[k] /= runs;
    out[key] = acc;
  }
  return out;
}

function fmt(n, d = 0) {
  return n.toLocaleString('ko-KR', { minimumFractionDigits: d, maximumFractionDigits: d });
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const runs = Number(process.argv[2] || 400);
  const modes = (process.argv[3] || 'survival') === 'all' ? Object.keys(CONFIG.modes) : [process.argv[3] || 'survival'];
  const diffs = (process.argv[4] || 'normal') === 'all' ? Object.keys(CONFIG.difficulty) : [process.argv[4] || 'normal'];
  for (const mode of modes) {
    for (const difficulty of diffs) {
      const res = compare({ runs, mode, difficulty });
      console.log(`\n== ${CONFIG.modes[mode].label} · ${CONFIG.difficulty[difficulty].label} (${runs}판) ==`);
      console.log('스타일   | 3분 점수 | 5분 점수 | 끝 점수  | 생존(초) | 전사 | 해임 | 사살 | 즉응 | 오인사격(사살) | 위장 식별/등장 | 기습당함');
      for (const [k, a] of Object.entries(res)) {
        console.log(
          `${STYLES[k].label.padEnd(5)}| ${fmt(a.at3).padStart(8)} | ${fmt(a.at5).padStart(8)} | ${fmt(a.score).padStart(8)} | ${fmt(a.end).padStart(8)} | ${fmt(a.killed * 100).padStart(3)}% | ${fmt(a.dismissed * 100).padStart(3)}% | ${fmt(a.kills, 1).padStart(4)} | ${fmt(a.quick, 1).padStart(4)} | ${fmt(a.ff, 1).padStart(5)} (${fmt(a.ffKills, 1)}) | ${fmt(a.identified, 1)}/${fmt(a.disguised, 1)} | ${fmt(a.ambushed, 1)}`,
        );
      }
      const order = Object.entries(res).sort((x, y) => y[1].score - x[1].score).map(([k]) => STYLES[k].label);
      console.log(`순위(끝 점수): ${order.join(' > ')}`);
    }
  }
}
