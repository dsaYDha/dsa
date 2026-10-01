// HUD — 크로스헤어(탄퍼짐 반영), 히트/킬 마커, 점수 팝업, 체력·탄약·점수·사살·콤보 게이지·위협 단계·생존 시간·킬 로그,
// 피격 비네트 + 방향 표시. 미니맵 없음 (적 위치는 눈과 귀, 아군 무전 콜아웃으로 파악)
// 2단계: 경고 횟수, 콤보 잠금, 오인 사격 피드백(가장자리 플래시·전용 마커·중앙 경고), 나침반(콜아웃 방위용), 무전 자막 영역
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (t) => {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
};

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
    ev.on(Events.THREAT_LEVEL, (e) => this.showBanner(`위협 단계 ${e.level}`, '적의 수와 정확도가 올라갑니다'));
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
    const type = e.victim && e.victim.tcfg ? e.victim.tcfg.label : '적';
    const extras = e.labels.length ? ` <i>${e.labels.join(' · ')}</i>` : '';
    div.innerHTML = `<span class="tag enemy">적</span> ${type} 사살${extras} <b>+${e.points}</b>`;
    this.el.killfeed.prepend(div);
    setTimeout(() => div.classList.add('fade'), 4000);
    setTimeout(() => div.remove(), 4800);
    while (this.el.killfeed.children.length > 5) this.el.killfeed.lastChild.remove();
  }

  addDamageDir(src) {
    const div = document.createElement('div');
    div.className = 'dmgdir';
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
    this.el.crosshair.style.opacity = (p.sprinting ? 0.15 : 1 - w.adsT * 0.85).toFixed(2);

    this.hitT = Math.max(0, this.hitT - dt);
    this.killT = Math.max(0, this.killT - dt);

    this._set('score', this.el.score, s.score.toLocaleString('ko-KR'));
    this._set('kills', this.el.kills, `사살 ${s.kills}`);
    this._set('time', this.el.time, fmtTime(game.runTime));
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
