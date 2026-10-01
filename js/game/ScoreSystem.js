// 점수 — 사살 100, 헤드샷 +50, 즉응 사살 +50, 멀티킬(+100 / +250), 콤보 배율(×1.5 → … ×4)
// NPC_KILLED 이벤트를 구독. trueFaction 기준으로 판정 (오인 사격 페널티는 PenaltySystem 이 applyPenalty/resetCombo/lockCombo 호출)
// 2단계: 어시스트 +30 (플레이어가 먼저 맞힌 적을 아군이 마무리), 민간인 대피 +25. 점수는 음수까지 내려갈 수 있음
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';

export class ScoreSystem {
  constructor(game) {
    this.game = game;
    this.reset();
    game.events.on(Events.NPC_KILLED, (e) => this.onKill(e));
    game.events.on(Events.CIVILIAN_EVACUATED, () => this._bonus(CONFIG.score.evacuation, '민간인 대피', 'evac', () => this.evacuated++));
  }

  _bonus(points, label, kind, count) {
    this.score += points;
    if (count) count();
    this.game.events.emit(Events.SCORE_EVENT, { points, label, kind });
  }

  // 오인 사격 페널티 (음수)
  applyPenalty(points) {
    this.score += points;
    this.penaltyTotal += points;
  }

  resetCombo() {
    this.combo = 1;
    this.chain = 0;
    this.comboTimer = 0;
    this.multiCount = 0;
    this.multiTimer = 0;
  }

  lockCombo(sec) {
    this.comboLockT = Math.max(this.comboLockT, sec);
  }

  get comboLocked() {
    return this.comboLockT > 0;
  }

  reset() {
    this.score = 0;
    this.kills = 0;
    this.headshots = 0;
    this.quickKills = 0;
    this.multiKills = 0;
    this.combo = 1; // 현재 배율
    this.chain = 0; // 콤보 연쇄 수
    this.bestChain = 0;
    this.bestCombo = 1;
    this.comboTimer = 0;
    this.multiTimer = 0;
    this.multiCount = 0;
    this.startTime = this.game.time;
    this.comboLockT = 0;
    this.assists = 0;
    this.evacuated = 0;
    this.penaltyTotal = 0;
  }

  get comboFraction() {
    return this.chain > 0 ? Math.max(0, this.comboTimer / CONFIG.score.comboWindow) : 0;
  }

  update(dt) {
    if (this.comboLockT > 0) this.comboLockT = Math.max(0, this.comboLockT - dt);
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) {
        this.combo = 1;
        this.chain = 0;
      }
    }
    if (this.multiTimer > 0) {
      this.multiTimer -= dt;
      if (this.multiTimer <= 0) this.multiCount = 0;
    }
  }

  onKill(e) {
    // 아군이 마무리한 적을 플레이어가 먼저 맞혔다면 어시스트 (그 외 아군 처치는 점수 없음)
    if (e.attacker && e.attacker !== 'player' && e.attackerFaction === 'ally' && e.trueFaction === 'enemy' && e.victim.playerDamaged) {
      this._bonus(CONFIG.score.assist, '어시스트', 'assist', () => this.assists++);
      return;
    }
    if (e.attacker !== 'player') return;
    if (e.trueFaction !== 'enemy') return; // 오인 사격은 PenaltySystem 이 처리
    const S = CONFIG.score;
    this.kills++;
    let pts = S.kill;
    const labels = [];
    if (e.headshot) {
      pts += S.headshot;
      this.headshots++;
      labels.push('헤드샷');
    }
    if (e.timeSinceFirstSeen != null && e.timeSinceFirstSeen <= S.quickKillWindow) {
      pts += S.quickKill;
      this.quickKills++;
      labels.push('즉응');
    }
    // 멀티킬
    if (this.multiTimer > 0) this.multiCount++;
    else this.multiCount = 1;
    this.multiTimer = S.multiKillWindow;
    if (this.multiCount === 2) {
      pts += S.multiKill2;
      labels.push('더블킬');
      this.multiKills++;
    } else if (this.multiCount >= 3) {
      pts += S.multiKill3;
      labels.push(this.multiCount === 3 ? '트리플킬' : `${this.multiCount}연속킬`);
      this.multiKills++;
    }
    // 콤보: 5초 안에 연속 사살하면 배율 상승 (오인 사격 후 잠금 중엔 쌓이지 않음)
    if (this.comboLockT > 0) {
      this.chain = 0;
      this.combo = 1;
    } else if (this.comboTimer > 0) {
      this.chain++;
      this.combo = Math.min(S.comboMax, 1 + S.comboStep * (this.chain - 1));
    } else {
      this.chain = 1;
      this.combo = 1;
    }
    this.comboTimer = this.comboLockT > 0 ? 0 : S.comboWindow;
    this.bestChain = Math.max(this.bestChain, this.chain);
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    const total = Math.round(pts * this.combo);
    this.score += total;
    this.game.events.emit(Events.SCORE_KILL, { points: total, base: pts, labels, combo: this.combo, chain: this.chain, headshot: e.headshot, victim: e.victim });
  }

  result(time) {
    const minutes = Math.max(time / 60, 1 / 60);
    return {
      score: this.score,
      kills: this.kills,
      headshots: this.headshots,
      headshotRatio: this.kills ? this.headshots / this.kills : 0,
      kpm: this.kills / minutes,
      bestChain: this.bestChain,
      bestCombo: this.bestCombo,
      quickKills: this.quickKills,
      assists: this.assists,
      evacuated: this.evacuated,
      penaltyTotal: this.penaltyTotal,
      time,
    };
  }
}
