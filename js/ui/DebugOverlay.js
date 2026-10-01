// 디버그 오버레이 (백틱 ` 키, 기본 꺼짐) — FPS, 종류별 활성 NPC 수, 스폰 디렉터 상태·출현 비율, 페널티, NPC 머리 위 trueFaction 표시
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { PhaseLabel } from '../director/SpawnDirector.js';

const _v = new THREE.Vector3();

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
    this.panel.innerHTML = [
      `<b>FPS</b> ${this.fps.toFixed(0)}  <b>ms</b> ${this.ms.toFixed(1)}  <b>draw</b> ${info.render.calls}  <b>tris</b> ${(info.render.triangles / 1000).toFixed(0)}k`,
      `<b>NPC</b> 적 ${d.counts.enemy}/${d.caps.enemy} · 아군 ${d.counts.ally}/${d.caps.ally} · 민간인 ${d.counts.civilian}/${d.caps.civilian} · 전체 ${npcs.length} · 대기 ${d.pending}`,
      `<b>출현 누계</b> 적 ${d.appearances.enemy} · 아군 ${d.appearances.ally} · 민간인 ${d.appearances.civilian} (${ratio(d.appearances)}) · 크레딧 아군 ${d.credits.ally.toFixed(1)} 민간인 ${d.credits.civilian.toFixed(1)}`,
      `<b>돌발 조우</b> 다음 ${Math.max(0, d.nextAmbush).toFixed(0)}s · 누계 적 ${d.ambushCount.enemy} / 아군 ${d.ambushCount.ally} / 민간인 ${d.ambushCount.civilian}${d.civPanic > 0 ? ` · 민간인 공황 ${d.civPanic.toFixed(0)}s` : ''}`,
      `<b>페널티</b> 경고 ${g.penalty.warnings} · 아군 피격/사살 ${g.penalty.allyHits}/${g.penalty.allyKills} · 민간인 ${g.penalty.civHits}/${g.penalty.civKills} · 콤보잠금 ${g.score.comboLockT.toFixed(1)}s · 무전두절 ${g.voice.muteRemaining('radio').toFixed(0)}s`,
      `<b>디렉터</b> ${PhaseLabel[d.phase]} (${d.label}) · 긴장도 ${d.intensity.toFixed(2)}`,
      `<b>위협</b> ${d.threat} · 다음 단계까지 ${d.nextLevelIn.toFixed(0)}s`,
      `<b>상태</b> ${Object.entries(byState).map(([k, v]) => `${k}:${v}`).join(' ') || '-'}`,
      `<b>최근 출현</b> ${last || '-'}`,
      `<b>플레이어</b> (${p.position.x.toFixed(1)}, ${(p.position.y - CONFIG.player.radius).toFixed(1)}, ${p.position.z.toFixed(1)}) ${indoor ? `실내 B${indoor.building.id} ${indoor.floor + 1}층` : '실외'}`,
      `<b>조준 NPC</b> ${aimed ? `#${aimed.npc.id} ${aimed.npc.trueFaction} ${aimed.distance.toFixed(1)}m` : '-'}`,
      `<b>맵</b> 시드 ${g.world.seed} · 생성 ${g.world.genMs.toFixed(0)}ms · 충돌삼각형 ${g.world.collision.triCount} · 내비 ${g.world.nav.activeCount}`,
    ].join('<br>');
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
      const text = `${n.trueFaction}${app}${n.alive ? '' : ' ✝'} · ${n.type || n.kind} · ${n.stateLabel || ''}${n.visibleToPlayer ? ' 👁' : ''}`;
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
