// 모든 인물 NPC 의 공통 베이스
// trueFaction: 실제 소속 (enemy / ally / civilian) — 점수·페널티·AI 적대 판정은 이것 기준
// apparentFaction: 겉보기 소속 (표식·복장) — 3단계 위장 적은 ally/civilian 으로 보이다가 정체를 드러내면 enemy
// 3단계: 행동 기록(behavior) — 실제로 일어난 일만 남겨 관찰 모드가 '사실'로 꺼내 본다 (npc/Clues.js)
// 4단계: 말 걸기 공통 — 멈춰 서기(talkHoldT), 총구 내리기(lowerT), 신분증 내밀기(cardT), 손 들면 옷이 올라감(shirtLift),
//        자막 화자 라벨은 겉모습 기준(talkLabel), 문답에서 틀리거나 머뭇거렸는지(dialogueFailed — 점수 '근거 있는 판단')
import * as THREE from 'three';
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';
import { HumanoidRig } from './HumanoidRig.js';
import { Insignia } from './Insignia.js';
import { soldierOutfit, civilianOutfit, describeEquipment } from './Outfits.js';
import { factsFor } from './Clues.js';
import { SPEAKER } from '../dialogue/DialogueLines.js';

let NEXT_ID = 1;
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class NPCBase {
  constructor(game, opts) {
    this.id = NEXT_ID++;
    this.game = game;
    this.trueFaction = opts.trueFaction;
    this.apparentFaction = opts.apparentFaction || opts.trueFaction;
    this.kind = opts.kind || 'npc';
    this.maxHealth = opts.maxHealth || CONFIG.npc.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.dying = false;
    this.removed = false;

    this.position = new THREE.Vector3();
    this.yaw = 0;
    this.targetYaw = 0;

    const fac = CONFIG.factions[this.apparentFaction];
    this.rig = new HumanoidRig(opts.outfit || (fac.uniform != null ? soldierOutfit(this.apparentFaction) : civilianOutfit()));
    this.insignia = new Insignia(fac.insignia);
    this.insignia.attach(this.rig);
    this.root = this.rig.root;
    this.root.userData.npc = this;

    this.spawnTime = game.time;
    this.firstSeenAt = null; // 플레이어 화면에 처음 보인 시각 (즉응 사살·판단 통계용)
    this.lastSeenAt = -1;
    this.visibleToPlayer = false;

    // 이동
    this.path = null;
    this.pathIdx = 0;
    this.navNode = opts.nodeId ?? null;
    this.heading = null; // 지금 향하고 있는 노드
    this.moveSpeed = 0;
    this.curSpeed = 0;
    this.segFrom = new THREE.Vector3();
    this._stuckT = 0;
    this._lastPos = new THREE.Vector3();
    this._stepT = 0;

    // 자세
    this.crouch = 0;
    this.crouchTarget = 0;
    this.aim = 0;
    this.aimTarget = 0;
    this.aimPitch = 0;
    this.deathT = 0;
    this.lastDamage = null;
    this.handsUp = 0; // 0~1 손 들기
    this.cower = 0; // 0~1 머리 감싸고 웅크림
    // 3단계 자세 (행동 단서가 3D 애니메이션에 실제로 보이게)
    this.hideHands = 0; // 0~1 손 숨기기 (handsMode: 'back' 등 뒤 | 'pocket' 주머니)
    this.handsMode = 'back';
    this.shock = 0; // 0~1 충격으로 얼어붙음 (두 손을 가슴에 모음)
    this.tear = 0; // 0~1 표식 뜯기 (위장 적 정체 드러내기)
    this.reach = 0; // 0~1 등 뒤 숨긴 총 꺼내기
    this.radioTalk = 0; // 0~1 무전기에 대고 말하기
    // 4단계 자세·대화 상태
    this.handsLag = 0; // 0~1 오른손만 늦게 듦
    this.lowered = 0; // 0~1 총구를 내림
    this.showCard = 0; // 0~1 신분증을 내밂
    this.talkHoldT = 0; // 대화 중 멈춰 서서 플레이어를 바라봄 (남은 시간)
    this.lowerT = 0; // "총 내려!" 남은 시간
    this.cardT = 0; // 신분증 보여주는 남은 시간
    this.unit = null; // 진짜 아군의 부대 (config.dialogue.units)
    this.dialogueFailed = false; // 문답에서 틀리거나 머뭇거림 (위장 적만 — 사살 시 '근거 있는 판단')
    this.questionTimes = []; // 받은 질문 시각 (진짜 아군의 짜증 판정)
    this.behavior = new Map(); // 행동 기록: key → { first, t, n, variant }
    this.observed = null; // 관찰 기록: { found: Map(key → fact), anomalies, outlineUntil }
    this.playerDamaged = false; // 플레이어에게 한 번이라도 맞았는지 (어시스트 판정)
    this._yieldT = 0;
    // 음성 프로필 (자막·TTS 화자별 음높이·속도)
    this.voice = { id: `npc${this.id}`, pitch: 0.85 + ((this.id * 37) % 40) / 100, rate: 1.0 + ((this.id * 53) % 25) / 100 };
  }

  // 장비 구성 데이터 (헬멧·소총·신발·표식·손 상태) — 3단계 시각 단서 판정용
  getEquipment() {
    return describeEquipment(this);
  }

  // 손 상태: 'weapon' | 'aiming' | 'raised' | 'covering' | 'hidden' | 'clutching' | 'carrying' | 'empty'
  handsState() {
    if (this.handsUp > 0.5) return 'raised';
    if (this.cower > 0.5) return 'covering';
    if (this.hideHands > 0.5) return 'hidden';
    if (this.shock > 0.5) return 'clutching';
    if (this.rig.outfit.rifle) return this.aim > 0.5 ? 'aiming' : 'weapon';
    if (this.rig.outfit.bag === 'carry') return 'carrying';
    return 'empty';
  }

  // 적대 판정 (trueFaction 기준). 3단계 위장 적 예외는 여기서 확장
  isHostileTo(other) {
    const a = this.trueFaction;
    const b = other === 'player' ? 'ally' : other.trueFaction;
    return (a === 'enemy' && b === 'ally') || (a === 'ally' && b === 'enemy');
  }

  // 근처를 지나간 탄 (제압) — 서브클래스가 필요하면 반응
  onSuppressed() {}

  // ------------------------------------------------------------------
  // 3단계: 행동 기록·관찰
  // ------------------------------------------------------------------
  /** 실제로 일어난 행동을 기록 (관찰 모드가 사실로 꺼내 봄). key 는 npc/Clues.js BEHAVIOR 의 키 */
  noteBehavior(key, variant = null) {
    const t = this.game.time;
    const rec = this.behavior.get(key);
    if (rec) {
      rec.t = t;
      rec.n++;
      if (variant) rec.variant = variant;
    } else this.behavior.set(key, { first: t, t, n: 1, variant });
  }

  hasBehavior(key) {
    return this.behavior.has(key);
  }

  /** 관찰 가능한 사실 목록 (장비 + 기록된 행동) */
  observationFacts() {
    return factsFor(this, this.game.time);
  }

  /** 관찰 기록 (없으면 생성) */
  getObserved() {
    if (!this.observed) this.observed = { found: new Map(), anomalies: 0, outlineUntil: -1 };
    return this.observed;
  }

  /** 정체를 드러내기 전의 위장 적인지 (EnemySoldier 가 덮어씀) */
  get disguised() {
    return false;
  }

  /** 겉보기에 적(빨간 표식)인지 — 아군·민간인 AI 는 이것만 보고 판단한다 (위장에 속음) */
  get looksHostile() {
    return this.apparentFaction === 'enemy';
  }

  // ------------------------------------------------------------------
  // 4단계: 말 걸기 공통
  // ------------------------------------------------------------------
  /** 자막 화자 라벨 — 겉모습만 ([파란 표식 병사] / [민간인]) */
  get talkLabel() {
    return this.apparentFaction === 'civilian' ? SPEAKER.civilian : SPEAKER.ally;
  }

  /** 대화용 자막 (겉모습 라벨, 자기 목소리) */
  sayTalk(text, priority = 3) {
    this.game.voice.say({ speaker: this.talkLabel, text, channel: this.apparentFaction === 'civilian' ? 'civilian' : 'shout', priority, voice: this.voice, force: true, nodedupe: true });
  }

  /** 멈춰 서서 플레이어를 바라봄 (각 AI 가 think 에서 talkHoldT 를 확인) */
  holdForTalk(sec) {
    this.talkHoldT = Math.max(this.talkHoldT, sec);
  }

  lowerWeapon(sec) {
    this.lowerT = Math.max(this.lowerT, sec);
  }

  presentCard(sec) {
    this.cardT = Math.max(this.cardT, sec);
  }

  /** 질문을 받은 시각 기록 → 최근 window 초 안에 받은 질문 수 */
  noteQuestion(window) {
    const t = this.game.time;
    this.questionTimes.push(t);
    while (this.questionTimes.length && t - this.questionTimes[0] > window) this.questionTimes.shift();
    return this.questionTimes.length;
  }

  _updateTalkPose(dt) {
    this.talkHoldT = Math.max(0, this.talkHoldT - dt);
    this.lowerT = Math.max(0, this.lowerT - dt);
    this.cardT = Math.max(0, this.cardT - dt);
    this.lowered += ((this.lowerT > 0 ? 1 : 0) - this.lowered) * Math.min(1, dt * 5);
    this.showCard += ((this.cardT > 0 ? 1 : 0) - this.showCard) * Math.min(1, dt * 6);
    this.handsLag = Math.max(0, this.handsLag - dt * (this._lagRate || 0));
    if (this.cardT > 0 || this.showCard > 0.05) this.rig.setCard(this.showCard > 0.35);
    // 손을 들면 옷이 올라감 (사복 차림만 — 허리띠, 허리춤에 숨긴 무기가 드러남)
    const o = this.rig.outfit;
    if (o.top !== 'uniform') {
      const lift = this.handsUp > 0.6 ? true : this.handsUp < 0.4 ? false : !!o.shirtLift;
      if (lift !== !!o.shirtLift) this.rig.applyOutfit({ ...o, shirtLift: lift });
    }
  }

  /** 한 손(오른손)이 늦게 올라오게 — sec 동안 늦게 */
  lagHands(sec) {
    this.handsLag = 1;
    this._lagRate = 1 / Math.max(0.1, sec);
  }

  // 3단계: 겉보기 소속 변경 (표식 색·형태 교체, 필요하면 복장도 교체)
  setApparentFaction(faction, outfit = null) {
    this.apparentFaction = faction;
    const fac = CONFIG.factions[faction];
    if (outfit) {
      this.rig.applyOutfit(outfit);
      this.insignia.attach(this.rig);
    }
    if (fac.insignia) {
      this.insignia.setColor(fac.insignia.color);
      this.insignia.setShape(fac.insignia.shape);
    } else {
      this.insignia.setShape('none');
    }
  }

  placeAt(x, y, z, yaw = 0) {
    this.position.set(x, y, z);
    this.yaw = this.targetYaw = yaw;
    this.root.position.copy(this.position);
    this.root.rotation.y = yaw;
    this._lastPos.copy(this.position);
  }

  getEyePosition(target) {
    const h = 1.62 - this.crouch * 0.62; // 웅크림 눈높이 ≈1.0m
    return target.set(this.position.x, this.position.y + h, this.position.z);
  }

  getChestPosition(target) {
    return target.set(this.position.x, this.position.y + 1.25 - this.crouch * 0.55, this.position.z);
  }

  getHeadPosition(target) {
    return this.rig.getHeadWorld(target);
  }

  // ------------------------------------------------------------------
  // 경로 이동
  // ------------------------------------------------------------------
  setPath(path) {
    this.path = path && path.length ? path : null;
    this.pathIdx = 0;
    this.segFrom.copy(this.position);
    // 첫 노드(마지막으로 지난 노드)를 건너뛸지: 이미 그 위에 있거나, 지금 향하던 노드가 경로의 다음 노드면
    // (경로 재계산 때 뒤로 돌아가는 왕복 방지)
    if (this.path && this.path.length > 1) {
      const n0 = this.game.world.nav.get(this.path[0]);
      const onFirst = Math.hypot(n0.x - this.position.x, n0.z - this.position.z) < 0.6;
      if (onFirst || this.path[1] === this.heading) this.pathIdx = 1;
    }
    this._stuckT = 0;
  }

  get pathDone() {
    return !this.path || this.pathIdx >= this.path.length;
  }

  get remainingPath() {
    if (!this.path) return 0;
    const nav = this.game.world.nav;
    let d = 0;
    let px = this.position.x;
    let pz = this.position.z;
    for (let i = this.pathIdx; i < this.path.length; i++) {
      const n = nav.get(this.path[i]);
      d += Math.hypot(n.x - px, n.z - pz);
      px = n.x;
      pz = n.z;
    }
    return d;
  }

  _followPath(dt, speed) {
    if (this.pathDone) {
      this.curSpeed = 0;
      this.heading = null;
      return true;
    }
    const nav = this.game.world.nav;
    const target = nav.get(this.path[this.pathIdx]);
    this.heading = target.id;
    const dx = target.x - this.position.x;
    const dz = target.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    // 앞에 다른 NPC 가 있으면 감속 (겹쳐 지나가지 않게, 1.5초 넘게 막히면 그냥 지나감)
    if (dist > 0.01 && this.game.npcs.isBlockedAhead(this, dx / dist, dz / dist)) {
      this._yieldT += dt;
      if (this._yieldT < 1.5) speed *= 0.2;
    } else this._yieldT = 0;
    const step = speed * dt;
    // 높이: 구간 시작점 → 목표 노드 사이를 수평 진행률로 보간 (계단 경사와 일치)
    const segLen = Math.max(0.01, Math.hypot(target.x - this.segFrom.x, target.z - this.segFrom.z));
    if (dist <= step + 0.05) {
      this.position.set(target.x, target.y, target.z);
      this.navNode = target.id;
      this.pathIdx++;
      this.segFrom.copy(this.position);
    } else {
      this.position.x += (dx / dist) * step;
      this.position.z += (dz / dist) * step;
      const prog = 1 - (dist - step) / segLen;
      this.position.y = this.segFrom.y + (target.y - this.segFrom.y) * THREE.MathUtils.clamp(prog, 0, 1);
      this.targetYaw = Math.atan2(dx, dz);
    }
    this.curSpeed = speed;
    // 걸음 소리
    this._stepT -= dt;
    if (this._stepT <= 0) {
      this._stepT = speed > 3 ? 0.34 : 0.5;
      this.game.audio.footstep(this.position, { surface: Math.random() < 0.3 ? 'rubble' : 'concrete', volume: speed > 3 ? 1.1 : 0.7, run: speed > 3 });
    }
    // 끼임 감지
    this._stuckT += dt;
    if (this._stuckT > 1.5) {
      const moved = this.position.distanceTo(this._lastPos);
      this._lastPos.copy(this.position);
      this._stuckT = 0;
      if (moved < 0.3 && speed > 0.5) this.onStuck();
    }
    return this.pathDone;
  }

  onStuck() {
    // 다음 노드로 순간 보정 (드문 경우의 안전장치)
    if (this.path && this.pathIdx < this.path.length) {
      const n = this.game.world.nav.get(this.path[this.pathIdx]);
      this.position.set(n.x, n.y, n.z);
      this.segFrom.copy(this.position);
      this.pathIdx++;
    }
  }

  faceTowards(x, z) {
    this.targetYaw = Math.atan2(x - this.position.x, z - this.position.z);
  }

  // ------------------------------------------------------------------
  // 피해·사망 — 이벤트 발행 (2단계 페널티, 3·4단계 판단 통계가 구독)
  // ------------------------------------------------------------------
  takeDamage(info) {
    if (!this.alive) return;
    const dmg = info.amount;
    this.health -= dmg;
    if (info.attacker === 'player') this.playerDamaged = true;
    const headshot = info.zone === 'head';
    const payload = {
      attacker: info.attacker,
      victim: this,
      trueFaction: this.trueFaction,
      apparentFaction: this.apparentFaction,
      zone: info.zone,
      headshot,
      attackerFaction: info.attacker === 'player' ? 'player' : info.attacker ? info.attacker.trueFaction : null,
      victimKind: this.kind,
      damage: dmg,
      distance: info.distance,
      timeSinceFirstSeen: this.firstSeenAt != null ? this.game.time - this.firstSeenAt : null,
      position: info.point ? info.point.clone() : this.position.clone(),
      time: this.game.time,
    };
    this.lastDamage = payload;
    if (this.health <= 0) {
      this.die(info, payload);
      this.game.events.emit(Events.NPC_KILLED, payload);
    } else {
      // 피격 방향에 따라 움찔
      let side = 0;
      if (info.direction) {
        _v.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
        side = Math.sign(_v.dot(info.direction)) || 1;
      }
      this.rig.onHit(side);
      this.onDamaged(info);
      this.game.events.emit(Events.NPC_DAMAGED, payload);
    }
  }

  onDamaged() {}

  die(info) {
    this.alive = false;
    this.dying = true;
    this.health = 0;
    this.deathT = 0;
    this.killedBy = info ? info.attacker : null;
    // 총알이 온 방향으로 넘어짐: 앞에서 맞으면 뒤로
    let dir = 1;
    if (info && info.direction) {
      _w.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
      dir = _w.dot(info.direction) < 0 ? 1 : -1;
    }
    this.rig.startDeath(dir);
    this.onDeath();
  }

  onDeath() {}

  // ------------------------------------------------------------------
  // 5단계 LOD: 멀거나 화면 밖이면 애니메이션을 몇 프레임에 한 번 (누적 dt 로) — NPCManager 가 animEvery 를 정함
  _animDue(dt) {
    this._animAcc = (this._animAcc || 0) + dt;
    this._animTick = ((this._animTick || 0) + 1) % (this.animEvery || 1);
    if (this._animTick !== 0) return 0;
    const a = this._animAcc;
    this._animAcc = 0;
    return a;
  }

  update(dt) {
    if (this.dying) {
      if (this.rig.card) this.rig.setCard(false);
      this.deathT += dt;
      const C = CONFIG.npc;
      if (this.deathT > C.corpseTime) {
        const t = (this.deathT - C.corpseTime) / C.sinkTime;
        this.root.position.y = this.position.y - t * 0.6;
        if (t >= 1) this.removed = true;
      }
      const ad = this._animDue(dt);
      if (ad > 0) this.rig.animate(ad, {});
      return;
    }
    // 5단계 LOD: 멀고(45m+) 화면 밖인 인물은 AI 를 2프레임에 한 번 (누적 dt — 이동·타이머 결과는 같음)
    this._thinkAcc = (this._thinkAcc || 0) + dt;
    this._thinkTick = ((this._thinkTick || 0) + 1) % (this.thinkEvery || 1);
    if (this._thinkTick !== 0) return;
    dt = this._thinkAcc;
    this._thinkAcc = 0;
    this.think(dt);
    this._updateTalkPose(dt);
    // 회전 보간
    let d = this.targetYaw - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    const turn = CONFIG.npc.turnSpeed * dt;
    this.yaw += Math.abs(d) < turn ? d : Math.sign(d) * turn;
    // 자세 보간
    this.crouch += (this.crouchTarget - this.crouch) * Math.min(1, dt * 7);
    this.aim += (this.aimTarget - this.aim) * Math.min(1, dt * 6);

    this.root.position.copy(this.position);
    this.root.rotation.y = this.yaw;
    const ad = this._animDue(dt);
    if (ad <= 0) return;
    const ap = this._animParams || (this._animParams = {});
    ap.speed = this.curSpeed; ap.aim = this.aim; ap.aimPitch = this.aimPitch; ap.crouch = this.crouch; ap.handsUp = this.handsUp; ap.cower = this.cower;
    ap.hideHands = this.hideHands; ap.handsMode = this.handsMode; ap.shock = this.shock; ap.tear = this.tear; ap.reach = this.reach; ap.radioTalk = this.radioTalk;
    ap.handsLag = this.handsLag; ap.lowered = this.lowered; ap.showCard = this.showCard;
    this.rig.animate(ad, ap);
  }

  think() {}

  dispose() {
    if (this.root.parent) this.root.parent.remove(this.root);
    this.insignia.dispose();
    this.rig.dispose();
  }
}
