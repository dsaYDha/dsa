// 게임 — 렌더러·씬·시스템을 묶고 상태(로딩/메뉴/진행/일시정지/사망/결과)와 메인 루프를 관리
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { EventBus, Events } from './EventBus.js';
import { Input } from './Input.js';
import { Settings, Records } from './Settings.js';
import { gameRand as R } from './Random.js';
import { World } from '../world/World.js';
import { AudioSystem } from '../audio/AudioSystem.js';
import { Effects } from '../fx/Effects.js';
import { Player } from '../player/Player.js';
import { Weapon } from '../player/Weapon.js';
import { WeaponView } from '../player/WeaponView.js';
import { NPCManager } from '../npc/NPCManager.js';
import { SpawnDirector } from '../director/SpawnDirector.js';
import { ScoreSystem } from '../game/ScoreSystem.js';
import { PenaltySystem } from '../game/PenaltySystem.js';
import { ObservationSystem } from '../game/Observation.js';
import { Combat } from '../game/Combat.js';
import { VoiceSystem } from '../dialogue/VoiceSystem.js';
import { HUD } from '../ui/HUD.js';
import { Menus } from '../ui/Menus.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';

const _v = new THREE.Vector3();
const _f = new THREE.Vector3();

export class Game {
  constructor(container) {
    this.params = new URLSearchParams(location.search);
    this.noLock = this.params.has('nolock'); // 테스트용: 포인터 락 없이 진행
    this.events = new EventBus();
    this.settings = new Settings();
    this.records = new Records();
    this.state = 'loading';
    this.time = 0;
    this.runTime = 0;

    // 렌더러
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

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.settings.fov, window.innerWidth / window.innerHeight, CONFIG.render.near, CONFIG.render.far);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    this.input = new Input(r.domElement);
    this.input.forceUnlocked = this.noLock;
    this.audio = new AudioSystem();
    this.audio.setVolume(this.settings.volume);
    this.world = new World(this.scene);
    // 자막·음성 (독립 모듈 — 4단계 대화에서도 재사용)
    this.voice = new VoiceSystem({ container: document.getElementById('subtitles'), ...CONFIG.voice, onRadio: () => this.audio.radioClick() });
    this.voice.setSpeech(this.settings.speech);
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

    this._last = performance.now();
    this._menuAngle = 0;
    this._gunfireT = 6;
    this._crackleT = 0;
  }

  async init() {
    this.menus.show('loading');
    const seed = this.params.get('seed') || this.settings.lastSeed || CONFIG.map.defaultSeed;
    await this._buildWorld(seed);
    this._createSystems();
    this.menus.setSeed(seed);
    this.menus.renderBest(this.records);
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
    this.hud = new HUD(this);

    // 총기 손전등 (월드 조명, 세기만 조절 — 광원 수 고정)
    const F = CONFIG.player.flashlight;
    this.flashlight = new THREE.SpotLight(0xfff1dc, 0, F.range, THREE.MathUtils.degToRad(F.angle), F.penumbra, 2);
    this.scene.add(this.flashlight, this.flashlight.target);

    this.events.on(Events.PLAYER_DIED, () => this._onPlayerDied());
    this.events.on(Events.OPERATION_DISMISSED, () => this._onDismissed());
    this.player.reset(this.world.city.playerSpawn, 0);
  }

  // ------------------------------------------------------------------
  // 상태 전환
  // ------------------------------------------------------------------
  async onStartClicked() {
    if (this.state !== 'menu') return;
    this.audio.init(); // 사용자 제스처 안에서 AudioContext 생성
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
    this.resetRun();
    this.state = 'playing';
    this.menus.hideAll();
    this.hud.show(true);
    this.weaponView.visible = true;
    this.input.captureKeys = true;
    this.input.clear();
    this.audio.resume();
    this.events.emit(Events.GAME_STATE, { state: this.state });
    // 포인터 락이 안 걸리면 클릭 안내 화면으로
    if (!this.noLock) {
      setTimeout(() => {
        if (this.state === 'playing' && !this.input.locked) this.pause('화면을 클릭하면 시작합니다');
      }, 900);
    }
  }

  resetRun() {
    this.npcs.clear();
    this.effects.clear();
    this.director.reset();
    this.score.reset();
    this.penalty.reset();
    this.observation.reset();
    this.voice.clear();
    this.weapon.reset();
    this.hud.reset();
    this.runTime = 0;
    this.endReason = null;
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
    this.menus.updateSpeechNote();
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
    else if (locked && this.state === 'paused') this.resume();
    else if (error && this.state === 'playing') this.pause('화면을 클릭하면 시작합니다');
    else if (error && this.state === 'paused') this.menus.setPauseNote('포인터 고정 실패 — 잠시 후 다시 클릭하세요');
  }

  _onPlayerDied() {
    if (this.state !== 'playing') return;
    this.endReason = 'killed';
    this.state = 'dead';
    this._deadT = 0;
    this.input.captureKeys = false;
  }

  // 오인 사격 경고 누적 → 작전 해임 (게임 오버, 전사와 다른 사유)
  _onDismissed() {
    if (this.state !== 'playing') return;
    this.endReason = 'dismissed';
    this.state = 'dead';
    this._deadT = 0;
    this.input.captureKeys = false;
    this.input.mouseDown[0] = false;
    this.hud.showBanner('작전 해임', `오인 사격 경고 ${CONFIG.penalty.maxWarnings}회 — 작전에서 해임되었습니다`);
    this.voice.say({ speaker: '지휘부 무전', text: '사격 중지. 귀관을 작전에서 해임한다. 즉시 복귀하라.', channel: 'radio', priority: 3, force: true });
  }

  _finishRun() {
    this.state = 'result';
    this.input.exitLock();
    this.hud.show(false);
    this.weaponView.visible = false;
    const r = this.score.result(this.runTime);
    r.accuracy = this.weapon.shotsFired ? this.weapon.shotsHit / this.weapon.shotsFired : 0;
    Object.assign(r, this.penalty.stats());
    r.anomaliesFound = this.observation.anomaliesFound;
    r.factsFound = this.observation.factsFound;
    r.reason = this.endReason || 'killed';
    const updated = this.records.submit(r);
    this.lastResult = r;
    this.menus.showResult(r, updated, this.records);
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
    this.audio.setFocus(0);
    this.npcs.clear();
    this.effects.clear();
    this.voice.clear();
    this.hud.show(false);
    this.weaponView.visible = false;
    this.player.flashlightOn = false;
    this.menus.renderBest(this.records);
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
    dt = Math.min(dt, 0.05);

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
      }
      this._render();
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
    p.update(dt, this.input, this.weapon);
    this.weapon.update(dt, this.input, p);
    this._updateFov();
    this.npcs.update(dt);
    this.director.update(dt);
    this.score.update(dt);
    this.voice.update(dt);
    this._updateCommon(dt);
    const obs = this.observation;
    this.audio.setFocus(obs.t * CONFIG.observe.ambientDuck * 2);
    this.audio.updateHeartbeat(p.health < CONFIG.player.maxHealth * 0.3 || obs.active, this.time, obs.active && p.health >= CONFIG.player.maxHealth * 0.3);
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
    // 전사면 쓰러지는 시점, 해임이면 그대로 멈춤
    if (this.endReason === 'killed') this.player.update(dt, this.input, this.weapon);
    this.npcs.update(dt);
    this.voice.update(dt);
    this._updateCommon(dt);
    if (this._deadT > (this.endReason === 'dismissed' ? 3.4 : 2.4)) this._finishRun();
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

  // 먼 교전 소리, 불타는 소리
  _ambience(dt) {
    this._gunfireT -= dt;
    if (this._gunfireT <= 0) {
      this._gunfireT = R.range(...CONFIG.atmosphere.distantGunfireInterval);
      this.audio.distantGunfire(R.range(-1, 1));
    }
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
  }

  _render() {
    const r = this.renderer;
    r.info.reset();
    r.clear();
    if (!this.world.ready) return;
    r.render(this.scene, this.camera);
    if (this.weaponView && this.weaponView.visible && (this.state === 'playing' || this.state === 'paused' || this.state === 'dead')) {
      this.weaponView.render(r);
    }
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
}
