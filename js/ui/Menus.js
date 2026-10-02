// 화면 전환 — 로딩, 시작(제목·조작법·시드·시작 버튼), 일시정지(감도·시야각·볼륨), 결과(점수·통계·최고 기록)
import { CONFIG } from '../config.js';

const $ = (id) => document.getElementById(id);
const fmtTime = (t) => `${Math.floor(t / 60)}분 ${String(Math.floor(t % 60)).padStart(2, '0')}초`;

export class Menus {
  constructor(game) {
    this.game = game;
    this.screens = {
      loading: $('screen-loading'),
      start: $('screen-start'),
      pause: $('screen-pause'),
      result: $('screen-result'),
    };
    this._bind();
  }

  _bind() {
    const g = this.game;
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
    // 일시정지 화면 빈 곳 클릭 → 복귀
    this.screens.pause.addEventListener('click', (e) => {
      if (e.target === this.screens.pause || e.target.classList.contains('click-resume')) g.requestResume();
    });

    // 설정 슬라이더
    const S = g.settings;
    const L = CONFIG.limits;
    const bindSlider = (id, key, fmt, apply) => {
      const el = $(id);
      const out = $(id + '-val');
      el.min = L[key][0];
      el.max = L[key][1];
      el.step = key === 'fov' ? 1 : 0.01;
      el.value = S[key];
      out.textContent = fmt(S[key]);
      el.addEventListener('input', () => {
        S[key] = Number(el.value);
        out.textContent = fmt(S[key]);
        apply && apply(S[key]);
        S.save();
      });
    };
    bindSlider('set-sens', 'sensitivity', (v) => v.toFixed(2));
    bindSlider('set-fov', 'fov', (v) => `${Math.round(v)}°`);
    bindSlider('set-vol', 'volume', (v) => `${Math.round(v * 100)}%`, (v) => g.audio.setVolume(v));

    // 무전·외침 음성 (TTS, 기본 꺼짐)
    const sp = $('set-speech');
    sp.checked = !!S.speech;
    sp.addEventListener('change', () => {
      S.speech = sp.checked;
      S.save();
      if (g.voice) g.voice.setSpeech(S.speech);
      this.updateSpeechNote();
    });
  }

  updateSpeechNote() {
    const v = this.game.voice;
    $('set-speech-note').textContent = v && !v.speechAvailable ? '(한국어 음성 없음 — 자막만 표시)' : '';
  }

  show(name) {
    for (const [k, el] of Object.entries(this.screens)) el.classList.toggle('hidden', k !== name);
  }

  hideAll() {
    for (const el of Object.values(this.screens)) el.classList.add('hidden');
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

  renderBest(records) {
    const el = $('best-record');
    if (!records.games) {
      el.textContent = '아직 기록이 없습니다';
      return;
    }
    el.innerHTML = `최고 점수 <b>${records.bestScore.toLocaleString('ko-KR')}</b> · 최다 사살 <b>${records.bestKills}</b> · 최장 생존 <b>${fmtTime(records.bestTime)}</b>`;
  }

  setPauseNote(text) {
    $('pause-note').textContent = text;
  }

  /**
   * @param r 결과 (ScoreSystem.result + accuracy + 오인 사격 통계 + reason)
   */
  showResult(r, updated, records) {
    const bad = (n) => n > 0;
    const rows = [
      ['점수', r.score.toLocaleString('ko-KR'), updated.score, r.score < 0],
      ['사살', `${r.kills}명`, updated.kills],
      ['헤드샷 비율', `${Math.round(r.headshotRatio * 100)}%`, false],
      ['분당 사살', r.kpm.toFixed(1), false],
      ['최장 콤보', `${r.bestChain}연속 (×${r.bestCombo.toFixed(1)})`, updated.combo],
      ['생존 시간', fmtTime(r.time), updated.time],
      ['즉응 사살', `${r.quickKills}회`, false],
      ['명중률', `${Math.round(r.accuracy * 100)}%`, false],
      ['아군 피격 / 사살', `${r.allyHits} / ${r.allyKills}`, false, bad(r.allyHits + r.allyKills)],
      ['민간인 피격 / 사살', `${r.civHits} / ${r.civKills}`, false, bad(r.civHits + r.civKills)],
      ['대피한 민간인', `${r.evacuated}명`, false],
      ['어시스트', `${r.assists}회`, false],
      ['오인 사격 감점', r.penaltyTotal.toLocaleString('ko-KR'), false, r.penaltyTotal < 0],
      ['경고', `${r.warnings}/${CONFIG.penalty.maxWarnings}`, false, r.warnings > 0],
      ['위장 적 사전 식별 사살', `${r.disguisedKills ?? 0}명${r.evidenceKills ? ` (근거 ${r.evidenceKills})` : ''}`, false],
      ['위장 적에게 기습당함', `${r.ambushedBy ?? 0}회`, false, (r.ambushedBy ?? 0) > 0],
      ['관찰로 찾은 이상 단서', `${r.anomaliesFound ?? 0}개`, false],
    ];
    $('result-stats').innerHTML = rows
      .map(([k, v, best, isBad]) => `<div class="row${isBad ? ' bad' : ''}"><span>${k}</span><b>${v}${best ? ' <em>신기록</em>' : ''}</b></div>`)
      .join('');
    $('result-best').innerHTML = `최고 기록 — 점수 <b>${records.bestScore.toLocaleString('ko-KR')}</b> · 사살 <b>${records.bestKills}</b> · 생존 <b>${fmtTime(records.bestTime)}</b> · 콤보 <b>${records.bestCombo}연속</b>`;
    const dismissed = r.reason === 'dismissed';
    $('result-title').textContent = dismissed ? '작전 해임' : updated.score ? '신기록 달성 — 전사' : '전사';
    $('result-reason').textContent = dismissed
      ? `오인 사격 경고 ${r.warnings}회 누적으로 작전에서 해임되었습니다.`
      : '적의 총격에 쓰러졌습니다.';
    this.show('result');
  }
}

export function randomSeed() {
  const words = ['잿빛', '붉은', '푸른', '무너진', '조용한', '깊은', '마지막', '긴'];
  const nouns = ['거리', '골목', '광장', '시장', '정류장', '교차로', '구역', '항구'];
  const a = words[Math.floor(Math.random() * words.length)];
  const b = nouns[Math.floor(Math.random() * nouns.length)];
  return `${a}-${b}-${Math.floor(Math.random() * 900 + 100)}`;
}
