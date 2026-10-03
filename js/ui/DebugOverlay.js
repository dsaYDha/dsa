// 디버그 오버레이 (백틱 ` 키, 기본 꺼짐) — FPS, 종류별 활성 NPC 수, 스폰 디렉터 상태·출현 비율, 페널티, NPC 머리 위 trueFaction 표시
// 3단계: 위장 적 수·상한·누계, 오판 유도 행동 누계, 머리 위 위장 정보(유형·숙련도·남은 단서·기습 조건 진행)
// 4단계: 암구호·실내 기준수 상태, 대화 대상(없으면 조준 대상)이 아는 정보 (현재/이전 암구호·실내 기준수·부대명), 문답 통계
// 5단계: 성능(업데이트·렌더 ms, 드로우콜·삼각형, 지오메트리·텍스처·셰이더 수, 초당 시야 판정·레이캐스트, NPC LOD, 스킨 캐시),
//        난이도 곡선 구간·모드·난이도, 긴장도, 그래픽 프리셋
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { PhaseLabel } from '../director/SpawnDirector.js';
import { skinCacheStats } from '../npc/HumanoidRig.js';

const _v = new THREE.Vector3();

const GEAR_KO = { curvedRifle: '굽은탄창', enemyHelmet: '적헬멧', patchMissing: '패치없음', patchWrong: '패치다름', tapeBand: '테이프완장',
  combatBoots: '군화', waistBulge: '허리불룩', backRifle: '등총몸', radio: '무전기', vestStraps: '조끼끈', tacticalGloves: '전술장갑' };
const TRAIT_KO = { loner: '단독', noFire: '안쏨', fireAir: '허공사격', ignoreRadio: '무전무시', stare: '응시', fromEnemySide: '적쪽',
  hideHands: '손숨김', noCower: '안웅크림', lateHands: '손늦게', noHands: '손안듦' };

// 위장 적 머리 위 정보: 유형·숙련도 / 남은(아직 관찰 안 된) 장비 단서 / 행동 성향 / 기습 조건 진행
function disguiseLabel(n) {
  const p = n.disguise;
  if (p.revealed) return ` | 정체 드러냄(${p.revealReason})`;
  const gear = p.gear.map((k) => GEAR_KO[k] || k).join(',') || '없음(완벽)';
  const traits = [...p.traits].map((k) => TRAIT_KO[k] || k).join(',') || '-';
  const ctl = n.ctl;
  const amb = ctl ? ` 기습 ${(Math.min(1, ctl.ambushProgress) * 100).toFixed(0)}%${ctl.oppNow ? '(' + ctl.oppNow + ')' : ''} ${ctl.dist.toFixed(0)}m` : '';
  // 남은 단서: 아직 관찰로 찾지 못한 이상 사실 (장비 + 지금까지 기록된 행동)
  const found = n.observed ? n.observed.found : null;
  const left = n.observationFacts().filter((f) => f.anomalous && !(found && found.has(f.key))).length;
  const seen = ` 찾은 이상 ${n.observed ? n.observed.anomalies : 0}·남은 ${left}`;
  return ` | 위장[${p.role === 'scout' ? '정찰' : '기습'}·${p.mode}·숙련${p.skill}] 장비:${gear} 행동:${traits}${seen}${amb}`;
}

function ratio(a) {
  const t = a.enemy + a.ally + a.civilian || 1;
  return `${Math.round((a.enemy / t) * 100)}:${Math.round((a.ally / t) * 100)}:${Math.round((a.civilian / t) * 100)}`;
}

export class DebugOverlay {
  constructor(game) {
    this.game = game;
    this.enabled = false;
    this.panel = document.getElementById('debug-overlay');
    this.labelsEl = document.getElementById('debug-labels');
    this.labels = new Map();
    this.frames = 0;
    this.acc = 0;
    this.fps = 0;
    this.ms = 0;
    this._t = 0;
    this._los = { t: performance.now(), los: 0, ray: 0, losPerSec: 0, rayPerSec: 0 };
  }

  // 초당 시야 판정·레이캐스트 수
  _rates() {
    const c = this.game.world.collision;
    const L = this._los;
    const now = performance.now();
    const dt = (now - L.t) / 1000;
    if (dt >= 1 && c) {
      L.losPerSec = (c.losCalls - L.los) / dt;
      L.rayPerSec = (c.rayCalls - L.ray) / dt;
      L.los = c.losCalls;
      L.ray = c.rayCalls;
      L.t = now;
    }
    return L;
  }

  toggle() {
    this.enabled = !this.enabled;
    this.panel.classList.toggle('hidden', !this.enabled);
    this.labelsEl.classList.toggle('hidden', !this.enabled);
    if (!this.enabled) {
      this.labelsEl.innerHTML = '';
      this.labels.clear();
    }
  }

  frame(dt, frameMs) {
    this.frames++;
    this.acc += dt;
    this.ms = this.ms * 0.9 + frameMs * 0.1;
    if (this.acc >= 0.5) {
      this.fps = this.frames / this.acc;
      this.frames = 0;
      this.acc = 0;
    }
    if (!this.enabled) return;
    this._t -= dt;
    if (this._t <= 0) {
      this._t = 0.2;
      this._renderPanel();
    }
    this._renderLabels();
  }

  _renderPanel() {
    const g = this.game;
    const info = g.renderer.info;
    const d = g.director.debugInfo();
    const p = g.player;
    const indoor = g.world.getIndoorInfo(p.position);
    const aimed = g.npcs.getAimedNPC({ maxDistance: 80, coneDeg: 3 });
    const npcs = g.npcs.list;
    const byState = {};
    for (const n of npcs) if (n.alive) byState[n.state] = (byState[n.state] || 0) + 1;
    const last = d.lastSpawns.map((s) => `${s.type}@${s.sp}${s.cue ? '(' + s.cue + ')' : ''}`).join(', ');
    const P = g.perf;
    const mem = info.memory;
    const L = this._rates();
    const lod = g.npcs.lodStats;
    const sc = skinCacheStats();
    const diff = g.difficulty;
    this.panel.innerHTML = [
      `<b>FPS</b> ${this.fps.toFixed(0)}  <b>ms</b> ${this.ms.toFixed(1)} (갱신 ${P.update.toFixed(2)} · 렌더 ${P.render.toFixed(2)})  <b>draw</b> ${info.render.calls}  <b>tris</b> ${(info.render.triangles / 1000).toFixed(0)}k`,
      `<b>메모리</b> 지오메트리 ${mem.geometries} · 텍스처 ${mem.textures} · 셰이더 ${info.programs ? info.programs.length : '-'} · 스킨 캐시 ${sc.entries}(사용 ${sc.inUse}) · <b>판정/초</b> 시야 ${L.losPerSec.toFixed(0)} · 레이 ${L.rayPerSec.toFixed(0)} · <b>LOD</b> ${lod.full}/${lod.half}/${lod.third}`,
      `<b>그래픽</b> ${g.gfxKey} (후처리 ${g.post.enabled ? g.post.aa : '끔'}) · <b>모드</b> ${diff.mode.label} · ${diff.preset.label} · <b>곡선</b> ${d.curve} · <b>긴장도</b> ${(g.tension || 0).toFixed(2)}`,
      `<b>NPC</b> 적 ${d.counts.enemy}/${d.caps.enemy} · 아군 ${d.counts.ally}/${d.caps.ally} · 민간인 ${d.counts.civilian}/${d.caps.civilian} · 전체 ${npcs.length} · 대기 ${d.pending}`,
      `<b>출현 누계</b> 적 ${d.appearances.enemy} · 아군 ${d.appearances.ally} · 민간인 ${d.appearances.civilian} (${ratio(d.appearances)}) · 크레딧 아군 ${d.credits.ally.toFixed(1)} 민간인 ${d.credits.civilian.toFixed(1)}`,
      `<b>돌발 조우</b> 다음 ${Math.max(0, d.nextAmbush).toFixed(0)}s · 누계 적 ${d.ambushCount.enemy} / 아군 ${d.ambushCount.ally} / 민간인 ${d.ambushCount.civilian}${d.civPanic > 0 ? ` · 민간인 공황 ${d.civPanic.toFixed(0)}s` : ''}`,
      `<b>위장 적</b> 활성 ${d.disguised.active}/${d.disguised.cap} · 누계 아군형 ${d.disguised.spawned.ally} / 민간인형 ${d.disguised.spawned.civilian} · 습격 틈 접근 ${d.disguised.infiltrations} · 습격 요청 ${d.calledAssaults} · 크레딧 ${d.credits.allyFake.toFixed(2)}/${d.credits.civilianFake.toFixed(2)}`,
      `<b>진짜 행동</b> 낙오병 ${d.decoys.straggler} · 동행 ${d.decoys.escort} · 얼어붙음 ${d.decoys.frozen} · 도움 요청 ${d.decoys.helpSeeker} · <b>관찰</b> 사실 ${g.observation.factsFound} / 이상 ${g.observation.anomaliesFound} · 기습당함 ${g.score.ambushedBy}`,
      `<b>페널티</b> 경고 ${g.penalty.warnings} · 아군 피격/사살 ${g.penalty.allyHits}/${g.penalty.allyKills} · 민간인 ${g.penalty.civHits}/${g.penalty.civKills} · 콤보잠금 ${g.score.comboLockT.toFixed(1)}s · 무전두절 ${g.voice.muteRemaining('radio').toFixed(0)}s`,
      `<b>디렉터</b> ${PhaseLabel[d.phase]} (${d.label}) · 긴장도 ${d.intensity.toFixed(2)}`,
      `<b>위협</b> ${d.threat} · 다음 단계까지 ${d.nextLevelIn.toFixed(0)}s`,
      `<b>상태</b> ${Object.entries(byState).map(([k, v]) => `${k}:${v}`).join(' ') || '-'}`,
      `<b>최근 출현</b> ${last || '-'}`,
      `<b>플레이어</b> (${p.position.x.toFixed(1)}, ${(p.position.y - CONFIG.player.radius).toFixed(1)}, ${p.position.z.toFixed(1)}) ${indoor ? `실내 B${indoor.building.id} ${indoor.floor + 1}층` : '실외'}`,
      `<b>조준 NPC</b> ${aimed ? `#${aimed.npc.id} ${aimed.npc.trueFaction} ${aimed.distance.toFixed(1)}m` : '-'}`,
      this._dialogueLine(aimed ? aimed.npc : null),
      `<b>맵</b> 시드 ${g.world.seed} · 생성 ${g.world.genMs.toFixed(0)}ms · 충돌삼각형 ${g.world.collision.triCount} · 내비 ${g.world.nav.activeCount}`,
    ].join('<br>');
  }

  // 4단계: 암구호 상태 + 대화 대상이 아는 정보
  _dialogueLine(aimedNpc) {
    const g = this.game;
    const cs = g.countersign;
    const d = g.dialogue;
    if (!cs || !cs.current) return '<b>암구호</b> -';
    const yn = (v) => (v ? 'O' : 'X');
    const t = d.target || aimedNpc;
    let know = '';
    if (t && t.apparentFaction !== 'enemy') {
      const k = cs.knowledgeOf(t);
      const sk = t.disguise ? ` 위장 숙련${t.disguise.skill}` : '';
      know = ` · <b>${d.target ? '대화' : '조준'} #${t.id}</b>(${t.trueFaction}${sk}) 아는 것: 현재 ${yn(k.current)} · 이전 ${yn(k.previous)} · 기준수 ${yn(k.indoor)} · 부대 ${k.unit || '-'}${t.dialogueFailed ? ' · 문답 실패' : ''}`;
    }
    const st = d.stats;
    return `<b>암구호</b> ${cs.current.challenge}/${cs.current.reply} (이전 ${cs.previous ? cs.previous.challenge + '/' + cs.previous.reply : '-'}) · 기준수 ${cs.indoorBase} · 교체 ${cs.rotations}회${know}` +
      `<br><b>문답</b> 말 걸기 ${st.talks} · 질문 ${st.questions} · 찾아낸 위장 ${st.exposed} · 진짜 확인 ${st.confirmed} · 문답 중 기습 ${st.ambushed}${d.target ? ` · 열림(${d.reaction}, 대기 ${Math.max(0, d.busyT).toFixed(1)}s / 남음 ${Math.max(0, d.idleT).toFixed(1)}s)` : ''}`;
  }

  _renderLabels() {
    const g = this.game;
    const cam = g.camera;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const seen = new Set();
    for (const n of g.npcs.list) {
      seen.add(n.id);
      let el = this.labels.get(n.id);
      if (!el) {
        el = document.createElement('div');
        el.className = 'npc-label';
        this.labelsEl.appendChild(el);
        this.labels.set(n.id, el);
      }
      _v.set(n.position.x, n.position.y + 2.15, n.position.z).project(cam);
      if (_v.z > 1 || _v.z < -1) {
        el.style.display = 'none';
        continue;
      }
      el.style.display = 'block';
      el.style.left = `${((_v.x + 1) / 2) * w}px`;
      el.style.top = `${((1 - _v.y) / 2) * h}px`;
      const app = n.apparentFaction !== n.trueFaction ? `(겉:${n.apparentFaction})` : '';
      let text = `${n.trueFaction}${app}${n.alive ? '' : ' ✝'} · ${n.type || n.kind} · ${n.stateLabel || ''}${n.visibleToPlayer ? ' 👁' : ''}`;
      if (n.disguise) text += disguiseLabel(n);
      if (el.textContent !== text) el.textContent = text;
      el.dataset.faction = n.trueFaction;
    }
    for (const [id, el] of this.labels) {
      if (!seen.has(id)) {
        el.remove();
        this.labels.delete(id);
      }
    }
  }
}
