// 민간인 — 표식 없는 사복, 비무장·민간 신발·맨손(손이 보이는 상태)을 항상 유지 (3단계 위장 판별 기준)
// 상태: 은신(방 구석·가구 옆·차량 뒤, 창밖 엿보기) → 가까운 총성에 웅크림·비명 → 조용해지면 대피로로 이동 → 대피 성공 시 사라짐
// 플레이어가 가까이서 조준하면 움찔하며 손을 들고 "쏘지 마세요!"
// 피해는 플레이어 사격으로만 발생 (NPC 총알은 민간인을 맞히지 않음)
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { NPCBase } from './NPCBase.js';
import { civilianOutfit } from './Outfits.js';
import { gameRand as R } from '../core/Random.js';
import { line } from '../dialogue/Callouts.js';

const S = { ENTER: 'enter', MOVE: 'move', HIDE: 'hide', PEEK: 'peek', COWER: 'cower', FLEE: 'flee', DEAD: 'dead' };
export const CivilianState = S;

const _v = new THREE.Vector3();
let lastScreamLineT = -99; // 비명 자막 전역 간격 (여러 민간인이 동시에 외쳐 자막이 넘치지 않게)

export class CivilianNPC extends NPCBase {
  /**
   * opts: { nodeId, entrance: 'room'|'window'|'cross'|'flee'|'coverPop'|'ambush', goalNode, buildingId }
   */
  constructor(game, opts) {
    super(game, { ...opts, trueFaction: 'civilian', apparentFaction: 'civilian', kind: 'civilian', maxHealth: CONFIG.civilian.health, outfit: opts.outfit || civilianOutfit() });
    const C = CONFIG.civilian;
    this.entrance = opts.entrance || 'room';
    this.goalNode = opts.goalNode ?? null;
    this.buildingId = opts.buildingId ?? -1;
    const mul = this.rig.outfit.elder ? C.elderSpeedMul : 1;
    this.walkSpeed = C.walk * mul * R.range(0.9, 1.1);
    this.runSpeed = C.run * mul * R.range(0.9, 1.1);
    this.state = S.ENTER;
    this.stateT = 0;
    this.moveKind = null;
    this.lastDangerT = -99;
    this.fleeCheckT = R.range(...C.fleeCheck);
    this.calmNeed = R.range(...C.calmBeforeFlee);
    this.cowerT = 0;
    this.peekT = R.range(4, 10);
    this.panic = false;
    this.aimedT = 0;
    this.notAimedT = 99;
    this.shoutT = 0;
    this.hideSpot = null; // 노드에서 조금 떨어진 실제 숨는 위치
    this.fleeBoost = 1;
    this.evacuated = false;
  }

  get stateLabel() {
    return `${this.state}${this.handsUp > 0.5 ? ':손듦' : ''}${this.panic ? ':공황' : ''}`;
  }

  _setState(s) {
    this.state = s;
    this.stateT = 0;
  }

  _say(kind, priority = 1) {
    if (this.shoutT > 0 && priority < 3) return;
    this.shoutT = CONFIG.civilian.shoutCooldown * R.range(0.8, 1.2);
    this.game.voice.say({ speaker: '민간인', text: line(kind), channel: 'civilian', priority, voice: this.voice, force: priority >= 3 });
  }

  _scream() {
    _v.copy(this.position);
    _v.y += 1.5;
    this.game.audio.scream(_v, this.rig.outfit.elder);
  }

  // ------------------------------------------------------------------
  // 외부 자극
  // ------------------------------------------------------------------
  hearDanger(pos, dist) {
    if (!this.alive) return;
    this.lastDangerT = this.game.time;
    if (this.state === S.FLEE && !this.panic) {
      // 대피 중 아주 가까운 총성: 잠깐 웅크리기도
      if (dist < 8 && R.chance(0.3)) this._cowerNow();
      return;
    }
    if (this.state === S.HIDE || this.state === S.PEEK || (this.state === S.MOVE && this.moveKind !== 'flee')) {
      if (!this.panic) this._cowerNow();
    }
  }

  _cowerNow() {
    this.path = null;
    this.cowerT = R.range(...CONFIG.civilian.cowerTime);
    this.cowerCount = (this.cowerCount || 0) + 1;
    this._setState(S.COWER);
    // 비명: 처음엔 거의 항상, 반복될수록 드물게 (같은 사람 6초, 자막은 전체 8초·같은 사람 15초 간격)
    const t = this.game.time;
    if (t - (this.lastScreamT ?? -99) > 6 && R.chance(0.9 / this.cowerCount)) {
      this.lastScreamT = t;
      this._scream();
      if (t - lastScreamLineT > 8 && t - (this.lastScreamLineT ?? -99) > 15) {
        lastScreamLineT = t;
        this.lastScreamLineT = t;
        this._say('civScream');
      }
    }
  }

  // 플레이어가 조준 중 (NPCManager 가 매 판정 주기마다 호출)
  onAimedAt(dt) {
    this.aimedT += dt;
    this.notAimedT = 0;
    if (this.aimedT > CONFIG.civilian.aimReactTime && this.handsUp < 0.1) {
      this.rig.onHit(0); // 움찔
      this._say('civAimed', 2);
    }
  }

  // 근처 민간인 사망 → 공황 (흩어져 뛰기)
  startPanic() {
    if (!this.alive || this.panic) return;
    this.panic = true;
    this.fleeBoost = 1.15;
    this._scream();
    if (R.chance(0.5)) this._say('civPanic', 2);
    this._startFlee(true);
  }

  // 디렉터 요청 (소강 구간 대피 유도)
  encourageFlee() {
    if (this.state === S.HIDE && this.game.time - this.lastDangerT > 2) this._startFlee(false);
  }

  // ------------------------------------------------------------------
  think(dt) {
    const game = this.game;
    const C = CONFIG.civilian;
    this.stateT += dt;
    this.shoutT = Math.max(0, this.shoutT - dt);

    // 조준당하면 손 들기 (이동 정지)
    this.notAimedT += dt;
    if (this.notAimedT > 0.3) this.aimedT = Math.max(0, this.aimedT - dt * 2);
    const wantHands = this.aimedT > C.aimReactTime || (this.handsUp > 0.5 && this.notAimedT < C.handsUpRelease);
    this.handsUp += ((wantHands ? 1 : 0) - this.handsUp) * Math.min(1, dt * 8);
    const frozen = this.handsUp > 0.5;
    if (frozen) {
      this.curSpeed = 0;
      this.cower = Math.max(0, this.cower - dt * 4);
      this.faceTowards(game.player.feet.x, game.player.feet.z);
      if (this.crouchTarget > 0.6) this.crouchTarget = 0.4;
      return;
    }

    switch (this.state) {
      case S.ENTER: this._enter(); break;
      case S.MOVE: this._move(dt); break;
      case S.HIDE: this._hide(dt); break;
      case S.PEEK: this._peek(dt); break;
      case S.COWER: this._cower(dt); break;
      case S.FLEE: this._flee(dt); break;
      default: break;
    }
    const cowerTarget = this.state === S.COWER ? 1 : 0;
    this.cower += (cowerTarget - this.cower) * Math.min(1, dt * 6);
  }

  _enter() {
    const game = this.game;
    switch (this.entrance) {
      case 'window':
        if (this.goalNode != null && this._goTo(this.goalNode, 'window', false)) return;
        this._beginHide();
        return;
      case 'cross':
      case 'ambush': {
        const dest = game.npcs.pickCivilianHideNode(this, this.entrance === 'ambush' ? [6, 16] : [8, 26]);
        if (dest != null && this._goTo(dest, 'hide', true)) return;
        this._startFlee(false);
        return;
      }
      case 'flee':
        this._startFlee(false);
        return;
      case 'coverPop':
        this.crouch = 1;
        this._beginHide();
        return;
      default:
        this._beginHide();
    }
  }

  _goTo(nodeId, kind, run) {
    const path = this.game.world.nav.findPath(this.navNode, nodeId);
    if (!path) return false;
    this.setPath(path);
    this.moveKind = kind;
    this.hideSpot = null;
    this.crouchTarget = 0;
    this._setState(S.MOVE);
    this._run = run;
    return true;
  }

  _move(dt) {
    const speed = this.moveKind === 'flee' ? this.runSpeed * this.fleeBoost : this._run ? this.runSpeed : this.walkSpeed;
    const carryWalk = this.rig.outfit.bag === 'carry' && this.moveKind !== 'flee' ? 0.75 : 1;
    const done = this._followPath(dt, speed * carryWalk);
    if (!done) return;
    this.curSpeed = 0;
    if (this.moveKind === 'flee') this._evacuate();
    else if (this.moveKind === 'window') {
      const n = this.game.world.nav.get(this.goalNode);
      if (n && n.out) this.targetYaw = Math.atan2(n.out.x, n.out.z);
      this.peekT = R.range(2.5, 5.5);
      this._setState(S.PEEK);
    } else this._beginHide();
  }

  _beginHide() {
    const node = this.navNode != null ? this.game.world.nav.get(this.navNode) : null;
    this.crouchTarget = 1;
    this.hideSpot = null;
    // 방 안이면 가구 옆으로 조금 이동해 웅크림
    if (node && node.type === 'room') {
      const b = this.game.world.enterable.find((e) => e.id === node.buildingId);
      const room = b && b.rooms.find((r) => r.nodeId === node.id);
      if (b && room && b.furniture) {
        const f = b.furniture.find((q) => q.floor === node.floor && q.x > room.minX && q.x < room.maxX && q.z > room.minZ && q.z < room.maxZ);
        if (f) {
          _v.set(node.x - f.x, 0, node.z - f.z);
          const len = _v.length();
          if (len > 1.2) {
            _v.multiplyScalar(0.9 / len);
            this.hideSpot = new THREE.Vector3(f.x + _v.x, node.y, f.z + _v.z);
          }
        }
      }
    }
    if (node && node.coverDir) this.targetYaw = Math.atan2(node.coverDir.x, node.coverDir.z);
    this.peekT = R.range(5, 12);
    this._setState(S.HIDE);
  }

  _hide(dt) {
    const C = CONFIG.civilian;
    const game = this.game;
    // 숨는 위치까지 짧게 이동
    if (this.hideSpot) {
      const dx = this.hideSpot.x - this.position.x;
      const dz = this.hideSpot.z - this.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.08) {
        const step = Math.min(d, this.walkSpeed * dt);
        this.position.x += (dx / d) * step;
        this.position.z += (dz / d) * step;
        this.targetYaw = Math.atan2(dx, dz);
        this.curSpeed = this.walkSpeed;
        this.crouchTarget = 0.4;
        return;
      }
      this.curSpeed = 0;
    }
    this.crouchTarget = 1;
    // 가끔 일어나 주변을 살핌
    this.peekT -= dt;
    if (this.peekT <= 0) {
      this.crouchTarget = 0;
      if (this.peekT < -R.range(1.2, 2.2)) this.peekT = R.range(6, 12);
    }
    // 대피 판단: 총성이 그치고 근처에 적이 없으면 틈을 봐서
    this.fleeCheckT -= dt;
    if (this.fleeCheckT <= 0) {
      this.fleeCheckT = R.range(...C.fleeCheck);
      const quietFor = game.time - this.lastDangerT;
      const calm = quietFor > this.calmNeed;
      const lull = game.director && game.director.hostile.phase === 'lull';
      const p = C.fleeChance * (lull ? C.lullFleeMul : 1);
      if (calm && !this._enemyNear(10) && R.chance(p)) this._startFlee(false);
      // 총성이 끊이지 않아도 여러 번 웅크린 뒤엔 잠깐의 틈(1.2초)을 노려 뛰어나감
      else if ((this.cowerCount || 0) >= 3 && quietFor > 1.2 && !this._enemyNear(7) && R.chance(0.5)) this._startFlee(false);
    }
  }

  _peek(dt) {
    // 창밖 엿보기: 서서 바깥을 보다가 창 아래로 웅크림
    this.crouchTarget = 0;
    this.peekT -= dt;
    if (this.peekT <= 0) this._beginHide();
  }

  _cower(dt) {
    this.crouchTarget = 1;
    this.curSpeed = 0;
    this.cowerT -= dt;
    if (this.cowerT <= 0) {
      if (this.panic) this._startFlee(true);
      else this._beginHide();
    }
  }

  _flee(dt) {
    this._move(dt);
  }

  _enemyNear(r) {
    for (const e of this.game.npcs.byFaction('enemy')) if (e.position.distanceToSquared(this.position) < r * r) return true;
    return false;
  }

  _startFlee(panic) {
    const node = this.game.npcs.evacNodeFor(this);
    if (node == null) {
      this._beginHide();
      return;
    }
    if (!this._goTo(node, 'flee', true)) {
      this._beginHide();
      return;
    }
    this.state = S.MOVE;
    if (!panic && R.chance(0.3)) this._say('civFlee');
  }

  _evacuate() {
    if (this.evacuated) return;
    this.evacuated = true;
    this.alive = false;
    this.removed = true;
    this.game.events.emit(Events.CIVILIAN_EVACUATED, { npc: this, position: this.position.clone(), time: this.game.time });
  }

  // ------------------------------------------------------------------
  onDamaged(info) {
    this._scream();
    if (info && info.attacker === 'player') this._say('civHit', 3);
    this.handsUp = 0;
    this.aimedT = 0;
    this.panic = true;
    this.fleeBoost = 1.15;
    this._startFlee(true);
  }

  onDeath() {
    this.state = S.DEAD;
    this._scream();
    this.game.npcs.onCivilianDeath(this);
  }
}
