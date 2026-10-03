// 게임 — 렌더러·씬·시스템을 묶고 상태(로딩/메뉴/진행/일시정지/사망/결과)와 메인 루프를 관리
// 5단계: 난이도(곡선·프리셋)·모드(생존 / 5분 작전), 판 기록(결과 화면 판단 통계), 후처리, 그래픽 프리셋(첫 실행 자동 추천),
//        소리 믹스(덕킹·실내 잔향·긴장 음악·먼 교전 층), 사망 연출, 접근성 설정(색각 보조·자막 크기·흔들림 줄이기·키 설정)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EventBus, Events } from './EventBus.js';
import { Input } from './Input.js';
import { Settings, Records } from './Settings.js';
import { gameRand as R } from './Random.js';
import { World } from '../world/World.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Effects } from '../fx/Effects.js';
import { FX } from '../fx/Particles.js';
import { PostFX } from '../fx/PostFX.js';
import { Player } from '../player/Player.js';
import { Weapon } from '../player/Weapon.js';
import { WeaponView } from '../player/WeaponView.js';
import { NPCManager } from '../npc/NPCManager.js';
import { setColorblindPatterns } from '../npc/Insignia.js';
import { SpawnDirector } from '../director/SpawnDirector.js';
import { ScoreSystem } from '../game/ScoreSystem.js';
import { PenaltySystem } from '../game/PenaltySystem.js';
import { ObservationSystem } from '../game/Observation.js';
import { Difficulty } from '../game/Difficulty.js';
import { RunRecorder } from '../game/RunRecorder.js';
import { Combat } from '../game/Combat.js';
import { VoiceSystem } from '../dialogue/VoiceSystem.js';
import { CountersignSystem } from '../dialogue/Countersign.js';
import { DialogueSystem } from '../dialogue/DialogueSystem.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import * as DisguiseMod from '../npc/Disguise.js';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class Game {
  constructor(container) {
    this.params = new URLSearchParams(location.search);
    this.noLock = this.params.has('nolock'); // 테스트용: 포인터 락 없이 진행
    this.events = new EventBus();
    this.settings = new Settings();
    this.records = new Records();
    this.difficulty = new Difficulty(this);
    this.state = 'loading';
    this.time = 0;
    this.runTime = 0;
    this.perf = { update: 0, render: 0, frame: 0 };

    // 렌더러 (안티에일리어싱은 그래픽 프리셋의 후처리가 담당 — 기본 프레임버퍼는 멀티샘플 없음)
    const r = new THREE.WebGLRenderer({ antialias: CONFIG.render.antialias, powerPreference: 'high-performance' });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, CONFIG.render.maxPixelRatio));
    r.setSize(window.innerWidth, window.innerHeight);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = CONFIG.render.exposure;
    r.autoClear = false;
    r.info.autoReset = false; // 두 패스(월드+총기)를 합산해 디버그에 표시
    r.domElement.id = 'game-canvas';
    container.prepend(r.domElement);
    this.renderer = r;
    this.post = new PostFX(r);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, CONFIG.render.near, CONFIG.render.far);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.input = new Input(r.domElement);
    this.input.forceUnlocked = this.noLock;
    this.audio = new AudioSystem();
    this.world = new World(this.scene);
    // 자막·음성 (독립 모듈 — 4단계 대화에서도 재사용)
    this.voice = new VoiceSystem({ container: document.getElementById('subtitles'), ...CONFIG.voice, onRadio: () => this.audio.radioClick() });
    this.voice.setSpeech(this.settings.speech);
    this.applyAudioSettings();
    this.applyAccessibility();
    this.menus = new Menus(this);
    this.debug = new DebugOverlay(this);

    this.input.onKey = (code) => {
      if (CONFIG.keys.debug.includes(code)) this.debug.toggle();
    };
    this.input.onLockChange = (locked, error) => this._onLockChange(locked, error);
    r.domElement.addEventListener('click', () => {
      if (this.state === 'paused') this.requestResume();
    });
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'playing') this.pause();
    });

    this._disguiseMod = DisguiseMod;
    this._last = performance.now();
    this._menuAngle = 0;
    this._crackleT = 0;
    this.tension = 0;
    this._deadFade = 0;
    this._gfxProbe = null;
  }

  async init() {
    this.menus.show('loading');
    const seed = this.params.get('seed') || this.settings.lastSeed || CONFIG.map.defaultSeed;
    await this._buildWorld(seed);
    this._createSystems();
    // 그래픽: URL(?gfx=low|medium|high) > 저장된 설정 > 첫 실행 자동 추천(메뉴 화면에서 측정, 측정 전엔 '중간')
    const forced = this.params.get('gfx');
    if (CONFIG.graphics[forced]) this.applyGraphics(forced, false);
    else if (this.settings.graphics) this.applyGraphics(this.settings.graphics, false);
    else {
      this.applyGraphics('medium', false);
      this._gfxProbe = { t: 0, n: 0, sum: 0 };
    }
    this.menus.setSeed(seed);
    this.menus.refresh();
    this.menus.show('start');
    this.state = 'menu';
    this.events.emit(Events.GAME_STATE, { state: this.state });
    window.__game = this; // 디버그·테스트용
    requestAnimationFrame((t) => this._loop(t));
  }

  async _buildWorld(seed) {
    this.menus.show('loading');
    await this.world.generate(seed, (t) => this.menus.setLoading(t));
    const atmo = this.world.atmosphere;
    atmo.onDistantExplosion = (dir, delay, strength) => {
      setTimeout(() => {
        _v.set(1, 0, 0).applyQuaternion(this.camera.quaternion);
        this.audio.distantBoom(_v.dot(dir), strength);
      }, delay * 1000);
    };
    if (this.gfx) atmo.setQuality(this.gfx);
    this.settings.lastSeed = seed;
    this.settings.save();
  }

  _createSystems() {
    const atmo = this.world.atmosphere;
    this.effects = new Effects(this.scene, this.world.textures, atmo.fog);
    if (this.player) return; // 시드 변경 재생성 시 나머지는 재사용
    this.combat = new Combat(this);
    this.player = new Player(this);
    this.weapon = new Weapon(this);
    this.weaponView = new WeaponView(this, this.world.textures);
    this.weaponView.setAspect(this.camera.aspect);
    this.weaponView.visible = false;
    this.npcs = new NPCManager(this);
    this.director = new SpawnDirector(this);
    this.score = new ScoreSystem(this);
    this.penalty = new PenaltySystem(this);
    this.observation = new ObservationSystem(this);
    this.countersign = new CountersignSystem(this); // 4단계: 암구호·실내 기준수·아군 부대
    this.dialogue = new DialogueSystem(this); // 4단계: 말 걸기 (E, 1~4)
    this.recorder = new RunRecorder(this); // 5단계: 결과 화면 판단 통계·결정적 순간·타임라인
    this.hud = new HUD(this);

    // 총기 손전등 (월드 조명, 세기만 조절 — 광원 수 고정)
    const F = CONFIG.player.flashlight;
    this.flashlight = new THREE.SpotLight(0xfff1dc, 0, F.range, THREE.MathUtils.degToRad(F.angle), F.penumbra, 2);
    this.scene.add(this.flashlight, this.flashlight.target);

    const ev = this.events;
    ev.on(Events.PLAYER_DIED, () => this._onPlayerDied());
    ev.on(Events.OPERATION_DISMISSED, () => this._onDismissed());
    // 5단계 연출: 근처 탄착 흔들림, 습격 시작·암구호 교체·곡선 구간 신호음
    ev.on(Events.NEAR_IMPACT, (e) => this.player.addShake(e.distance < 1.6 ? 0.3 : 0.18));
    ev.on(Events.DIRECTOR_PHASE, (e) => {
      if (e.phase === 'assault' && this.state === 'playing') this.audio.assaultCue();
    });
    ev.on(Events.COUNTERSIGN_CHANGED, () => {
      if (this.state === 'playing') this.audio.countersignCue();
    });
    ev.on(Events.CURVE_PHASE, () => {
      if (this.state === 'playing') this.audio.phaseCue();
    });
    this.player.reset(this.world.city.playerSpawn, 0);
  }

  // ------------------------------------------------------------------
  // 설정 적용
  // ------------------------------------------------------------------
  /** 그래픽 프리셋 (낮음/중간/높음): 렌더 배율·그림자·파티클·시야 거리·후처리·안티에일리어싱 */
  applyGraphics(key, save = true) {
    const G = CONFIG.graphics[key] || CONFIG.graphics.medium;
    this.gfx = G;
    this.gfxKey = CONFIG.graphics[key] ? key : 'medium';
    if (save) {
      this.settings.graphics = this.gfxKey;
      this.settings.graphicsAuto = false;
      this.settings.save();
    }
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, G.maxPixelRatio) * G.renderScale);
    r.setSize(window.innerWidth, window.innerHeight);
    FX.particles = G.particles;
    this.camera.far = G.viewDistance;
    this.camera.updateProjectionMatrix();
    if (this.world.atmosphere) this.world.atmosphere.setQuality(G);
    if (this.npcs) this.npcs.shadowDist = G.npcShadowDist;
    this.post.configure(G.post, G.aa);
  }

  applyAudioSettings() {
    const S = this.settings;
    this.audio.setVolumes({ master: S.volume, sfx: S.sfxVolume, voice: S.voiceVolume, music: S.musicVolume });
    this.voice.speechVolume = Math.max(0, Math.min(1, S.volume * S.voiceVolume * 1.2));
  }

  applyAccessibility() {
    const S = this.settings;
    setColorblindPatterns(S.colorblind);
    const subs = document.getElementById('subtitles');
    if (subs) subs.dataset.size = S.subtitleSize;
    this.input.rebuildBindings();
  }

  // 첫 실행: 메뉴 화면(도시 위 비행) 평균 FPS 로 그래픽 프리셋 추천 — 셰이더 준비 1.2초 뒤 3초 측정
  _probeGraphics(rawDt) {
    const p = this._gfxProbe;
    if (!p || this.state !== 'menu' || document.hidden) return;
    p.t += rawDt;
    if (p.t < 1.2) return;
    p.n++;
    p.sum += rawDt;
    if (p.t < 4.2) return;
    const fps = p.n / Math.max(0.001, p.sum);
    const A = CONFIG.graphics.autoFps;
    const key = fps >= A.high ? 'high' : fps >= A.medium ? 'medium' : 'low';
    this._gfxProbe = null;
    this.settings.graphicsMeasured = Math.round(fps);
    this.applyGraphics(key, false);
    this.settings.graphics = key;
    this.settings.graphicsAuto = true;
    this.settings.save();
    this.menus.refresh();
  }

  // ------------------------------------------------------------------
  // 상태 전환
  // ------------------------------------------------------------------
  async onStartClicked() {
    if (this.state !== 'menu') return;
    this.audio.init(); // 사용자 제스처 안에서 AudioContext 생성
    this.applyAudioSettings();
    if (!this.noLock) this.input.requestLock(); // 제스처 안에서 요청해야 함
    const seed = this.menus.getSeed();
    if (seed !== this.world.seed) {
      this.state = 'loading';
      this.npcs.clear();
      this.effects.dispose();
      this.world.dispose();
      await this._buildWorld(seed);
      this._createSystems();
    }
    this.startRun();
  }

  startRun() {
    this.difficulty.set(this.settings.difficulty, this.settings.mode);
    this.resetRun();
    this.state = 'playing';
    this.menus.hideAll();
    this.hud.show(true);
    this.weaponView.visible = true;
    this.input.captureKeys = true;
    this.input.clear();
    this.audio.resume();
    this.events.emit(Events.GAME_STATE, { state: this.state });
    this.countersign.start(); // 오늘의 암구호 (작전 무전 + HUD 카드)
    const d = this.difficulty;
    this.hud.showBanner(d.modeKey === 'survival' ? '작전 개시' : `${d.mode.label} 개시`, `${d.mode.label} · ${d.preset.label} — ${this.director.curve.name}: ${this.director.curve.note}`);
    // 포인터 락이 안 걸리면 클릭 안내 화면으로
    if (!this.noLock) {
      setTimeout(() => {
        if (this.state === 'playing' && !this.input.locked) this.pause('화면을 클릭하면 시작합니다');
      }, 900);
    }
  }

  // 새 판: 모든 상태 초기화 (NPC·점수·콤보·경고·암구호·기준수·디렉터·타이머·행동 기록·소리·연출)
  resetRun() {
    this.npcs.clear();
    this.effects.clear();
    this.director.reset();
    this.score.reset();
    this.penalty.reset();
    this.observation.reset();
    this.countersign.reset();
    this.dialogue.reset();
    this.recorder.reset();
    this.voice.clear();
    this.weapon.reset();
    this.weaponView.reset();
    this.hud.reset();
    this.audio.resetRun();
    this.audio.setFocus(0);
    this.runTime = 0;
    this.endReason = null;
    this.tension = 0;
    this._deadFade = 0;
    this._deadT = 0;
    this.post.setState(0, 0, 0, 0);
    const sp = this.world.city.playerSpawn;
    // 가장 긴 도로 방향을 바라보며 시작
    this.player.reset(sp, R.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]));
    this.camera.fov = this.settings.fov;
    this.camera.updateProjectionMatrix();
  }

  pause(note = '') {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.captureKeys = false;
    this.input.clear();
    this.menus.setPauseNote(note);
    this.menus.show('pause');
    this.audio.suspend();
    this.events.emit(Events.GAME_STATE, { state: this.state });
  }

  requestResume() {
    if (this.state !== 'paused') return;
    if (this.noLock) {
      this.resume();
      return;
    }
    if (!this.input.canRelock()) {
      this.menus.setPauseNote('잠시 후 다시 클릭하세요');
      return;
    }
    this.audio.init();
    this.input.requestLock();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.menus.hideAll();
    this.input.captureKeys = true;
    this.input.clear();
    this.audio.resume();
    this._last = performance.now();
    this.events.emit(Events.GAME_STATE, { state: this.state });
  }

  _onLockChange(locked, error) {
    if (this.noLock) return;
    if (!locked && this.state === 'playing') this.pause();
    else if (locked && this.state === 'paused' && this.menus.current === 'pause') this.resume();
    else if (error && this.state === 'playing') this.pause('화면을 클릭하면 시작합니다');
    else if (error && this.state === 'paused') this.menus.setPauseNote('포인터 고정 실패 — 잠시 후 다시 클릭하세요');
  }

  _onPlayerDied() {
    if (this.state !== 'playing') return;
    this.endReason = 'killed';
    this.state = 'dead';
    this._deadT = 0;
    this.input.captureKeys = false;
    this.audio.onDeath(true);
    this.events.emit(Events.RUN_END, { reason: this.endReason });
  }

  // 오인 사격 경고 누적 → 작전 해임 (게임 오버, 전사와 다른 사유)
  _onDismissed() {
    if (this.state !== 'playing') return;
    this.endReason = 'dismissed';
    this.state = 'dead';
    this._deadT = 0;
    this.input.captureKeys = false;
    this.input.mouseDown[0] = false;
    this.audio.onDeath(false);
    this.hud.showBanner('작전 해임', `오인 사격 경고 ${CONFIG.penalty.maxWarnings}회 — 작전에서 해임되었습니다`);
    this.voice.say({ speaker: '지휘부 무전', text: '사격 중지. 귀관을 작전에서 해임한다. 즉시 복귀하라.', channel: 'radio', priority: 3, force: true });
    this.events.emit(Events.RUN_END, { reason: this.endReason });
  }

  // 5분 작전: 시간 종료 → 작전 완료
  _onTimeUp() {
    if (this.state !== 'playing') return;
    this.endReason = 'complete';
    this.state = 'dead';
    this._deadT = 0;
    this.input.captureKeys = false;
    this.input.mouseDown[0] = false;
    this.observation.reset();
    this.dialogue.close('player');
    this.hud.showBanner('작전 완료', `${this.difficulty.mode.label} 종료 — 철수한다`);
    this.voice.say({ speaker: '지휘부 무전', text: '작전 시간 종료. 수고했다, 철수하라.', channel: 'radio', priority: 3, force: true });
    this.events.emit(Events.RUN_END, { reason: this.endReason });
  }

  _finishRun() {
    this.state = 'result';
    this.input.exitLock();
    this.hud.show(false);
    this.weaponView.visible = false;
    const d = this.difficulty;
    const r = this.score.result(this.runTime);
    r.mode = d.modeKey;
    r.difficulty = d.presetKey;
    r.accuracy = this.weapon.shotsFired ? this.weapon.shotsHit / this.weapon.shotsFired : 0;
    r.shotsFired = this.weapon.shotsFired;
    Object.assign(r, this.penalty.stats());
    r.anomaliesFound = this.observation.anomaliesFound;
    r.factsFound = this.observation.factsFound;
    r.observeSessions = this.observation.sessions;
    const ds = this.dialogue.stats;
    r.dialogueQuestions = ds.questions;
    r.dialogueTalks = ds.talks;
    r.dialogueExposed = ds.exposed;
    r.dialogueConfirmed = ds.confirmed;
    r.dialogueAmbushed = ds.ambushed;
    r.reason = this.endReason || 'killed';
    r.threat = this.director.threat;
    r.curve = this.director.curve.name;
    Object.assign(r, this.recorder.summarize(r));
    const updated = this.records.submit(r, d.recordKey);
    this.lastResult = r;
    this.menus.showResult(r, updated, this.records);
    this.audio.resetRun();
    this.events.emit(Events.GAME_STATE, { state: this.state, result: r });
  }

  restart() {
    if (this.state !== 'result') return;
    this.audio.init();
    if (!this.noLock) this.input.requestLock();
    this.startRun();
  }

  toMenu() {
    this.state = 'menu';
    this.input.exitLock();
    this.input.captureKeys = false;
    this.observation.reset();
    this.dialogue.reset();
    this.countersign.reset();
    this.audio.setFocus(0);
    this.audio.resetRun();
    this.npcs.clear();
    this.effects.clear();
    this.voice.clear();
    this.hud.show(false);
    this.weaponView.visible = false;
    this.player.flashlightOn = false;
    this.post.setState(0, 0, 0, 0);
    this.menus.refresh();
    this.menus.show('start');
    this.audio.resume();
    this.events.emit(Events.GAME_STATE, { state: this.state });
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.weaponView) this.weaponView.setAspect(w / h);
    this.post.resize();
  }

  // ------------------------------------------------------------------
  // 메인 루프
  // ------------------------------------------------------------------
  _loop(now) {
    requestAnimationFrame((t) => this._loop(t));
    const t0 = performance.now();
    let dt = (now - this._last) / 1000;
    this._last = now;
    if (!(dt > 0)) dt = 0.016;
    const raw = dt;
    dt = Math.min(dt, 0.05); // 탭 전환·멈칫 뒤 물리·AI 가 크게 튀지 않게

    try {
      switch (this.state) {
        case 'playing':
          this._updatePlaying(dt);
          break;
        case 'dead':
          this._updateDead(dt);
          break;
        case 'paused':
          break;
        default:
          this._updateMenu(dt);
          this._probeGraphics(raw);
      }
      const t1 = performance.now();
      this._render();
      const t2 = performance.now();
      const P = this.perf;
      P.update = P.update * 0.9 + (t1 - t0) * 0.1;
      P.render = P.render * 0.9 + (t2 - t1) * 0.1;
    } catch (err) {
      console.error(err);
      this._showError(err);
    }
    this.input.endFrame();
    this.debug.frame(dt, performance.now() - t0);
  }

  _updatePlaying(dt) {
    this.time += dt;
    this.runTime += dt;
    const p = this.player;
    this.observation.update(dt, this.input); // 관찰 모드 먼저 (이동·감도·사격 가능 여부에 반영)
    this.dialogue.update(dt, this.input); // 말 걸기 (사격하면 WEAPON_FIRED 로 대화가 끝남)
    this.countersign.update(dt);
    p.update(dt, this.input, this.weapon);
    this.weapon.update(dt, this.input, p);
    this._updateFov();
    this.npcs.update(dt);
    this.director.update(dt);
    this.score.update(dt);
    this.voice.update(dt);
    this.recorder.update(dt);
    this._updateCommon(dt);
    this._updateMood(dt);
    // 5분 작전: 시간이 다 되면 작전 완료
    const dur = this.difficulty.mode.duration;
    if (dur > 0 && this.runTime >= dur) this._onTimeUp();
  }

  // 소리 믹스·긴장 음악·심장 박동·후처리 상태
  _updateMood(dt) {
    const p = this.player;
    const obs = this.observation;
    const talk = this.dialogue.open;
    const lowHp = p.alive && p.health < CONFIG.player.maxHealth * 0.3;
    // 긴장도: 위협 단계 + 가까운(30m) 교전 중인 적 + 습격 + 관찰/대화 + 저체력
    const T = CONFIG.audio.tension;
    let v = T.base + T.perThreat * (this.director.threat - 1);
    let near = 0;
    const pf = p.feet;
    for (const e of this.npcs.byApparent('enemy')) if (e.aware && e.position.distanceToSquared(pf) < 30 * 30) near++;
    v += Math.min(T.maxEnemy, near * T.perEnemy);
    if (this.director.hostile.phase === 'assault') v += T.assault;
    if (obs.active || talk) v += T.focus;
    if (lowHp) v += T.lowHp;
    v = Math.min(1, v);
    this.tension += (v - this.tension) * Math.min(1, dt / (v > this.tension ? T.rise : T.fall));
    const a = this.audio;
    a.updateMix({ dt, focus: obs.t * CONFIG.observe.ambientDuck * 2, duck: this.voice.lines.length ? 1 : 0, indoor: this.world.atmosphere.indoorFactor, dead: 0 });
    a.updateMusic(dt, this.tension);
    a.updateBattle(dt, this.director.threat);
    // 심장 박동: 저체력(강하게) / 관찰·대화 중(약하게)
    a.updateHeartbeat(lowHp || obs.active || talk, this.time, !lowHp);
    // 후처리: 저체력이면 채도가 빠지고 가장자리가 붉게 맥동
    const hpFrac = p.health / CONFIG.player.maxHealth;
    const low = p.alive && hpFrac < 0.35 ? (0.35 - hpFrac) / 0.35 : 0;
    const pulse = 0.5 + 0.5 * Math.sin((this.time * Math.PI * 2) / 0.85);
    this.post.setState(low, pulse, 0, this.time);
  }

  // 시야각: 정조준 축소 + 관찰 모드 확대(약 2배)
  _updateFov() {
    const ads = this.settings.fov * (1 - this.weapon.adsT * (1 - CONFIG.weapon.adsFovMul));
    const zoom = 1 + (CONFIG.observe.zoom - 1) * (this.observation ? this.observation.t : 0);
    const fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(ads) / 2) / zoom));
    if (Math.abs(this.camera.fov - fov) > 0.01) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
  }

  _updateDead(dt) {
    this.time += dt;
    this._deadT += dt;
    this.observation.update(dt, this.input);
    this._updateFov();
    this.audio.setFocus(0);
    // 전사면 쓰러지는 시점, 해임·작전 완료면 그대로 멈춤
    if (this.endReason === 'killed') this.player.update(dt, this.input, this.weapon);
    this.npcs.update(dt);
    this.voice.update(dt);
    this._updateCommon(dt);
    // 사망 연출: 회색으로 어두워짐 (해임은 덜, 작전 완료는 없음)
    const target = this.endReason === 'killed' ? 1 : this.endReason === 'dismissed' ? 0.55 : 0;
    this._deadFade += (target - this._deadFade) * Math.min(1, dt * 1.6);
    this.post.setState(0, 0, this._deadFade, this.time);
    this.audio.updateMix({ dt, focus: 0, duck: 0, indoor: this.world.atmosphere.indoorFactor, dead: this._deadFade });
    this.audio.updateMusic(dt, this.endReason === 'complete' ? 0.2 : 0);
    const wait = this.endReason === 'dismissed' ? 3.4 : this.endReason === 'complete' ? 2.6 : 2.4;
    if (this._deadT > wait) this._finishRun();
  }

  _updateCommon(dt) {
    this.effects.update(dt, this.world.atmosphere.wind);
    this.world.update(dt, this.camera, this.player.position);
    this._updateFlashlight();
    this.audio.updateListener(this.camera);
    this.weaponView.update(dt);
    this.hud.update(dt);
    this._ambience(dt);
  }

  _updateFlashlight() {
    const fl = this.flashlight;
    const cam = this.camera;
    fl.intensity = this.player.flashlightOn ? CONFIG.player.flashlight.intensity : 0;
    _v.set(0.18, -0.16, -0.1).applyQuaternion(cam.quaternion).add(cam.position);
    fl.position.copy(_v);
    cam.getWorldDirection(_f);
    fl.target.position.copy(cam.position).addScaledVector(_f, 12);
    fl.target.updateMatrixWorld();
  }

  // 불타는 소리 (먼 교전 소리 층은 AudioSystem.updateBattle)
  _ambience(dt) {
    this._crackleT -= dt;
    if (this._crackleT <= 0) {
      this._crackleT = R.range(0.05, 0.18);
      const pp = this.player.position;
      let best = null;
      let bd = 22 * 22;
      for (const f of this.world.city.fires) {
        const d = (f.x - pp.x) ** 2 + (f.z - pp.z) ** 2;
        if (d < bd) {
          bd = d;
          best = f;
        }
      }
      if (best) this.audio.crackle(_v.set(best.x, best.y, best.z));
    }
  }

  // 메뉴 배경: 도시 위를 천천히 도는 카메라
  _updateMenu(dt) {
    if (!this.world.ready) return;
    this._menuAngle += dt * 0.04;
    const r = 58;
    const cam = this.camera;
    cam.position.set(Math.cos(this._menuAngle) * r, 24, Math.sin(this._menuAngle) * r);
    cam.lookAt(0, 4, 0);
    if (cam.fov !== 60) {
      cam.fov = 60;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld();
    this.world.update(dt, cam, cam.position);
    if (this.effects) this.effects.update(dt, this.world.atmosphere.wind);
    if (this.audio.ready) this.audio.updateMusic(dt, 0.08);
  }

  _render() {
    const r = this.renderer;
    r.info.reset();
    const post = this.post.enabled && this.post.target && this.world.ready;
    r.setRenderTarget(post ? this.post.target : null);
    r.clear();
    if (!this.world.ready) return;
    r.render(this.scene, this.camera);
    if (this.weaponView && this.weaponView.visible && (this.state === 'playing' || this.state === 'paused' || this.state === 'dead')) {
      this.weaponView.render(r);
    }
    if (post) this.post.render();
  }

  _showError(err) {
    const box = document.getElementById('error-box');
    if (!box || box.dataset.shown) return;
    box.dataset.shown = '1';
    box.textContent = '오류가 발생했습니다: ' + (err && err.message ? err.message : err);
    box.classList.remove('hidden');
  }

  // ------------------------------------------------------------------
  // 디버그·테스트 보조
  // ------------------------------------------------------------------
  debugTeleport(x, y, z, yaw) {
    this.player.teleport(x, y, z);
    if (yaw != null) this.player.yaw = yaw;
  }

  /**
   * 테스트용 즉시 생성 (상한·예고음 무시, 플레이어 근처 숨은 출현 지점)
   * kind: 'disguised'(o: { as, skill, role, mode }) | 'ally'(o: { size, decoy }) | 'civilian'(o: { decoy }) | 'enemy'
   * o.at: { x, y, z } 를 주면 그 근처 노드에 생성
   */
  debugSpawn(kind, o = {}) {
    const d = this.director;
    const look = kind === 'disguised' ? o.as || 'ally' : kind;
    let sp;
    if (o.at) {
      const n = this.world.nav.nearest(o.at.x, o.at.y ?? this.player.feet.y, o.at.z, (q) => !q.removed, 12);
      if (!n) return null;
      sp = { x: n.x, y: n.y, z: n.z, nodeId: n.id, buildingId: n.buildingId ?? -1, type: n.type };
    } else sp = d.pickSpawnPoint(look === 'enemy' ? 'rifleman' : look, { distRange: o.distRange || [8, 22] });
    if (!sp) return null;
    if (kind === 'disguised') {
      const { rollDisguiseProfile } = this._disguiseMod;
      const skill = o.skill ?? this.difficulty.rollSkill(R);
      const profile = rollDisguiseProfile(look, Math.max(2, d.threat), { skill, role: o.role || 'ambusher', mode: o.mode });
      return this.npcs.spawnDisguised({ as: look, spawnPoint: sp, entrance: 'walkOut', threat: Math.max(2, d.threat), profile });
    }
    if (kind === 'ally') return this.npcs.spawnAllySquad({ spawnPoint: sp, entrance: 'walkOut', size: o.size || 2, decoy: o.decoy });
    if (kind === 'civilian') return this.npcs.spawnCivilian({ spawnPoint: sp, entrance: o.entrance || 'cross', decoy: o.decoy });
    return this.npcs.spawnEnemy({ type: o.type || 'rifleman', spawnPoint: sp, entrance: 'walkOut', threat: d.threat });
  }
}
