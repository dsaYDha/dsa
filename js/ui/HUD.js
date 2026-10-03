// HUD — 크로스헤어(탄퍼짐 반영), 히트/킬 마커, 점수 팝업, 체력·탄약·점수·사살·콤보 게이지·위협 단계·생존 시간·킬 로그,
// 피격 비네트 + 방향 표시. 미니맵 없음 (적 위치는 눈과 귀, 아군 무전 콜아웃으로 파악)
// 2단계: 경고 횟수, 콤보 잠금, 오인 사격 피드백(가장자리 플래시·전용 마커·중앙 경고), 나침반(콜아웃 방위용), 무전 자막 영역
// 3단계: 관찰 모드(가장자리 어둡게·관찰 게이지·관찰 메모 — 사실만, 결론 없음), 첫 위장 적·첫 관찰 안내,
//        정체를 드러내는 위장 적 방향 경고, "위장 적 사살!" 피드백
// 4단계: 대화 메뉴(화면 하단, 1~4 — 판정 표시 없음), 암구호 카드(현재 문어/답어·실내 기준수, 교체 직후 20초는 이전 것 취소선,
//        교체 시 깜박임, 설정에서 숨김 가능), 첫 말 걸기·첫 실내 문답 안내, '대상 없음' 안내
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};
const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// 관찰 메모의 대상 설명 — 겉모습만 (결론 없음)
function lookOf(npc) {
  const ap = npc.apparentFaction;
  if (ap === 'ally') return '파란 표식 군인';
  if (ap === 'enemy') return '빨간 표식 군인';
  return npc.rig.outfit.elder ? '사복 차림 노인' : '사복 차림';
}

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('hud');
    this.el = {
      crosshair: $('crosshair'),
      hit: $('hitmarker'),
      kill: $('killmarker'),
      popups: $('popups'),
      score: $('hud-score'),
      kills: $('hud-kills'),
      time: $('hud-time'),
      threat: $('hud-threat'),
      threatPips: $('hud-threat-pips'),
      combo: $('hud-combo'),
      comboMul: $('hud-combo-mul'),
      comboBar: $('hud-combo-bar'),
      killfeed: $('killfeed'),
      hpFill: $('hud-hp-fill'),
      hpText: $('hud-hp-text'),
      ammo: $('hud-ammo'),
      ammoReserve: $('hud-ammo-reserve'),
      reload: $('hud-reload'),
      reloadBar: $('hud-reload-bar'),
      flash: $('hud-flashlight'),
      vignette: $('vignette'),
      lowhp: $('lowhp'),
      dmgDirs: $('damage-dirs'),
      banner: $('banner'),
      hint: $('hud-hint'),
      weaponName: $('hud-weapon'),
      ffFlash: $('ff-flash'),
      ffMarker: $('ffmarker'),
      ffWarning: $('ff-warning'),
      warnPips: $('hud-warn-pips'),
      warnText: $('hud-warn-text'),
      warnings: $('hud-warnings'),
      comboLock: $('hud-combo-lock'),
      comboLockT: $('hud-combo-lock-t'),
      compass: $('compass-strip'),
      obsVignette: $('observe-vignette'),
      obsGauge: $('observe-gauge'),
      obsMemo: $('observe-memo'),
      obsTarget: $('observe-target'),
      obsFacts: $('observe-facts'),
      obsStatus: $('observe-status'),
      obsHint: $('observe-hint'),
      dkill: $('disguise-kill'),
      dlgMenu: $('dialog-menu'),
      dlgTarget: $('dialog-target'),
      dlgOptions: $('dialog-options'),
      dlgTimer: $('dialog-timer-bar'),
      dlgHint: $('dialog-hint'),
      csCard: $('cs-card'),
      csBody: $('cs-body'),
      mode: $('hud-mode'),
      phase: $('hud-phase'),
    };
    // 나침반 눈금 (15도 간격, 8방위 라벨)
    this.compassMarks = [];
    const names = { 0: '북', 45: '북동', 90: '동', 135: '남동', 180: '남', 225: '남서', 270: '서', 315: '북서' };
    for (let a = 0; a < 360; a += 15) {
      const span = document.createElement('span');
      span.textContent = names[a] ?? '·';
      span.className = names[a] ? (a % 90 === 0 ? 'major' : '') : 'tick';
      this.el.compass.appendChild(span);
      this.compassMarks.push({ a, span });
    }
    this.el.weaponName.textContent = CONFIG.weapon.name;
    this.hitT = 0;
    this.killT = 0;
    this.vignette = 0;
    this.dirs = [];
    this._bannerT = 0;
    this._last = {};

    const ev = game.events;
    // 적 명중·사살 마커 (아군·민간인은 오인 사격 전용 피드백)
    ev.on(Events.NPC_DAMAGED, (e) => {
      if (e.attacker !== 'player' || e.trueFaction !== 'enemy') return;
      this.showHit(e.headshot);
      game.audio.hitMarker(e.headshot);
    });
    ev.on(Events.NPC_KILLED, (e) => {
      if (e.attacker === 'player' && e.trueFaction === 'enemy') {
        this.showKill();
        game.audio.kill(e.headshot);
      } else if (e.trueFaction === 'ally' && e.attackerFaction === 'enemy') {
        this.feedRaw('<span class="tag ally">아군</span> 아군 전사', 'bad');
      }
    });
    ev.on(Events.SCORE_KILL, (e) => {
      this.popup(e);
      this.feed(e);
    });
    ev.on(Events.SCORE_EVENT, (e) => {
      this.popupRaw(`<b>+${e.points}</b> ${e.label}`, 'small');
      if (e.kind === 'evac') {
        this.feedRaw(`<span class="tag civ">민간인</span> 대피 성공 <b>+${e.points}</b>`);
        game.audio.evacChime();
      } else this.feedRaw(`<span class="tag ally">아군</span> 사살 어시스트 <b>+${e.points}</b>`);
    });
    ev.on(Events.FRIENDLY_FIRE, (e) => this.showFriendlyFire(e));
    ev.on(Events.PLAYER_DAMAGED, (e) => {
      this.vignette = Math.min(1, this.vignette + e.amount / 22);
      if (e.sourcePosition) this.addDamageDir(e.sourcePosition);
      game.audio.hurt();
    });
    ev.on(Events.THREAT_LEVEL, (e) => {
      if (!this._phaseBannerAt || game.time - this._phaseBannerAt > 1) this.showBanner(`위협 단계 ${e.level}`, '적의 수와 정확도가 올라갑니다');
    });
    // 5단계: 난이도 곡선 구간이 바뀜 (위장 등장·혼전·고강도)
    ev.on(Events.CURVE_PHASE, (e) => {
      this._phaseBannerAt = game.time;
      setTimeout(() => this.showBanner(e.name, e.note), 50);
    });
    // 3단계
    ev.on(Events.DISGUISE_SPAWNED, () => {
      if (this.disguiseHinted) return;
      this.disguiseHinted = true;
      setTimeout(() => this.showBanner('위장 적 주의', '파란 표식·사복이라도 안심하지 마라 — 수상하면 Q(누르고 있기)로 관찰'), 600);
    });
    ev.on(Events.OBSERVE_START, (e) => {
      if (!e.first) return;
      this.el.obsHint.textContent = '대상을 계속 바라보면 사실이 하나씩 메모된다 · 판단은 직접';
      this.el.obsHint.classList.add('show');
      window.clearTimeout(this._obsHintTimer);
      this._obsHintTimer = setTimeout(() => this.el.obsHint.classList.remove('show'), 6000);
    });
    ev.on(Events.DISGUISE_REVEALING, (e) => {
      // 정체를 드러내는 위장 적: 시야 밖이면 방향 경고 (장전음과 함께)
      if (!e.npc.visibleToPlayer && e.npc.position.distanceTo(game.player.feet) < 18) this.addDamageDir(e.npc.position, 'warn');
    });
    // 4단계
    ev.on(Events.COUNTERSIGN_CHANGED, () => {
      this._csKey = '';
      this.csFlashT = 3.2;
    });
    ev.on(Events.DIALOGUE_OPEN, (e) => {
      if (e.firstIndoor) this.showDialogHint('실내 확인 문답: 내가 외친 수 + 상대가 답한 수 = 실내 기준수면 맞는 답 (계산은 직접)');
      else if (e.first) this.showDialogHint('1~4로 질문 · 대답이 맞는지는 직접 판단 · 쏘면 대화가 끝난다 · E 로 닫기');
    });
    ev.on(Events.DISGUISE_KILLED, () => {
      const el = this.el.dkill;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
      game.audio.disguiseKill();
    });
  }

  showDialogHint(text) {
    const el = this.el.dlgHint;
    el.textContent = text;
    el.classList.add('show');
    window.clearTimeout(this._dlgHintTimer);
    this._dlgHintTimer = setTimeout(() => el.classList.remove('show'), CONFIG.dialogue.hintTime * 1000);
  }

  // 4단계 대화 메뉴: 대상(겉모습)·남은 시간·선택지 (판정은 보여주지 않음)
  _updateDialogue() {
    const g = this.game;
    const d = g.dialogue;
    const el = this.el;
    // '대상 없음' 등 짧은 안내
    if (d.notice && g.time - d.notice.t < 1.6) this.setHint(d.notice.text);
    else if (d.notice) {
      if (this._last.hint === d.notice.text) this.setHint('');
      d.notice = null;
    }
    const t = d.target;
    el.dlgMenu.classList.toggle('hidden', !t);
    if (!t) {
      this._dlgKey = '';
      return;
    }
    const opts = d.options();
    const dist = Math.round(t.position.distanceTo(g.player.feet));
    const look = t.apparentFaction === 'civilian' ? (t.rig.outfit.elder ? '사복 차림 노인' : '사복 차림') : '파란 표식 병사';
    const key = `${t.id}|${dist}|${opts.map((o) => `${o.disabled}${o.note}`).join(',')}|${d.busyT > 0}`;
    if (key !== this._dlgKey) {
      this._dlgKey = key;
      el.dlgTarget.textContent = `${look} · ${dist}m${d.busyT > 0 ? ' · 응답 대기' : ''}`;
      el.dlgOptions.innerHTML = opts
        .map((o) => `<div class="opt${o.disabled ? ' off' : ''}"><kbd>${o.slot}</kbd>${esc(o.label)}${o.note ? `<span class="note">${o.note}</span>` : ''}</div>`)
        .join('');
    }
    const frac = d.busyT > 0 ? 1 : Math.max(0, d.idleT / CONFIG.dialogue.menuTimeout);
    el.dlgTimer.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  // 4단계 암구호 카드 (5단계: 난이도 '어려움'은 항상 숨김)
  _updateCountersign(dt) {
    const g = this.game;
    const cs = g.countersign;
    const el = this.el;
    const show = !!g.settings.countersignCard && g.difficulty.cardAllowed && !!cs.current;
    el.csCard.classList.toggle('hidden', !show);
    this.csFlashT = Math.max(0, (this.csFlashT || 0) - dt);
    el.csCard.classList.toggle('flash', this.csFlashT > 0);
    if (!show) return;
    const stale = cs.stale && cs.previous;
    const key = `${cs.current.challenge}|${cs.indoorBase}|${stale}`;
    if (key === this._csKey) return;
    this._csKey = key;
    const prev = stale ? `<div class="prev"><s>문어 ${esc(cs.previous.challenge)} · 답어 ${esc(cs.previous.reply)}</s></div>` : '';
    const prevBase = stale && cs.prevIndoorBase != null ? ` <s>${cs.prevIndoorBase}</s>` : '';
    el.csBody.innerHTML =
      `<div class="row"><span class="k">암구호</span>문어 <b>${esc(cs.current.challenge)}</b> · 답어 <b>${esc(cs.current.reply)}</b></div>${prev}` +
      `<div class="row"><span class="k">실내 기준수</span><b>${cs.indoorBase}</b>${prevBase}</div>`;
  }

  // 오인 사격 피드백: 가장자리 플래시 + 전용 마커 + 효과음 + 중앙 경고 문구
  showFriendlyFire(e) {
    const civ = e.kind === 'civHit' || e.kind === 'civKill';
    const killed = e.kind === 'allyKill' || e.kind === 'civKill';
    for (const el of [this.el.ffFlash, this.el.ffMarker, this.el.ffWarning]) {
      el.classList.toggle('civ', civ);
      el.classList.remove('pop', 'show');
      void el.offsetWidth;
    }
    this.el.ffFlash.classList.add('pop');
    this.el.ffMarker.classList.add('pop');
    const title = civ ? (killed ? '민간인 사망!' : '민간인 피해!') : killed ? '아군 사살!' : '아군 사격!';
    const warn = killed ? ` · 경고 <b>${e.warnings}/${e.maxWarnings}</b>` : '';
    const lock = killed ? ' · 콤보 잠금' : ' · 콤보 초기화';
    this.el.ffWarning.innerHTML = `<div class="t">${title}</div><div class="s"><b>${e.points}</b>${lock}${warn}</div>`;
    this.el.ffWarning.classList.add('show');
    this.game.audio.friendlyFire(killed);
    this.popupRaw(`<b>${e.points}</b> ${title.replace('!', '')}`, 'penalty');
    this.feedRaw(`<span class="tag ff">오인</span> ${title.replace('!', '')} <b>${e.points}</b>`, 'bad');
  }

  popupRaw(html, cls = '') {
    const div = document.createElement('div');
    div.className = `popup ${cls}`;
    div.innerHTML = html;
    this.el.popups.appendChild(div);
    setTimeout(() => div.remove(), 1400);
    while (this.el.popups.children.length > 4) this.el.popups.firstChild.remove();
  }

  feedRaw(html, cls = '') {
    const div = document.createElement('div');
    div.className = `feed ${cls}`;
    div.innerHTML = html;
    this.el.killfeed.prepend(div);
    setTimeout(() => div.classList.add('fade'), 4000);
    setTimeout(() => div.remove(), 4800);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.lastChild.remove();
  }

  show(v) {
    this.root.classList.toggle('hidden', !v);
  }

  reset() {
    this.el.killfeed.innerHTML = '';
    this.el.popups.innerHTML = '';
    this.el.dmgDirs.innerHTML = '';
    this.dirs = [];
    this.vignette = 0;
    this.hitT = this.killT = 0;
    this.el.banner.classList.remove('show');
    this.el.ffWarning.classList.remove('show');
    this.el.dkill.classList.remove('show');
    this.el.obsHint.classList.remove('show');
    this.el.obsMemo.classList.add('hidden');
    this.el.dlgMenu.classList.add('hidden');
    this.el.dlgHint.classList.remove('show');
    this.disguiseHinted = false;
    this._phaseBannerAt = 0;
    this._csKey = '';
    this._dlgKey = '';
    this.csFlashT = 0;
    this._memoKey = '';
    this._last = {};
  }

  showHit(headshot) {
    this.hitT = 0.2;
    this.el.hit.classList.toggle('head', !!headshot);
    this.el.hit.classList.remove('pop');
    void this.el.hit.offsetWidth;
    this.el.hit.classList.add('pop');
  }

  showKill() {
    this.killT = 0.55;
    this.el.kill.classList.remove('pop');
    void this.el.kill.offsetWidth;
    this.el.kill.classList.add('pop');
  }

  popup(e) {
    const div = document.createElement('div');
    div.className = 'popup' + (e.labels.length ? ' bonus' : '');
    const combo = e.combo > 1 ? ` <span class="mul">×${e.combo.toFixed(1)}</span>` : '';
    div.innerHTML = `<b>+${e.points}</b> ${e.labels.join(' · ')}${combo}`;
    this.el.popups.appendChild(div);
    setTimeout(() => div.remove(), 1400);
    while (this.el.popups.children.length > 4) this.el.popups.firstChild.remove();
  }

  feed(e) {
    const div = document.createElement('div');
    div.className = 'feed';
    const v = e.victim;
    const type = v && v.disguise ? '위장 적' : v && v.tcfg ? v.tcfg.label : '적';
    const extras = e.labels.length ? ` <i>${e.labels.join(' · ')}</i>` : '';
    div.innerHTML = `<span class="tag enemy">적</span> ${type} 사살${extras} <b>+${e.points}</b>`;
    this.el.killfeed.prepend(div);
    setTimeout(() => div.classList.add('fade'), 4000);
    setTimeout(() => div.remove(), 4800);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
  }

  // 관찰 모드: 가장자리 어둡게 + 중앙 게이지 + 관찰 메모 (사실만)
  _updateObservation(obs) {
    const el = this.el;
    el.obsVignette.style.opacity = obs.t.toFixed(3);
    const memo = obs.memo();
    const gaugeOn = obs.active && obs.target;
    el.obsGauge.classList.toggle('on', !!gaugeOn);
    if (gaugeOn) el.obsGauge.style.setProperty('--p', `${Math.min(1, obs.progress) * 360}deg`);
    if (!memo) {
      el.obsMemo.classList.add('hidden');
      this._memoKey = '';
      return;
    }
    el.obsMemo.classList.remove('hidden');
    el.obsMemo.classList.toggle('dim', !obs.active);
    el.obsMemo.classList.toggle('outlined', memo.outlined);
    const n = memo.npc;
    const dist = memo.distance != null ? ` · ${Math.round(memo.distance)}m` : '';
    const key = `${n.id}|${memo.facts.length}|${dist}|${memo.status}|${n.alive}`;
    if (key === this._memoKey) return;
    this._memoKey = key;
    el.obsTarget.textContent = `${lookOf(n)}${dist}${n.alive ? '' : ' (쓰러짐)'}`;
    el.obsFacts.innerHTML = memo.facts.length
      ? memo.facts.map((f) => `<li class="${f.anomalous ? 'odd' : ''}">${f.anomalous ? '<b>?</b> ' : ''}${esc(f.text)}</li>`).join('')
      : '<li class="none">아직 알아낸 것 없음</li>';
    el.obsStatus.textContent = memo.status || '';
  }

  addDamageDir(src, cls = '') {
    const div = document.createElement('div');
    div.className = `dmgdir ${cls}`;
    this.el.dmgDirs.appendChild(div);
    this.dirs.push({ div, src: src.clone(), t: 1.4 });
    if (this.dirs.length > 6) {
      const d = this.dirs.shift();
      d.div.remove();
    }
  }

  showBanner(title, sub = '') {
    this.el.banner.innerHTML = `<div class="t">${title}</div><div class="s">${sub}</div>`;
    this.el.banner.classList.remove('show');
    void this.el.banner.offsetWidth;
    this.el.banner.classList.add('show');
  }

  setHint(text) {
    if (this._last.hint !== text) {
      this.el.hint.textContent = text || '';
      this._last.hint = text;
    }
  }

  _set(key, el, value) {
    if (this._last[key] !== value) {
      el.textContent = value;
      this._last[key] = value;
    }
  }

  update(dt) {
    const game = this.game;
    const p = game.player;
    const w = game.weapon;
    const s = game.score;

    // 크로스헤어: 탄퍼짐 각도 → 화면 픽셀
    const spread = THREE.MathUtils.degToRad(w.currentSpread(p));
    const halfFov = THREE.MathUtils.degToRad(game.camera.fov / 2);
    const gap = 3 + (Math.tan(spread) / Math.tan(halfFov)) * (window.innerHeight / 2);
    this.el.crosshair.style.setProperty('--gap', `${Math.min(140, gap).toFixed(1)}px`);
    const obs = game.observation;
    this.el.crosshair.style.opacity = (!p.alive ? 0 : p.sprinting ? 0.15 : (1 - w.adsT * 0.85) * (1 - obs.t)).toFixed(2);
    this._updateObservation(obs);
    this._updateDialogue();
    this._updateCountersign(dt);

    this.hitT = Math.max(0, this.hitT - dt);
    this.killT = Math.max(0, this.killT - dt);

    this._set('score', this.el.score, s.score.toLocaleString('ko-KR'));
    this._set('kills', this.el.kills, `사살 ${s.kills}`);
    // 5단계: 5분 작전은 남은 시간을 거꾸로 셈
    const diff = game.difficulty;
    const dur = diff.mode.duration;
    if (dur > 0) {
      const left = Math.max(0, dur - game.runTime);
      this._set('time', this.el.time, fmtTime(Math.ceil(left)));
      this.el.time.classList.add('countdown');
      this.el.time.classList.toggle('urgent', left < 30);
    } else {
      this._set('time', this.el.time, fmtTime(game.runTime));
      this.el.time.classList.remove('countdown', 'urgent');
    }
    this._set('mode', this.el.mode, `${diff.mode.label} · ${diff.preset.label}`);
    this._set('phase', this.el.phase, game.director.curve ? `▸ ${game.director.curve.name}` : '');
    const lvl = game.director.threat;
    this._set('threat', this.el.threat, `위협 단계 ${lvl}`);
    if (this._last.pips !== lvl) {
      this._last.pips = lvl;
      this.el.threatPips.innerHTML = Array.from({ length: CONFIG.threat.maxLevel }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    }

    // 경고 횟수
    const pen = game.penalty;
    const maxW = CONFIG.penalty.maxWarnings;
    if (this._last.warn !== pen.warnings) {
      this._last.warn = pen.warnings;
      this.el.warnPips.innerHTML = Array.from({ length: maxW }, (_, i) => `<i class="${i < pen.warnings ? 'on' : ''}"></i>`).join('');
      this.el.warnText.textContent = `${pen.warnings}/${maxW}`;
      this.el.warnings.classList.toggle('danger', pen.warnings >= maxW - 1);
    }
    // 콤보 잠금
    this.el.comboLock.classList.toggle('active', s.comboLocked);
    if (s.comboLocked) this._set('lock', this.el.comboLockT, s.comboLockT.toFixed(1));
    // 나침반 (북=-z)
    const fwd = game.camera.matrixWorld.elements;
    const heading = (Math.atan2(-fwd[8], fwd[10]) * 180) / Math.PI;
    const pxPerDeg = 2.2;
    for (const m of this.compassMarks) {
      let off = m.a - heading;
      off = ((off + 540) % 360) - 180;
      if (Math.abs(off) > 62) {
        m.span.style.display = 'none';
        continue;
      }
      m.span.style.display = '';
      m.span.style.left = `${130 + off * pxPerDeg}px`;
    }

    // 콤보
    const comboOn = s.chain > 0 && s.comboTimer > 0;
    this.el.combo.classList.toggle('active', comboOn);
    if (comboOn) {
      this._set('combo', this.el.comboMul, `×${s.combo.toFixed(1)}`);
      this.el.comboBar.style.width = `${(s.comboFraction * 100).toFixed(1)}%`;
    }

    // 체력
    const hp = Math.ceil(p.health);
    const hpFrac = p.health / CONFIG.player.maxHealth;
    this.el.hpFill.style.width = `${(hpFrac * 100).toFixed(1)}%`;
    this.el.hpFill.classList.toggle('low', hpFrac < 0.35);
    this._set('hp', this.el.hpText, String(hp));

    // 탄약
    this._set('ammo', this.el.ammo, String(w.ammo));
    this.el.ammo.classList.toggle('low', w.ammo <= 7);
    this.el.reload.classList.toggle('active', w.reloading);
    if (w.reloading) this.el.reloadBar.style.width = `${(w.reloadProgress * 100).toFixed(1)}%`;
    this.el.flash.classList.toggle('on', p.flashlightOn);
    if (!w.reloading && w.ammo === 0) this.setHint('R 재장전');
    else if (this._last.hint === 'R 재장전') this.setHint('');

    // 피격 비네트 + 저체력
    this.vignette = Math.max(0, this.vignette - dt * 0.9);
    this.el.vignette.style.opacity = Math.min(1, this.vignette * 0.9).toFixed(3);
    const low = hpFrac < 0.35 && p.alive ? (0.35 - hpFrac) / 0.35 : 0;
    this.el.lowhp.style.opacity = (low * (0.65 + Math.sin(game.time * 6) * 0.2)).toFixed(3);

    // 피격 방향
    const cam = game.camera;
    const camYaw = Math.atan2(-cam.matrixWorld.elements[8], -cam.matrixWorld.elements[10]);
    for (let i = this.dirs.length - 1; i >= 0; i--) {
      const d = this.dirs[i];
      d.t -= dt;
      if (d.t <= 0) {
        d.div.remove();
        this.dirs.splice(i, 1);
        continue;
      }
      const ang = Math.atan2(d.src.x - cam.position.x, d.src.z - cam.position.z);
      const rel = -(ang - camYaw);
      d.div.style.transform = `translate(-50%, -50%) rotate(${rel}rad) translateY(-110px)`;
      d.div.style.opacity = Math.min(1, d.t).toFixed(2);
    }
  }
}
