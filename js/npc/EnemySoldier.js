// 적군 — 빨간 표식. 상태 머신 AI (지각·사격은 Soldier 공통)
// 등장 → 엄폐 지점으로 이동 → 시야(시야각·거리·가림)나 총소리로 감지 → 반응 지연 후 사격
// → 맞으면 엄폐 이동 → 시간이 지나면 측면 우회나 돌격
// 유형: rifleman(소총수) / assault(돌격병: 빠른 접근·실내 습격) / window(창문·옥상 사수)
// 대상: 플레이어 우선, 플레이어가 안 보이면 근처 아군 NPC (trueFaction 기준)
// 3단계: opts.disguise(위장 프로필)가 있으면 위장 적 — 정체를 드러내기 전까지 DisguiseController 가 움직이고,
//        드러낸 뒤(apparentFaction = enemy)엔 이 상태 머신으로 싸운다 (근거리 명중률 일시 상승)
// v1.1: · 유효한 엄폐에서만 웅크림 — 엄폐 지점은 위협 기준 레이로 고르고(npcs.findCover), 도착·교전 중에도 그때그때 다시 판정해
//         무효면(측면을 잡힘) 웅크리지 않고 15m 안의 다른 엄폐로 달려가거나(지그재그·불규칙한 속도), 없으면 엄폐 쪽으로 후퇴하거나 옆으로 움직이며 사격
//       · 엄폐 교전: 웅크려 대기 → 1~2초 일어서거나 옆으로 내밀어 점사 → 다시 숨음 (Soldier._coverCycle)
//       · 조준 모델(npc.aim): 명중률 배율, 조준 수렴(가만히 있으면 탄착이 모임 — 움직이거나 가려지면 초기화), 점사 첫 발이 가장 정확, 예측 사격
//       · 조준 회피: 플레이어가 한동안 겨누면 확률로 숨거나 옆으로 비킴 (npcs._updateAim → onAimedByPlayer)
import * as THREE from 'three';
import { CONFIG, lerpThreat, lerpRangeThreat } from '../config.js';
import { Soldier } from './Soldier.js';
import { DisguiseController } from './Disguise.js';
import { gameRand as R } from '../core/Random.js';

const S = {
  ENTER: 'enter',
  MOVE: 'move',
  COVER: 'cover',
  POST: 'post', // 창가·옥상 자리
  ENGAGE: 'engage', // 엄폐 없이 교전 (옆으로 움직이며 사격)
  RUSH: 'rush',
  SEARCH: 'search',
  DEAD: 'dead',
  DISGUISE: 'disguise', // 위장 중 (DisguiseController)
};
export const EnemyState = S;

const _tf = new THREE.Vector3();
const PLAYER_EYE_H = CONFIG.player.standHeight - CONFIG.player.eyeOffset; // 선 플레이어의 눈높이 (1.65m)
const _p1 = new THREE.Vector3();
const _p2 = new THREE.Vector3();

export class EnemySoldier extends Soldier {
  /**
   * opts: { type, threat, entrance, nodeId, goalNode, goalNodes, buildingId, apparentFaction, outfit, disguise }
   */
  constructor(game, opts) {
    super(game, { ...opts, trueFaction: 'enemy', apparentFaction: opts.apparentFaction || 'enemy', kind: opts.type || 'rifleman' });
    this.type = opts.type || 'rifleman';
    this.tcfg = CONFIG.npc.types[this.type];
    this.threat = opts.threat || 1;
    this.entrance = opts.entrance || 'walkOut';
    this.goalNode = opts.goalNode ?? null;
    this.goalNodes = opts.goalNodes || null;
    this.buildingId = opts.buildingId ?? -1;
    this.state = S.ENTER;
    this.postOut = null;
    this.alerted = true; // 디렉터가 투입 — 대략적인 위치는 앎

    this.aggroT = R.range(...CONFIG.npc.aggressionTime);
    this.cycles = 0;
    this.repathT = 0;
    this.searchT = 0;
    this.engageDur = R.range(3.5, 6);
    this.suppressedT = 0;
    this.nearCheckT = R.range(0.6, 1.6);

    // 5단계 난이도 프리셋: 적 반응 지연·명중률 배율
    const diff = game.difficulty;
    this.reactRange = lerpRangeThreat(CONFIG.threat.reactionDelay, this.threat).map((v) => v * (diff ? diff.enemyReaction : 1));
    this.accMul = lerpThreat(CONFIG.threat.accuracyMul, this.threat) * (diff ? diff.enemyAccuracy : 1);
    this.flankChance = lerpThreat(CONFIG.threat.flankChance, this.threat);
    // v1.1 조준 모델: 전체 배율(쉬움은 강화 폭이 절반), 수렴·예측 상태
    this.aimBoostK = diff ? diff.aimBoost : 1;
    this.aimMul = 1 + (CONFIG.npc.aim.enemyMul - 1) * this.aimBoostK;
    this.convT = 0;
    this.convTarget = null;
    this.convRef = new THREE.Vector3();
    this.lostT = 0;
    this.leadFrac = 0;
    // 조준 회피
    this._aimedT = 0;
    this._aimedLast = -9;
    this._evadeCd = 0;
    this._evadeNeed = R.range(...CONFIG.npc.evade.aimTime);

    // 위장 적
    this.disguise = opts.disguise || null;
    this.ctl = null;
    this.hotUntil = -1;
    if (this.disguise) {
      this.ctl = new DisguiseController(this);
      this.state = S.DISGUISE;
    }
  }

  /** 정체를 드러내기 전의 위장 적인지 */
  get disguised() {
    return !!(this.disguise && !this.disguise.revealed);
  }

  get stateLabel() {
    if (this.disguised) return `위장:${this.ctl.mode}`;
    if (this.state === S.COVER || this.state === S.POST) {
      if (this.state === S.POST && this.stepBack) return `post:${this.coverPhase === 'hide' ? 'hide(물러섬)' : 'peek(창가)'}`;
      return `${this.state}:${this.coverPhase}${this.coverPhase === 'peek' && this.peekMode && this.peekMode !== 'up' ? '(' + (this.peekMode === 'left' ? '왼' : '오른') + '쪽)' : ''}`;
    }
    return this.state;
  }

  // 플레이어 우선, 그다음 가까운 아군 NPC (최대 2명)
  candidateTargets() {
    const out = [];
    const game = this.game;
    if (game.player.alive) out.push('player');
    const allies = game.npcs.byFaction('ally');
    if (allies.length) {
      const near = [];
      for (const a of allies) {
        const d = a.position.distanceToSquared(this.position);
        if (d < 50 * 50) near.push({ a, d });
      }
      near.sort((p, q) => p.d - q.d);
      for (let i = 0; i < Math.min(2, near.length); i++) out.push(near[i].a);
    }
    return out;
  }

  // v1.1 위협: 지금 싸우는 아군 NPC(보고 있거나 방금까지 봄), 아니면 플레이어
  // 플레이어는 '선 눈높이'로 본다 — 플레이어가 잠깐 웅크렸다고 적의 엄폐 판정이 바뀌지 않게
  // (웅크린 플레이어를 못 보는 자리를 모두 무효로 치면 적이 늘 측면으로 돌아 플레이어의 엄폐가 의미 없어짐)
  threatEye(out) {
    const t = this.target;
    if (t && t !== 'player' && t.alive && this.aware && (this.hasLOS || this.game.time - this.lastLOST < 3)) return t.getEyePosition(out);
    const f = this.game.player.feet;
    return out.set(f.x, f.y + PLAYER_EYE_H, f.z);
  }

  rollDamage(target) {
    const base = CONFIG.npc.hitDamage[this.type] || 8;
    if (target === 'player') return { amount: base, zone: 'torso' };
    return { amount: base * CONFIG.npc.damageVsNpcMul, zone: 'torso' };
  }

  // ------------------------------------------------------------------
  // v1.1 조준 모델 — 전체 배율 × 거리 × 점사 순번(첫 발 최고) × 수렴 × (움직이는 대상: 예측으로 감점 일부 상쇄)
  // ------------------------------------------------------------------
  _convFactor() {
    const C = CONFIG.npc.aim.converge;
    const k = this.aimBoostK;
    const start = 1 - (1 - C.start) * k;
    const max = 1 + (C.max - 1) * k;
    return start + (max - start) * Math.min(1, this.convT / C.time);
  }

  // 같은 대상을 계속 겨누면 수렴 (대상이 움직이거나 가려지면 초기화 — 내가 숨어 있는 동안은 멈춤)
  _updateConvergence(dt) {
    const C = CONFIG.npc.aim.converge;
    const t = this.target;
    if (!t || !this.aware) {
      this.convT = 0;
      this.convTarget = null;
      return;
    }
    if (t !== this.convTarget) {
      this.convTarget = t;
      this.convT = 0;
      this.targetFeet(t, this.convRef);
    }
    if (!this.hasLOS) {
      if (!(this.inCoverSpot && this.coverPhase === 'hide')) {
        this.lostT += dt;
        if (this.lostT > C.lostReset) this.convT = 0;
      }
      return;
    }
    this.lostT = 0;
    this.targetFeet(t, _tf);
    const speed = t === 'player' ? this.game.player.speed : t.curSpeed;
    if (speed > C.speedReset || _tf.distanceTo(this.convRef) > C.moveReset) {
      this.convT = 0;
      this.convRef.copy(_tf);
      return;
    }
    if (!(this.inCoverSpot && this.coverPhase === 'hide')) this.convT += dt;
  }

  _hitChance(dist, target) {
    const N = CONFIG.npc;
    const A = N.accuracy;
    const AIM = N.aim;
    let acc = this._baseHitChance(dist, AIM) * this.aimMul * this._convFactor();
    if (target === 'player') {
      const p = this.game.player;
      // 예측 사격: 같은 방향으로 꾸준히 움직이면 이동 감점을 일부 상쇄 (방향을 꺾으면 다시 감점 전부)
      this.leadFrac = p.speed > 1 ? Math.min(1, p.moveSteadyT / AIM.lead.time) : 0;
      const comp = AIM.lead.comp * this.aimBoostK * this.leadFrac;
      acc *= 1 - A.moveFactor * Math.min(1, p.speed / CONFIG.player.sprintSpeed) * (1 - comp);
      if (p.crouching) acc *= A.crouchFactor;
    } else {
      this.leadFrac = 0;
      if (target.curSpeed > 0.5) acc *= 0.75;
      if (target.crouch > 0.5) acc *= 0.7;
    }
    // 정체를 드러낸 직후: 근거리 기습이라 명중률이 높다 (같은 전체 배율 위에)
    if (this.game.time < this.hotUntil) acc *= CONFIG.disguise.ambush.accuracyMul;
    acc = Math.min(AIM.max, acc);
    return target === 'player' ? acc : acc * N.accuracyVsNpc;
  }

  // 총소리: 진짜 적 소총(굽은 탄창)과 아군 소총(직선 탄창)은 음색이 다르다
  gunSound(pos) {
    if (this.rig.outfit.rifleStyle === 'straight') this.game.audio.allyGunshot(pos);
    else this.game.audio.enemyGunshot(pos);
  }

  // 위장 중 자극 (NPCManager 가 호출)
  onGunfire(pos, dist) {
    if (this.disguised) this.ctl.onGunfire(pos, dist);
  }

  onAimedAt(step) {
    if (this.disguised) this.ctl.onAimedAt(step);
  }

  onRadioCallout(enemy) {
    if (this.disguised) this.ctl.onRadioCallout(enemy);
  }

  // 플레이어 총성 청취
  hearShot(pos) {
    if (!this.alive || this.disguised) return;
    this.lastKnown.copy(pos);
    this.lastKnown.y -= 1.6;
    if (!this.aware) {
      this.aware = true;
      this.target = 'player';
      this.reactT = R.range(this.reactRange[0], this.reactRange[1]) + 0.25;
    }
  }

  // 아군 탄이 가까이 지나감 → 엄폐 중이면 더 오래 숨음 (무효한 엄폐면 _coverCycle 이 웅크리지 않음)
  onSuppressed() {
    this.suppressedT = 1.5;
    if ((this.state === S.COVER || this.state === S.POST) && this.coverPhase === 'peek' && R.chance(0.45)) this._hideNow([1.2, 2.4]);
  }

  // v1.1 조준 회피: 플레이어가 이 적을 한동안 겨누면(0.1초마다 호출) 확률로 숨거나 옆으로 비킴 — 플레이어를 보고 있을 때만
  onAimedByPlayer(step) {
    if (this.disguised || !this.alive) return;
    const E = CONFIG.npc.evade;
    const t = this.game.time;
    if (t - this._aimedLast > 0.25) this._aimedT = 0;
    this._aimedLast = t;
    this._aimedT += step;
    if (!this.hasLOS || this.target !== 'player' || t < this._evadeCd || this._aimedT < this._evadeNeed) return;
    this._evadeCd = t + R.range(E.cooldown[0], E.cooldown[1]);
    this._evadeNeed = R.range(E.aimTime[0], E.aimTime[1]);
    if (!R.chance(E.chance)) return;
    if ((this.state === S.COVER || this.state === S.POST) && this.coverPhase === 'peek' && this.coverOK) {
      this._hideNow([1.0, 2.0]);
      this.stateReason = '조준당함 → 숨음';
    } else if (this.state === S.ENGAGE) {
      // 옆으로 비킴: 지금 가던 쪽 반대로 곧바로
      this.strafeSide = -this.strafeSide;
      this.path = null;
      this.strafePauseT = 0;
      this.stateReason = '조준당함 → 옆으로 비킴';
    } else if (this.state === S.POST && this.coverPhase === 'peek') {
      this._hideNow([1.0, 2.0]);
      this.stateReason = '조준당함 → 숨음';
    } else if (this.state === S.MOVE || this.state === S.RUSH) {
      // 달리는 중: 지그재그 방향을 홱 뒤집고 잠깐 더 빨리 (juke)
      if (this._wvPh != null) this._wvPh += Math.PI;
      this.jukeT = 0.6;
    }
  }

  // ------------------------------------------------------------------
  think(dt) {
    if (this.disguised) {
      this.stateT += dt;
      this.ctl.update(dt);
      return;
    }
    this._tickPerception(dt);
    this.suppressedT = Math.max(0, this.suppressedT - dt);
    this._updateConvergence(dt);
    // 위협 아래 이동은 지그재그·불규칙한 속도 (위협을 최근에 봤을 때, 실외)
    this.weave = this.state === S.MOVE && this.aware && this.game.time - this.lastLOST < 4 && this.goalKind !== 'post' ? CONFIG.npc.cover.zigzag.amp : 0;

    switch (this.state) {
      case S.ENTER: this._enter(); break;
      case S.MOVE: this._move(dt); break;
      case S.COVER: this._cover(dt); break;
      case S.POST: this._post(dt); break;
      case S.ENGAGE: this._engage(dt); break;
      case S.RUSH: this._rush(dt); break;
      case S.SEARCH: this._search(dt); break;
      default: break;
    }

    const turn = this.state !== S.MOVE || this.hasLOS ? this.curSpeed < 0.1 || this.type === 'assault' || this.hasLOS : false;
    this._aimAtTarget(turn);
    if (this.state === S.MOVE && this.hasLOS && this.aware && (this.type === 'assault' || this._targetDist() < 12)) this.aimTarget = 0.8;
    this._shooting(dt);
    this._enforceCrouch();
  }

  _targetDist() {
    if (!this.target) return Infinity;
    return this.position.distanceTo(this.target === 'player' ? this.game.player.feet : this.target.position);
  }

  _enter() {
    const mgr = this.game.npcs;
    switch (this.entrance) {
      case 'coverPop': {
        // 엄폐물 뒤에 웅크린 채 생성 → 잠시 뒤 튀어나옴 (v1.1: 그 자리가 지금 위협에 대해 유효한 엄폐일 때만 웅크림)
        const n = this.game.world.nav.get(this.navNode);
        this._enterCoverSpot(n.x, n.y, n.z);
        if (!this._evalCover(true).valid) {
          this.crouch = 0;
          this.crouchTarget = 0;
          this._takeCover('엄폐물 뒤 등장 — 그 자리가 노출됨');
          break;
        }
        this.coverNode = n;
        n.reservedBy = this;
        this.crouchTarget = 1;
        this.crouch = 1;
        this.coverPhase = 'hide';
        this.phaseT = R.range(0.6, 1.6);
        if (n.coverDir) this.targetYaw = this.yaw = Math.atan2(n.coverDir.x, n.coverDir.z);
        this._setState(S.COVER, '엄폐물 뒤에서 등장');
        break;
      }
      case 'window':
      case 'roof': {
        const goal = this.entrance === 'window' ? this.goalNode : mgr.pickPostNode(this, this.goalNodes);
        if (goal != null && this._goTo(goal, 'post', false, '창가·옥상 자리로')) break;
        this._goToCover(true, false, '등장 → 엄폐로');
        break;
      }
      case 'ambush':
        // 돌발 조우: 바로 플레이어에게 접근
        this._startRush('돌발 조우 → 돌격');
        break;
      default:
        if (this.type === 'assault') this._startRush('등장 → 돌격');
        else this._goToCover(true, false, '등장 → 엄폐로');
    }
  }

  // 엄폐 지점으로 (위협 기준 판정을 통과한 곳만). 없으면 뚫린 곳 대처(_takeCover 와 같은 순서)
  _goToCover(advance = false, flank = false, reason = '엄폐 찾기') {
    this._releaseCover();
    const mgr = this.game.npcs;
    const node = mgr.findCover(this, { advance, flank });
    if (node) {
      node.reservedBy = this;
      this.coverNode = node;
      if (this._goTo(node.id, 'cover', true, reason)) return true;
      node.reservedBy = null;
      this.coverNode = null;
    }
    // 엄폐물이 없으면: 가까운 모퉁이 등 → 위협 반대쪽 엄폐로 후퇴 → 멀면 접근, 가까우면 옆으로 움직이며 사격
    if (this._takeCover(`${reason} — 엄폐 노드 없음`, true)) return true;
    const near = mgr.nearestNodeToPlayer(this, 14);
    if (this._targetDist() > 20 && near != null && this._goTo(near, 'engage', true, `${reason} — 엄폐 없음, 접근`)) return true;
    this._enterEngage(`${reason} — 엄폐 없음, 옆으로 이동 사격`);
    return false;
  }

  /**
   * 뚫린 곳에서 위협을 받음 → 웅크리지 않고: 15m 안 유효 엄폐(모퉁이 포함)로 달려감 → 없으면 위협 반대쪽 엄폐로 후퇴
   * → 그것도 없으면 옆으로 움직이며 사격. quiet: 찾지 못해도 교전 상태로 바꾸지 않음 (호출한 쪽이 정함)
   */
  _takeCover(reason, quiet = false) {
    const mgr = this.game.npcs;
    const C = CONFIG.npc.cover;
    const prev = this.coverNode;
    this._releaseCover();
    let node = mgr.findCover(this, { maxDist: C.nearRadius, exclude: prev, anyNode: true });
    let why = '가까운 엄폐로';
    if (!node) {
      node = mgr.findCover(this, { maxDist: C.retreatRadius, retreat: true, exclude: prev });
      why = '엄폐 쪽으로 후퇴';
    }
    if (node) {
      node.reservedBy = this;
      this.coverNode = node;
      if (this._goTo(node.id, 'cover', true, `${reason} → ${why}`)) return true;
      node.reservedBy = null;
      this.coverNode = null;
    }
    if (!quiet) this._enterEngage(`${reason} → 엄폐 없음, 옆으로 이동 사격`);
    return false;
  }

  _startRush(reason = '돌격') {
    this._releaseCover();
    const target = this.game.npcs.playerNode();
    if (target == null || !this._goTo(target, 'rush', true)) {
      this._goToCover(true, false, `${reason} 실패 → 엄폐로`);
      return;
    }
    this._setState(S.RUSH, reason);
    this.repathT = 2.0;
    this._rushTarget = target;
  }

  _move(dt) {
    this.jukeT = Math.max(0, (this.jukeT || 0) - dt);
    const done = this._followPath(dt, this.moveSpeed * (this.jukeT > 0 ? 1.25 : 1));
    if (!done) return;
    this.curSpeed = 0;
    if (this.goalKind === 'cover' && this.coverNode) {
      const n = this.coverNode;
      this._enterCoverSpot(n.x, n.y, n.z);
      // 도착 순간 위협 기준으로 다시 판정 — 그사이 위협이 움직였으면 웅크리지 않고 다른 곳으로
      if (!this._evalCover(true).valid) {
        this._coverLost('엄폐 도착 — 위협이 움직여 노출됨');
        return;
      }
      this.crouchTarget = 1;
      this.coverPhase = 'hide';
      this.phaseT = R.range(0.4, 1.0);
      if (n.coverDir) this.targetYaw = Math.atan2(n.coverDir.x, n.coverDir.z);
      this._setState(S.COVER, '엄폐 도착 (유효)');
    } else if (this.goalKind === 'post') {
      const n = this.game.world.nav.get(this.goalNode);
      this.postOut = n.out;
      this.stepBack = false;
      if (n.out) this.targetYaw = Math.atan2(n.out.x, n.out.z);
      this._enterCoverSpot(n.x, n.y, n.z);
      this.coverPhase = 'hide';
      this.phaseT = R.range(0.3, 0.9);
      this._setState(S.POST, '창가·옥상 도착');
    } else if (this.goalKind === 'search') {
      this.searchT = R.range(2.5, 4.5);
      this._setState(S.SEARCH, '마지막 위치 수색');
    } else {
      this._enterEngage('접근 끝 → 교전');
    }
  }

  _enterEngage(reason = '교전') {
    this.stepBack = false;
    this._releaseCover();
    this._leaveCoverSpot();
    this.engageDur = R.range(3.5, 6);
    this.path = null;
    this.strafePauseT = R.range(0.1, 0.5);
    this.nearCheckT = CONFIG.npc.cover.strafe.nearCheck;
    this._setState(S.ENGAGE, reason);
  }

  // 엄폐가 무효가 됨 (측면을 잡힘·도착했더니 노출) — 웅크리지 않고 다시 판단
  _coverLost(reason) {
    this.crouchTarget = 0;
    if (this._targetDist() < 7) {
      this._enterEngage(`${reason} → 근접 교전`);
      return;
    }
    this._takeCover(reason);
  }

  // 엄폐: 숨기 ↔ 일어서거나 옆으로 내밀어 사격
  //  · 측면을 잡힘(웅크려도 보임): 웅크리지 않고 잠깐(exposedGrace) 맞서 쏜 뒤 다른 엄폐로 — 잠깐 스치는 판정 흔들림에 자리를 버리지 않게
  //  · 가려졌지만 여기선 위협이 안 보임(위협이 숨음): 웅크리지 않고 선 채 기다리다(blindMove) 자리 이동
  _cover(dt) {
    this.aggroT -= dt;
    const C = CONFIG.npc.cover;
    const e = this._evalCover();
    if (!e.protected) {
      this.crouchTarget = 0;
      this.aimTarget = 1;
      this._applyLean(dt, 0, 0);
      if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
      if (this.exposedT == null) this.exposedT = R.range(C.exposedGrace[0], C.exposedGrace[1]);
      this.exposedT -= dt;
      this.blindT = 0;
      if (this.exposedT <= 0) {
        this.exposedT = null;
        this._coverLost('측면을 잡힘 — 엄폐 무효');
      }
      return;
    }
    this.exposedT = null;
    if (!e.peek) {
      this.crouchTarget = 0;
      this.aimTarget = 0.6;
      this._applyLean(dt, 0, 0);
      if (this.blindT == null || this.blindT <= 0) this.blindT = R.range(C.blindMove[0], C.blindMove[1]);
      this.blindT -= dt;
      if (this.blindT <= 0.01) {
        this.blindT = 0;
        this._goToCover(true, R.chance(this.flankChance), '가려졌지만 위협이 안 보임 → 자리 이동');
      }
      return;
    }
    this.blindT = 0;
    const hideRange = this.suppressedT > 0 ? [C.hide[0] + 0.8, C.hide[1] + 0.8] : C.hide;
    const ev = this._coverCycle(dt, C.peek, hideRange);
    if (ev === 'hide') this.cycles++;
    if (this.coverPhase === 'peek' && this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
    // 교착 → 측면 우회 / 돌격 / 전진
    if (this.aggroT <= 0) {
      this.aggroT = R.range(...CONFIG.npc.aggressionTime);
      if (R.chance(this.flankChance)) this._goToCover(false, true, '교착 → 측면 우회');
      else if (this.type === 'assault' || R.chance(0.2 + this.threat * 0.03)) this._startRush('교착 → 돌격');
      else this._goToCover(true, false, '교착 → 전진');
    }
  }

  // 창가·옥상: 아래로 숨었다가 일어나 사격, 가끔 자리 이동.
  // v1.1: 창턱(0.95m)·난간이 웅크린 몸을 못 가리면 웅크리지 않고 — 창에서 물러나 선 채로 숨었다가(위협에게 안 보이는 자리일 때) 다시 다가가 사격,
  //       물러설 자리도 없으면 서서 쏘며 버티다 다른 창가(유효한 곳)나 엄폐로
  _post(dt) {
    this.aggroT -= dt;
    if (!this._evalCover().valid) {
      this._postExposed(dt);
      return;
    }
    this.stepBack = false;
    const ev = this._coverCycle(dt, [1.2, 2.2], [1.0, 2.4]);
    if (this.coverPhase === 'peek') {
      if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
      else if (this.postOut) this.targetYaw = Math.atan2(this.postOut.x, this.postOut.z);
    }
    if (ev === 'hide') {
      this.cycles++;
      // 플레이어가 반대편이면 자리 이동
      if (this.cycles % 3 === 0 || !this._postFacesPlayer()) this._relocatePost('창가 자리 바꿈');
    }
  }

  _postExposed(dt) {
    const back = this._postBack();
    if (back) {
      // 물러서기 교전: 물러나 숨음(선 채) ↔ 창가로 다가가 짧게 사격
      this.stepBack = true;
      this.crouchTarget = 0;
      this.phaseT -= dt;
      if (this.coverPhase === 'hide') {
        this.aimTarget = 0.3;
        this._applyLean(dt, back.x, back.z);
        if (this.phaseT <= 0) {
          this.coverPhase = 'peek';
          this.peekMode = 'step';
          this.phaseT = R.range(1.2, 2.2);
          this.burstLeft = 0;
          this.burstPauseT = R.range(0.2, 0.45);
          this.afterBurstT = -1;
        }
      } else {
        this.aimTarget = 1;
        this._applyLean(dt, 0, 0);
        if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
        const C = CONFIG.npc.cover;
        if (this.shotsInPeek >= 1 && this.burstLeft === 0 && this.afterBurstT < 0) this.afterBurstT = R.range(C.afterBurst[0], C.afterBurst[1]);
        if (this.afterBurstT >= 0) this.afterBurstT -= dt;
        if (this.phaseT <= 0 || (this.afterBurstT >= 0 && this.afterBurstT <= 0 && this.burstLeft === 0)) {
          this._hideNow([1.0, 2.4]);
          this.cycles++;
        }
      }
      return;
    }
    // 물러설 자리도 없음: 서서 쏘며 버티다가 다른 창가(유효한 곳)나 엄폐로
    this.stepBack = false;
    this.crouchTarget = 0;
    this.aimTarget = 1;
    this._applyLean(dt, 0, 0);
    if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
    if (this.stateT > 1.2 && !this._relocatePost('창턱이 위협을 못 막음')) this._takeCover('창턱이 위협을 못 막음');
  }

  // 창에서 물러설 자리 (기준점 기준 오프셋) — 몸이 들어갈 자리가 비었고, 선 채로 위협에게 안 보이며, 창가에 서면 위협이 보일 때만
  _postBack() {
    const t = this.game.time;
    const B = this._backEval || (this._backEval = { t: -9, ok: false, x: 0, z: 0, tx: 0, tz: 0 });
    const eye = this.threatEye(_tf);
    if (t - B.t < 0.5 && Math.abs(eye.x - B.tx) + Math.abs(eye.z - B.tz) < 1.2) return B.ok ? B : null;
    B.t = t;
    B.tx = eye.x;
    B.tz = eye.z;
    B.ok = false;
    const out = this.postOut;
    if (!out || !this.inCoverSpot) return null;
    const a = this.coverAnchor;
    const col = this.game.world.collision;
    const bx = -out.x * 1.15;
    const bz = -out.z * 1.15;
    _p1.set(a.x, a.y + 1.0, a.z);
    _p2.set(a.x + bx, a.y + 1.0, a.z + bz);
    if (col.segmentBlocked(_p1, _p2) || col.segmentBlocked(_p2, _p1)) return null;
    if (!col.segmentBlocked(eye, _p2.set(a.x + bx, a.y + 1.62, a.z + bz))) return null;
    if (!col.segmentBlocked(eye, _p2.set(a.x + bx, a.y + 1.15, a.z + bz))) return null;
    if (col.segmentBlocked(_p1.set(a.x, a.y + 1.5, a.z), eye)) return null;
    B.ok = true;
    B.x = bx;
    B.z = bz;
    return B;
  }

  // 다른 창가·옥상 자리로 (지금 위협에 유효한 곳만)
  _relocatePost(reason) {
    const mgr = this.game.npcs;
    const next = mgr.pickPostNode(this, null);
    if (next == null || next === this.goalNode) return false;
    const n = this.game.world.nav.get(next);
    if (!mgr.nodeCover(n, this.threatEye(_tf)).valid) return false;
    return this._goTo(next, 'post', false, reason);
  }

  _postFacesPlayer() {
    if (!this.postOut) return true;
    const pp = this.game.player.feet;
    const dx = pp.x - this.position.x;
    const dz = pp.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return (this.postOut.x * dx + this.postOut.z * dz) / d > 0.2;
  }

  // 엄폐 없이 교전: 옆으로 움직이며 사격 (가끔 멈칫), 가까운 유효 엄폐가 보이면 그리로
  _engage(dt) {
    this._strafe(dt);
    if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
    this.nearCheckT -= dt;
    if (this.nearCheckT <= 0 && this.type !== 'assault') {
      this.nearCheckT = CONFIG.npc.cover.strafe.nearCheck;
      const node = this.game.npcs.findCover(this, { maxDist: CONFIG.npc.cover.nearRadius, anyNode: true });
      if (node) {
        node.reservedBy = this;
        this.coverNode = node;
        if (this._goTo(node.id, 'cover', true, '옆 이동 중 가까운 엄폐 발견')) return;
        node.reservedBy = null;
        this.coverNode = null;
      }
    }
    if (this.stateT > this.engageDur || (!this.hasLOS && this.stateT > 2.5)) {
      if (this.type === 'assault') this._startRush('교전 끝 → 다시 돌격');
      else if (this.aware && !this.hasLOS && this.game.time - this.lastLOST > 3) this._search();
      else this._goToCover(false, false, '교전 끝 → 엄폐 찾기');
    }
  }

  _rush(dt) {
    const game = this.game;
    this.aimTarget = this.hasLOS ? 0.7 : 0;
    this.repathT -= dt;
    const pd = this.position.distanceTo(game.player.feet);
    if (pd < 6.5 && this.hasLOS) {
      this.path = null;
      this._enterEngage('돌격 → 근접 교전');
      return;
    }
    if (this.repathT <= 0) {
      this.repathT = 2.0;
      const target = game.npcs.playerNode();
      if (target != null && target !== this._rushTarget) {
        const path = game.world.nav.findPath(this.navNode, target);
        if (path) {
          this.setPath(path);
          this._rushTarget = target;
        }
      }
    }
    // 돌격도 시야가 트여 있으면 지그재그
    this.weave = this.hasLOS ? CONFIG.npc.cover.zigzag.amp : 0;
    this.jukeT = Math.max(0, (this.jukeT || 0) - dt);
    const done = this._followPath(dt, this.tcfg.run * (this.jukeT > 0 ? 1.2 : 1));
    if (done) this._enterEngage('돌격 도착 → 교전');
  }

  _search(dt) {
    if (this.state !== S.SEARCH) {
      const node = this.game.world.nav.nearest(this.lastKnown.x, this.lastKnown.y, this.lastKnown.z, (n) => !n.removed, 20);
      if (node && this._goTo(node.id, 'search', false, '시야 놓침 → 수색')) return;
      this._goToCover(true, false, '수색 실패 → 엄폐로');
      return;
    }
    this.searchT -= dt;
    this.targetYaw += dt * 1.2;
    if (this.searchT <= 0) this._goToCover(true, false, '수색 끝 → 엄폐로');
  }

  // ------------------------------------------------------------------
  _canShoot() {
    if (!super._canShoot()) return false;
    if (this.state === S.MOVE && this.type !== 'assault') {
      // 소총수는 가까울 때만 이동 사격
      if (this._targetDist() > 12) return false;
    }
    if ((this.state === S.COVER || this.state === S.POST) && this.coverPhase !== 'peek' && (this.coverOK || this.stepBack)) return false;
    return true;
  }

  onDamaged(info) {
    if (this.disguised) {
      // 먼저 맞으면 짧은 예고 뒤 곧바로 정체를 드러냄
      this.ctl.startReveal('damaged');
      return;
    }
    this.aware = true;
    // 쏜 쪽을 기억 (플레이어 또는 아군 NPC)
    const att = info && info.attacker;
    if (att && att !== 'player' && att.position) {
      this.lastKnown.copy(att.position);
      if (!this.target || !this.hasLOS) this.target = att;
    } else {
      this.lastKnown.copy(this.game.player.feet);
      if (!this.hasLOS) this.target = 'player';
    }
    this.reactT = Math.min(this.reactT, 0.25);
    if (this.state === S.COVER && this.coverPhase === 'peek' && R.chance(0.55)) {
      this._hideNow([1.0, 2.0]);
      this.stateReason = '피격 → 숨음';
      if (R.chance(0.5)) this._goToCover(false, false, '피격 → 다른 엄폐로');
    } else if (this.state === S.ENGAGE && R.chance(0.65)) {
      this._takeCover('피격 (뚫린 곳)');
    } else if (this.state === S.POST && R.chance(0.6)) {
      this._hideNow([1.5, 2.5]);
      this.stateReason = '피격 → 숨음';
    }
  }

  onDeath() {
    super.onDeath();
    if (this.disguised) this.ctl.onKilled();
  }
}
