// 화면 전환 — 로딩, 시작(모드·난이도·시드·브리핑·조작법), 일시정지, 설정(그래픽·조작·소리·접근성·키), 기록, 결과
// 5단계 결과 화면: 등급(S~D)·칭호·점수·신기록 / 전투 통계 / 판단 통계 / 결정적 순간 3개 / 타임라인 그래프(SVG) / 최근 기록
import { CONFIG } from '../config.js';
import { keyLabel } from '../core/Settings.js';
import { fmtClock } from '../game/RunRecorder.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (t) => `${Math.floor(t / 60)}분 ${String(Math.floor(t % 60)).padStart(2, '0')}초`;
const fmtNum = (n) => Math.round(n).toLocaleString('ko-KR');
const pct = (v) => (v == null ? '-' : `${Math.round(v * 100)}%`);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const REASON = { killed: '전사', dismissed: '작전 해임', complete: '작전 완료' };
const MODE_KEYS = Object.keys(CONFIG.modes);
const DIFF_KEYS = Object.keys(CONFIG.difficulty);

// 조작법 표 (키 설정을 따라 표시)
const CONTROL_ROWS = [
  ['마우스', '시점'], [['forward', 'left', 'back', 'right'], '이동'], [['sprint'], '달리기'], [['crouch'], '앉기'], [['jump'], '점프'],
  ['좌클릭', '사격'], ['우클릭', '정조준'], [['reload'], '재장전'], [['flashlight'], '손전등'], [['observe'], '관찰 (누르고 있기)'],
  [['interact'], '말 걸기 / 닫기'], [['dialog1', 'dialog4'], '질문 선택'], ['Esc', '일시정지'], ['`', '디버그'],
];

export class Menus {
  constructor(game) {
    this.game = game;
    this.screens = {
      loading: $('screen-loading'),
      start: $('screen-start'),
      pause: $('screen-pause'),
      settings: $('screen-settings'),
      records: $('screen-records'),
      result: $('screen-result'),
    };
    this.current = 'loading';
    this.backTo = 'start';
    this._bind();
  }

  _bind() {
    const g = this.game;
    const S = g.settings;
    $('version').textContent = `v${CONFIG.version.split('.').slice(0, 2).join('.')}`;
    $('btn-start').addEventListener('click', () => g.onStartClicked());
    $('btn-seed-random').addEventListener('click', () => {
      $('seed-input').value = randomSeed();
    });
    $('btn-resume').addEventListener('click', (e) => {
      e.stopPropagation();
      g.requestResume();
    });
    $('btn-menu').addEventListener('click', (e) => {
      e.stopPropagation();
      g.toMenu();
    });
    $('btn-restart').addEventListener('click', () => g.restart());
    $('btn-result-menu').addEventListener('click', () => g.toMenu());
    $('btn-open-settings').addEventListener('click', () => this.openSettings('start'));
    $('btn-pause-settings').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openSettings('pause');
    });
    $('btn-settings-back').addEventListener('click', () => this.closeSettings());
    $('btn-open-records').addEventListener('click', () => {
      this.renderRecords();
      this.show('records');
    });
    $('btn-records-back').addEventListener('click', () => this.show('start'));
    // 일시정지 화면 빈 곳 클릭 → 복귀
    this.screens.pause.addEventListener('click', (e) => {
      if (e.target === this.screens.pause || e.target.classList.contains('click-resume')) g.requestResume();
    });

    // 시작 화면: 모드·난이도 (저장)
    this._seg('mode-seg', MODE_KEYS.map((k) => [k, CONFIG.modes[k].label]), () => S.mode, (v) => {
      S.mode = v;
      S.save();
      this.refresh();
    });
    this._seg('diff-seg', DIFF_KEYS.map((k) => [k, CONFIG.difficulty[k].label]), () => S.difficulty, (v) => {
      S.difficulty = v;
      S.save();
      this.refresh();
    });

    // 설정: 그래픽
    this._seg('gfx-seg', Object.keys(CONFIG.graphics).filter((k) => CONFIG.graphics[k].label).map((k) => [k, CONFIG.graphics[k].label]), () => g.gfxKey, (v) => {
      g.applyGraphics(v, true);
      this.refresh();
    });
    // 설정: 슬라이더
    const L = CONFIG.limits;
    const bindSlider = (id, key, fmt, apply) => {
      const el = $(id);
      const out = $(id + '-val');
      el.min = L[key][0];
      el.max = L[key][1];
      el.step = key === 'fov' ? 1 : 0.01;
      const sync = () => {
        el.value = S[key];
        out.textContent = fmt(S[key]);
      };
      sync();
      this._syncers.push(sync);
      el.addEventListener('input', () => {
        S[key] = Number(el.value);
        out.textContent = fmt(S[key]);
        if (apply) apply(S[key]);
        S.save();
      });
    };
    this._syncers = this._syncers || [];
    const pctFmt = (v) => `${Math.round(v * 100)}%`;
    bindSlider('set-sens', 'sensitivity', (v) => v.toFixed(2));
    bindSlider('set-ads', 'adsSensitivity', (v) => `×${v.toFixed(2)}`);
    bindSlider('set-fov', 'fov', (v) => `${Math.round(v)}°`);
    bindSlider('set-vol', 'volume', pctFmt, () => g.applyAudioSettings());
    bindSlider('set-sfx', 'sfxVolume', pctFmt, () => g.applyAudioSettings());
    bindSlider('set-voice', 'voiceVolume', pctFmt, () => g.applyAudioSettings());
    bindSlider('set-music', 'musicVolume', pctFmt, () => g.applyAudioSettings());
    // 설정: 체크
    const bindCheck = (id, key, apply) => {
      const el = $(id);
      const sync = () => {
        el.checked = !!S[key];
      };
      sync();
      this._syncers.push(sync);
      el.addEventListener('change', () => {
        S[key] = el.checked;
        S.save();
        if (apply) apply(el.checked);
      });
    };
    bindCheck('set-shake', 'reduceShake');
    bindCheck('set-speech', 'speech', (v) => {
      g.voice.setSpeech(v);
      this.updateSpeechNote();
    });
    bindCheck('set-colorblind', 'colorblind', () => g.applyAccessibility());
    bindCheck('set-cscard', 'countersignCard');
    this._seg('sub-seg', [['s', '작게'], ['m', '보통'], ['l', '크게']], () => S.subtitleSize, (v) => {
      S.subtitleSize = v;
      S.save();
      g.applyAccessibility();
    });
    // 설정: 키
    $('btn-keys-reset').addEventListener('click', () => {
      g.input.captureNext = null;
      S.resetKeys();
      g.input.rebuildBindings();
      this.renderKeys();
      this.renderControls();
    });
  }

  // 버튼 묶음 (하나만 선택)
  _seg(id, items, get, set) {
    const el = $(id);
    el.innerHTML = items.map(([k, label]) => `<button type="button" data-v="${k}">${esc(label)}</button>`).join('');
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      set(b.dataset.v);
      this._syncSegs();
    });
    this._segs = this._segs || [];
    this._segs.push({ el, get });
  }

  _syncSegs() {
    for (const s of this._segs || []) {
      const v = s.get();
      for (const b of s.el.children) b.classList.toggle('on', b.dataset.v === v);
    }
  }

  /** 시작 화면·설정 표시를 현재 상태에 맞춤 */
  refresh() {
    const g = this.game;
    const S = g.settings;
    this._syncSegs();
    for (const f of this._syncers || []) f();
    const mode = CONFIG.modes[S.mode];
    const diff = CONFIG.difficulty[S.difficulty];
    $('mode-desc').textContent = mode.desc;
    $('diff-desc').textContent = diff.desc;
    this.renderBest(g.records);
    this.renderControls();
    this.updateSpeechNote();
    // 그래픽 안내
    const G = CONFIG.graphics[g.gfxKey] || CONFIG.graphics.medium;
    const parts = [`렌더 ${Math.round(G.renderScale * 100)}%`, G.shadows ? `그림자 ${G.shadowMapSize}` : '그림자 끔', `파티클 ${Math.round(G.particles * 100)}%`, G.post ? '후처리 켬' : '후처리 끔', { none: 'AA 없음', fxaa: 'FXAA', msaa: 'MSAA 4×' }[G.aa]];
    const measured = S.graphicsMeasured != null ? `처음 실행 때 측정 ${S.graphicsMeasured}fps → 자동 추천` : '';
    $('gfx-note').textContent = `${parts.join(' · ')}${S.graphicsAuto && measured ? ` — ${measured}` : ''}`;
    $('gfx-auto-note').textContent = S.graphicsAuto && S.graphicsMeasured != null ? `그래픽: ${G.label} (자동 추천, 측정 ${S.graphicsMeasured}fps) — 설정에서 바꿀 수 있음` : '';
    $('pause-info').textContent = `${CONFIG.modes[g.difficulty.modeKey].label} · ${g.difficulty.preset.label}`;
  }

  updateSpeechNote() {
    const v = this.game.voice;
    $('set-speech-note').textContent = v && !v.speechAvailable ? '(한국어 음성 없음 — 자막만 표시)' : '';
  }

  show(name) {
    this.current = name;
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
  }

  hideAll() {
    this.current = null;
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
  }

  openSettings(from) {
    this.backTo = from;
    this.refresh();
    this.renderKeys();
    this.show('settings');
  }

  closeSettings() {
    this.game.input.captureNext = null;
    this.refresh();
    this.show(this.backTo === 'pause' && this.game.state === 'paused' ? 'pause' : 'start');
  }

  setLoading(text) {
    $('loading-text').textContent = text;
  }

  setSeed(seed) {
    $('seed-input').value = seed;
  }

  getSeed() {
    const v = $('seed-input').value.trim();
    return v || CONFIG.map.defaultSeed;
  }

  // 조작법 (현재 키 설정)
  renderControls() {
    const K = CONFIG.keys;
    const keyOf = (a) => keyLabel(K[a] && K[a][0]);
    $('controls-list').innerHTML = CONTROL_ROWS.map(([keys, what]) => {
      let k;
      if (typeof keys === 'string') k = `<kbd>${esc(keys)}</kbd>`;
      else if (keys.length === 2 && keys[0] === 'dialog1') k = `<kbd>${esc(keyOf('dialog1'))}</kbd>~<kbd>${esc(keyOf('dialog4'))}</kbd>`;
      else k = keys.map((a) => `<kbd>${esc(keyOf(a))}</kbd>`).join('');
      return `<div>${k} ${esc(what)}</div>`;
    }).join('');
    for (const el of document.querySelectorAll('kbd[data-key]')) el.textContent = keyOf(el.dataset.key);
  }

  // 키 설정 목록
  renderKeys() {
    const g = this.game;
    const list = $('keys-list');
    list.innerHTML = Object.entries(CONFIG.rebindable)
      .map(([a, label]) => `<div class="key-row"><span>${esc(label)}</span><button type="button" class="key-btn" data-a="${a}">${esc(CONFIG.keys[a].map(keyLabel).join(' / '))}</button></div>`)
      .join('');
    list.onclick = (e) => {
      const b = e.target.closest('.key-btn');
      if (!b) return;
      for (const x of list.querySelectorAll('.key-btn.wait')) x.classList.remove('wait');
      b.classList.add('wait');
      b.textContent = '키를 누르세요… (Esc 취소)';
      g.input.captureNext = (code) => {
        if (code !== 'Escape' && code !== 'Backquote') {
          const swapped = g.settings.bindKey(b.dataset.a, code);
          g.input.rebuildBindings();
          if (swapped) this._flashKeyNote(`${CONFIG.rebindable[swapped]}와(과) 맞바꿈`);
        }
        this.renderKeys();
        this.renderControls();
      };
    };
  }

  _flashKeyNote(text) {
    const el = document.querySelector('#screen-settings .span2 .hint');
    if (!el) return;
    const orig = el.dataset.orig || el.textContent;
    el.dataset.orig = orig;
    el.textContent = text;
    window.clearTimeout(this._keyNoteT);
    this._keyNoteT = setTimeout(() => (el.textContent = orig), 2500);
  }

  renderBest(records) {
    const el = $('best-record');
    const g = this.game;
    const key = `${g.settings.mode}.${g.settings.difficulty}`;
    const b = records.board(key);
    const tag = `${CONFIG.modes[g.settings.mode].label} · ${CONFIG.difficulty[g.settings.difficulty].label}`;
    if (!b.games) {
      el.innerHTML = `${tag} — 아직 기록이 없습니다`;
      return;
    }
    el.innerHTML = `${tag} 최고 — 점수 <b>${fmtNum(b.bestScore)}</b> · 사살 <b>${b.bestKills}</b> · 생존 <b>${fmtTime(b.bestTime)}</b>${b.bestGrade ? ` · 등급 <b>${b.bestGrade}</b>` : ''} <span class="muted">(${b.games}판)</span>`;
  }

  // 기록 화면: 모드 × 난이도 최고 기록 + 최근 10판
  renderRecords() {
    const R = this.game.records;
    const rows = [];
    for (const m of MODE_KEYS) {
      for (const d of DIFF_KEYS) {
        const b = R.board(`${m}.${d}`);
        rows.push(`<tr><td>${CONFIG.modes[m].label}</td><td>${CONFIG.difficulty[d].label}</td><td class="num">${b.games ? fmtNum(b.bestScore) : '-'}</td><td class="num">${b.games ? b.bestKills : '-'}</td><td class="num">${b.games ? fmtClock(b.bestTime) : '-'}</td><td>${b.bestGrade || '-'}</td><td class="num">${b.games}</td></tr>`);
      }
    }
    $('records-boards').innerHTML = `<table><thead><tr><th>모드</th><th>난이도</th><th>최고 점수</th><th>최다 사살</th><th>최장 생존</th><th>최고 등급</th><th>판</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
    $('records-recent').innerHTML = this._recentTable(R.recent);
  }

  _recentTable(list, highlightFirst = false) {
    if (!list.length) return '<p class="muted">아직 기록이 없습니다</p>';
    const rows = list.map((r, i) => {
      const [m, d] = (r.key || 'survival.normal').split('.');
      const dt = new Date(r.at);
      const when = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      return `<tr class="${highlightFirst && i === 0 ? 'now' : ''}"><td>${when}</td><td>${CONFIG.modes[m] ? CONFIG.modes[m].label : m} · ${CONFIG.difficulty[d] ? CONFIG.difficulty[d].label : d}</td><td class="grade-cell g${r.grade}">${r.grade || '-'}</td><td class="num">${fmtNum(r.score)}</td><td class="num">${r.kills}</td><td class="num">${fmtClock(r.time)}</td><td>${REASON[r.reason] || '-'}</td><td class="num">${pct(r.judgment)}</td></tr>`;
    });
    return `<table><thead><tr><th>날짜</th><th>모드·난이도</th><th>등급</th><th>점수</th><th>사살</th><th>시간</th><th>종료</th><th>판단 정확도</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
  }

  setPauseNote(text) {
    $('pause-note').textContent = text;
    this.refresh();
  }

  // ------------------------------------------------------------------
  // 결과 화면
  // ------------------------------------------------------------------
  /**
   * @param r 결과 (ScoreSystem.result + 정확도 + 오인 사격 + 관찰·문답 + RunRecorder.summarize)
   */
  showResult(r, updated, records) {
    // 머리: 등급·제목·점수·칭호
    const gEl = $('result-grade');
    gEl.textContent = r.grade;
    gEl.className = `grade g${r.grade}`;
    $('result-title').textContent = REASON[r.reason] || '전사';
    $('result-reason').textContent =
      r.reason === 'dismissed' ? `오인 사격 경고 ${r.warnings}회 누적으로 작전에서 해임되었습니다.`
        : r.reason === 'complete' ? '작전 시간을 끝까지 버텼습니다.'
          : '적의 총격에 쓰러졌습니다.';
    $('result-score').textContent = fmtNum(r.score);
    const recs = [];
    if (updated.score) recs.push('최고 점수');
    if (updated.time && r.reason !== 'dismissed' && r.mode === 'survival') recs.push('최장 생존');
    if (updated.kills) recs.push('최다 사살');
    if (updated.grade && !updated.first) recs.push('최고 등급');
    $('result-newrec').textContent = recs.length ? `신기록 — ${recs.join(' · ')}` : '';
    $('result-badge').textContent = r.title;
    $('result-badge-desc').textContent = r.titleDesc;
    $('result-meta').textContent = `${CONFIG.modes[r.mode].label} · ${CONFIG.difficulty[r.difficulty].label} · ${fmtTime(r.time)} · 마지막 위협 단계 ${r.threat} (${r.curve})`;
    // 등급 근거 (네 항목)
    const parts = r.gradeParts;
    const bar = (label, v) => `<div class="part"><span>${label}</span><i><b style="width:${Math.round((v / 25) * 100)}%"></b></i><em>${Math.round(v)}</em></div>`;
    $('result-parts').innerHTML = bar('전투', parts.combat) + bar('판단', parts.judgment) + bar('식별', parts.identify) + bar('생존', parts.survival) + `<div class="part total"><span>합계</span><em>${r.gradeScore} / 100</em></div>`;

    // 전투 통계
    const row = (k, v, bad) => `<div class="row${bad ? ' bad' : ''}"><span>${k}</span><b>${v}</b></div>`;
    $('result-combat').innerHTML = [
      row('사살', `${r.kills}명`),
      row('분당 사살', r.kpm.toFixed(1)),
      row('헤드샷 비율', pct(r.headshotRatio)),
      row('최고 콤보', `${r.bestChain}연속 (×${r.bestCombo.toFixed(1)})`),
      row('즉응 사살', `${r.quickKills}회`),
      row('명중률', pct(r.accuracy)),
      row('어시스트 · 대피한 민간인', `${r.assists}회 · ${r.evacuated}명`),
      row('받은 피해', `${r.damageTaken}`),
    ].join('');
    // 판단 통계
    const ff = r.ffCount;
    $('result-judgment').innerHTML = [
      row('판단 정확도', r.judgmentAccuracy == null ? '-' : `${pct(r.judgmentAccuracy)} (${r.victimsHit - r.wrongHits}/${r.victimsHit}명)`, r.judgmentAccuracy != null && r.judgmentAccuracy < 0.9),
      row('위장 적 사전 식별률', r.preIdRate == null ? '-' : `${pct(r.preIdRate)} (${r.disguisedKills}/${r.disguisedEncountered})`),
      row('근거 있는 판단', `${r.evidenceKills ?? 0}회`),
      row('오인 사격 (아군 · 민간인)', `${r.allyHits + r.allyKills} · ${r.civHits + r.civKills}${ff ? ` (감점 ${fmtNum(r.penaltyTotal)})` : ''}`, ff > 0),
      row('경고', `${r.warnings}/${CONFIG.penalty.maxWarnings}`, r.warnings > 0),
      row('위장 적에게 기습당함', `${r.ambushedBy ?? 0}회`, (r.ambushedBy ?? 0) > 0),
      row('평균 판단 시간', r.avgJudgment == null ? '-' : `${r.avgJudgment.toFixed(2)}초 (처음 보인 뒤 첫 명중)`),
      row('관찰', `${r.observeSessions}회 · 이상 단서 ${r.anomaliesFound}개`),
      row('문답', `말 걸기 ${r.dialogueTalks}회 · 질문 ${r.dialogueQuestions}회 · 가려냄 ${r.dialogueExposed}명`),
    ].join('');
    // 결정적 순간
    $('result-moments').innerHTML = r.moments.length
      ? r.moments.map((m) => `<li><b>${m.clock}</b> — ${esc(m.text)}</li>`).join('')
      : '<li class="muted">특별한 순간 없이 끝났다</li>';
    // 타임라인
    $('result-timeline').innerHTML = timelineSVG(r.timeline);
    // 최근 기록
    $('result-recent').innerHTML = this._recentTable(records.recent.slice(0, CONFIG.result.recentMax), true);
    const b = records.board(`${r.mode}.${r.difficulty}`);
    $('result-best').innerHTML = `${CONFIG.modes[r.mode].label} · ${CONFIG.difficulty[r.difficulty].label} 최고 — 점수 <b>${fmtNum(b.bestScore)}</b> · 사살 <b>${b.bestKills}</b> · 생존 <b>${fmtTime(b.bestTime)}</b> · 콤보 <b>${b.bestCombo}연속</b>${b.bestGrade ? ` · 등급 <b>${b.bestGrade}</b>` : ''}`;
    this.show('result');
    const panel = this.screens.result.querySelector('.panel');
    if (panel) panel.scrollTop = 0;
  }
}

// 타임라인 그래프 (SVG): 점수 선 + 사살(빨강)·위장 적 식별(초록 마름모)·오인 사격(노랑 X)·기습(주황 삼각형)·위협 단계 눈금
function timelineSVG(tl) {
  const W = 760;
  const H = 150;
  const padL = 44;
  const padR = 10;
  const top = 26;
  const bottom = H - 22;
  const T = tl.duration;
  const x = (t) => padL + (Math.min(T, Math.max(0, t)) / T) * (W - padL - padR);
  let lo = 0;
  let hi = 0;
  for (const [, s] of tl.score) {
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  if (hi - lo < 100) hi = lo + 100;
  const y = (s) => bottom - ((s - lo) / (hi - lo)) * (bottom - top - 14);
  const parts = [];
  // 시간 눈금 (1분마다)
  for (let m = 0; m * 60 <= T; m++) {
    const xx = x(m * 60);
    parts.push(`<line x1="${xx}" y1="${top}" x2="${xx}" y2="${bottom}" class="grid"/>`);
    parts.push(`<text x="${xx}" y="${H - 6}" class="axis" text-anchor="middle">${m}:00</text>`);
  }
  // 0점 선
  if (lo < 0) parts.push(`<line x1="${padL}" y1="${y(0)}" x2="${W - padR}" y2="${y(0)}" class="zero"/>`);
  parts.push(`<text x="${padL - 6}" y="${y(hi) + 4}" class="axis" text-anchor="end">${fmtNum(hi)}</text>`);
  parts.push(`<text x="${padL - 6}" y="${y(lo) + 4}" class="axis" text-anchor="end">${fmtNum(lo)}</text>`);
  // 위협 단계·곡선 구간
  for (const e of tl.events) {
    if (e.type === 'threat') parts.push(`<line x1="${x(e.t)}" y1="${top}" x2="${x(e.t)}" y2="${bottom}" class="threat"/>`);
    if (e.type === 'phase') parts.push(`<text x="${x(e.t) + 3}" y="${top + 10}" class="phase">${esc(e.name)}</text>`);
  }
  // 점수 선
  const pts = tl.score.map(([t, s]) => `${x(t).toFixed(1)},${y(s).toFixed(1)}`).join(' ');
  parts.push(`<polyline points="${pts}" class="score"/>`);
  // 사건 표시 (위쪽 띠)
  const lane = top - 12;
  for (const e of tl.events) {
    const xx = x(e.t);
    if (e.type === 'kill') {
      if (e.identified) parts.push(`<path d="M${xx} ${lane - 6} L${xx + 5} ${lane} L${xx} ${lane + 6} L${xx - 5} ${lane} Z" class="ev-id"/>`);
      else parts.push(`<line x1="${xx}" y1="${lane - 5}" x2="${xx}" y2="${lane + 5}" class="ev-kill"/>`);
    } else if (e.type === 'ff') {
      parts.push(`<path d="M${xx - 5} ${lane - 5} L${xx + 5} ${lane + 5} M${xx + 5} ${lane - 5} L${xx - 5} ${lane + 5}" class="ev-ff"/>`);
    } else if (e.type === 'ambush') {
      parts.push(`<path d="M${xx} ${lane - 6} L${xx + 6} ${lane + 5} L${xx - 6} ${lane + 5} Z" class="ev-amb"/>`);
    }
  }
  const legend = '<div class="legend"><span class="l-kill">사살</span><span class="l-id">위장 적 식별</span><span class="l-ff">오인 사격</span><span class="l-amb">기습당함</span><span class="l-score">점수</span><span class="l-threat">위협 단계</span></div>';
  return `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="타임라인">${parts.join('')}</svg>${legend}`;
}

export function randomSeed() {
  const words = ['잿빛', '붉은', '푸른', '무너진', '조용한', '깊은', '마지막', '긴'];
  const nouns = ['거리', '골목', '광장', '시장', '정류장', '교차로', '구역', '항구'];
  const a = words[Math.floor(Math.random() * words.length)];
  const b = nouns[Math.floor(Math.random() * nouns.length)];
  return `${a}-${b}-${Math.floor(Math.random() * 900 + 100)}`;
}
