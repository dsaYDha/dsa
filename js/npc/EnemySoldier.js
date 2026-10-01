// 적군 — 빨간 표식. 상태 머신 AI (지각·사격은 Soldier 공통)
// 등장 → 엄폐 지점으로 이동 → 시야(시야각·거리·가림)나 총소리로 감지 → 반응 지연 후 사격
// → 맞으면 엄폐 이동 → 시간이 지나면 측면 우회나 돌격
// 유형: rifleman(소총수) / assault(돌격병: 빠른 접근·실내 습격) / window(창문·옥상 사수)
// 대상: 플레이어 우선, 플레이어가 안 보이면 근처 아군 NPC (trueFaction 기준)
import { CONFIG, lerpThreat, lerpRangeThreat } from '../config.js';
import { Soldier } from './Soldier.js';
import { gameRand as R } from '../core/Random.js';

const S = {
  ENTER: 'enter',
  MOVE: 'move',
  COVER: 'cover',
  POST: 'post', // 창가·옥상 자리
  ENGAGE: 'engage',
  RUSH: 'rush',
  SEARCH: 'search',
  DEAD: 'dead',
};
export const EnemyState = S;

export class EnemySoldier extends Soldier {
  /**
   * opts: { type, threat, entrance, nodeId, goalNode, goalNodes, buildingId, apparentFaction, outfit }
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

    this.reactRange = lerpRangeThreat(CONFIG.threat.reactionDelay, this.threat);
    this.accMul = lerpThreat(CONFIG.threat.accuracyMul, this.threat);
    this.flankChance = lerpThreat(CONFIG.threat.flankChance, this.threat);
  }

  get stateLabel() {
    return `${this.state}${this.state === S.COVER || this.state === S.POST ? ':' + this.coverPhase : ''}`;
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

  rollDamage(target) {
    const base = CONFIG.npc.hitDamage[this.type] || 8;
    if (target === 'player') return { amount: base, zone: 'torso' };
    return { amount: base * CONFIG.npc.damageVsNpcMul, zone: 'torso' };
  }

  _hitChance(dist, target) {
    const acc = super._hitChance(dist, target);
    return target === 'player' ? acc : acc * CONFIG.npc.accuracyVsNpc;
  }

  // 플레이어 총성 청취
  hearShot(pos) {
    if (!this.alive) return;
    this.lastKnown.copy(pos);
    this.lastKnown.y -= 1.6;
    if (!this.aware) {
      this.aware = true;
      this.target = 'player';
      this.reactT = R.range(this.reactRange[0], this.reactRange[1]) + 0.25;
    }
  }

  // 아군 탄이 가까이 지나감 → 엄폐 중이면 더 오래 숨음
  onSuppressed() {
    this.suppressedT = 1.5;
    if ((this.state === S.COVER || this.state === S.POST) && this.coverPhase === 'peek' && R.chance(0.45)) {
      this.coverPhase = 'hide';
      this.phaseT = R.range(1.2, 2.4);
      this.shotsInPeek = 0;
    }
  }

  // ------------------------------------------------------------------
  think(dt) {
    this._tickPerception(dt);
    this.suppressedT = Math.max(0, this.suppressedT - dt);

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
  }

  _targetDist() {
    if (!this.target) return Infinity;
    return this.position.distanceTo(this.target === 'player' ? this.game.player.feet : this.target.position);
  }

  _enter() {
    const mgr = this.game.npcs;
    switch (this.entrance) {
      case 'coverPop': {
        // 엄폐물 뒤에 웅크린 채 생성 → 잠시 뒤 튀어나옴
        const n = this.game.world.nav.get(this.navNode);
        this.coverNode = n;
        n.reservedBy = this;
        this.crouchTarget = 1;
        this.crouch = 1;
        this.coverPhase = 'hide';
        this.phaseT = R.range(0.6, 1.6);
        if (n.coverDir) this.targetYaw = this.yaw = Math.atan2(n.coverDir.x, n.coverDir.z);
        this._setState(S.COVER);
        break;
      }
      case 'window':
      case 'roof': {
        const goal = this.entrance === 'window' ? this.goalNode : mgr.pickPostNode(this, this.goalNodes);
        if (goal != null && this._goTo(goal, 'post', false)) break;
        this._goToCover(true);
        break;
      }
      case 'ambush':
        // 돌발 조우: 바로 플레이어에게 접근
        this._startRush();
        break;
      default:
        if (this.type === 'assault') this._startRush();
        else this._goToCover(true);
    }
  }

  _goToCover(advance = false, flank = false) {
    this._releaseCover();
    const mgr = this.game.npcs;
    const node = mgr.findCover(this, { advance, flank });
    if (node) {
      node.reservedBy = this;
      this.coverNode = node;
      if (this._goTo(node.id, 'cover', true)) return true;
      node.reservedBy = null;
      this.coverNode = null;
    }
    // 엄폐물이 없으면 플레이어 쪽으로 접근 후 교전
    const near = mgr.nearestNodeToPlayer(this, 14);
    if (near != null && this._goTo(near, 'engage', true)) return true;
    this._setState(S.ENGAGE);
    return false;
  }

  _startRush() {
    this._releaseCover();
    const target = this.game.npcs.playerNode();
    if (target == null || !this._goTo(target, 'rush', true)) {
      this._goToCover(true);
      return;
    }
    this.state = S.RUSH;
    this.repathT = 2.0;
    this._rushTarget = target;
  }

  _move(dt) {
    const done = this._followPath(dt, this.moveSpeed);
    if (!done) return;
    this.curSpeed = 0;
    if (this.goalKind === 'cover' && this.coverNode) {
      this.crouchTarget = 1;
      this.coverPhase = 'hide';
      this.phaseT = R.range(0.4, 1.0);
      if (this.coverNode.coverDir) this.targetYaw = Math.atan2(this.coverNode.coverDir.x, this.coverNode.coverDir.z);
      this._setState(S.COVER);
    } else if (this.goalKind === 'post') {
      const n = this.game.world.nav.get(this.goalNode);
      this.postOut = n.out;
      if (n.out) this.targetYaw = Math.atan2(n.out.x, n.out.z);
      this.crouchTarget = 1;
      this.coverPhase = 'hide';
      this.phaseT = R.range(0.3, 0.9);
      this._setState(S.POST);
    } else if (this.goalKind === 'search') {
      this.searchT = R.range(2.5, 4.5);
      this._setState(S.SEARCH);
    } else {
      this._enterEngage();
    }
  }

  _enterEngage() {
    this.engageDur = R.range(3.5, 6);
    this._setState(S.ENGAGE);
  }

  // 엄폐: 숨기 ↔ 고개 내밀고 사격
  _cover(dt) {
    const game = this.game;
    this.aggroT -= dt;
    const pp = game.player.feet;
    const n = this.coverNode;
    // 플레이어가 돌아 들어와 엄폐가 무의미해지면 이동
    if (n && n.coverDir) {
      const dx = pp.x - n.x;
      const dz = pp.z - n.z;
      const d = Math.hypot(dx, dz);
      const prot = (n.coverDir.x * dx + n.coverDir.z * dz) / Math.max(0.01, d);
      if ((prot < 0.15 || d < 4) && this.stateT > 1.0) {
        if (d < 7) {
          this.crouchTarget = 0;
          this._enterEngage();
        } else this._goToCover(false);
        return;
      }
    }
    const hideRange = this.suppressedT > 0 ? [1.6, 3.0] : CONFIG.npc.coverPeek;
    if (this._coverCycle(dt, [1.8, 3.4], hideRange) === 'hide') this.cycles++;
    if (this.coverPhase === 'peek' && this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
    // 교착 → 측면 우회 / 돌격 / 전진
    if (this.aggroT <= 0) {
      this.aggroT = R.range(...CONFIG.npc.aggressionTime);
      if (R.chance(this.flankChance)) this._goToCover(false, true);
      else if (this.type === 'assault' || R.chance(0.2 + this.threat * 0.03)) this._startRush();
      else this._goToCover(true);
    }
  }

  // 창가·옥상: 아래로 숨었다가 일어나 사격, 가끔 자리 이동
  _post(dt) {
    this.aggroT -= dt;
    const ev = this._coverCycle(dt, [2.0, 3.8], [1.2, 2.6]);
    if (this.coverPhase === 'peek') {
      if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
      else if (this.postOut) this.targetYaw = Math.atan2(this.postOut.x, this.postOut.z);
    }
    if (ev === 'hide') {
      this.cycles++;
      // 플레이어가 반대편이면 자리 이동
      if (this.cycles % 3 === 0 || !this._postFacesPlayer()) {
        const next = this.game.npcs.pickPostNode(this, null);
        if (next != null && next !== this.goalNode) this._goTo(next, 'post', false);
      }
    }
  }

  _postFacesPlayer() {
    if (!this.postOut) return true;
    const pp = this.game.player.feet;
    const dx = pp.x - this.position.x;
    const dz = pp.z - this.position.z;
    const d = Math.hypot(dx, dz) || 1;
    return (this.postOut.x * dx + this.postOut.z * dz) / d > 0.2;
  }

  _engage() {
    this.crouchTarget = 0;
    this.aimTarget = 1;
    this.curSpeed = 0;
    if (this.aware) this.faceTowards(this.lastKnown.x, this.lastKnown.z);
    if (this.stateT > this.engageDur || (!this.hasLOS && this.stateT > 2.5)) {
      if (this.type === 'assault') this._startRush();
      else if (this.aware && !this.hasLOS && this.game.time - this.lastLOST > 3) this._search();
      else this._goToCover(false);
    }
  }

  _rush(dt) {
    const game = this.game;
    this.aimTarget = this.hasLOS ? 0.7 : 0;
    this.repathT -= dt;
    const pd = this.position.distanceTo(game.player.feet);
    if (pd < 6.5 && this.hasLOS) {
      this.path = null;
      this._enterEngage();
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
    const done = this._followPath(dt, this.tcfg.run);
    if (done) this._enterEngage();
  }

  _search(dt) {
    if (this.state !== S.SEARCH) {
      const node = this.game.world.nav.nearest(this.lastKnown.x, this.lastKnown.y, this.lastKnown.z, (n) => !n.removed, 20);
      if (node && this._goTo(node.id, 'search', false)) return;
      this._goToCover(true);
      return;
    }
    this.searchT -= dt;
    this.targetYaw += dt * 1.2;
    if (this.searchT <= 0) this._goToCover(true);
  }

  // ------------------------------------------------------------------
  _canShoot() {
    if (!super._canShoot()) return false;
    if (this.state === S.MOVE && this.type !== 'assault') {
      // 소총수는 가까울 때만 이동 사격
      if (this._targetDist() > 12) return false;
    }
    if ((this.state === S.COVER || this.state === S.POST) && this.coverPhase !== 'peek') return false;
    return true;
  }

  onDamaged(info) {
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
      this.coverPhase = 'hide';
      this.phaseT = R.range(1.0, 2.0);
      if (R.chance(0.5)) this._goToCover(false);
    } else if (this.state === S.ENGAGE && R.chance(0.65)) {
      this._goToCover(false);
    } else if (this.state === S.POST && R.chance(0.6)) {
      this.coverPhase = 'hide';
      this.phaseT = R.range(1.5, 2.5);
    }
  }
}
