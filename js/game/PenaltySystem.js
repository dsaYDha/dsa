// 오인 사격 페널티 — 1단계 피격·사살 이벤트(NPC_DAMAGED / NPC_KILLED)를 구독, 판정은 피해자의 trueFaction 기준
// 아군 피격 -200·콤보 초기화 / 아군 사살 -1000·콤보 초기화·10초 콤보 잠금·경고+1·30초 아군 무전 중단
// 민간인 피격 -300·콤보 초기화 / 민간인 사살 -1500·콤보 초기화·15초 콤보 잠금·경고+1
// 경고 3회 → 작전 해임 (게임 오버). 수치는 config.penalty
import { CONFIG } from '../config.js';
import { Events } from '../core/EventBus.js';

export class PenaltySystem {
  constructor(game) {
    this.game = game;
    this.reset();
    game.events.on(Events.NPC_DAMAGED, (e) => this._onHit(e, false));
    game.events.on(Events.NPC_KILLED, (e) => this._onHit(e, true));
  }

  reset() {
    this.warnings = 0;
    this.allyHits = 0;
    this.allyKills = 0;
    this.civHits = 0;
    this.civKills = 0;
    this.dismissed = false;
    this.log = [];
  }

  _onHit(e, killed) {
    if (e.attacker !== 'player') return; // NPC 끼리의 오사는 무시
    const P = CONFIG.penalty;
    const game = this.game;
    const score = game.score;
    let kind = null;
    let points = 0;
    if (e.trueFaction === 'ally') {
      kind = killed ? 'allyKill' : 'allyHit';
      points = killed ? P.allyKill : P.allyHit;
      if (killed) this.allyKills++;
      else this.allyHits++;
    } else if (e.trueFaction === 'civilian') {
      kind = killed ? 'civKill' : 'civHit';
      points = killed ? P.civKill : P.civHit;
      if (killed) this.civKills++;
      else this.civHits++;
    } else return;

    score.applyPenalty(points);
    score.resetCombo();
    if (kind === 'allyKill') {
      score.lockCombo(P.allyKillComboLock);
      game.voice.mute('radio', P.allyKillRadioMute);
      game.voice.say({ speaker: '무전', text: `아군 무전 두절 (${P.allyKillRadioMute}초)`, channel: 'system', priority: 2, force: true });
    } else if (kind === 'civKill') {
      score.lockCombo(P.civKillComboLock);
    }
    if (killed) this.warnings++;
    this.log.push({ t: game.time, kind, points, apparent: e.apparentFaction });
    game.events.emit(Events.FRIENDLY_FIRE, { kind, points, warnings: this.warnings, maxWarnings: P.maxWarnings, victim: e.victim, apparentFaction: e.apparentFaction });
    if (this.warnings >= P.maxWarnings && !this.dismissed) {
      this.dismissed = true;
      game.events.emit(Events.OPERATION_DISMISSED, { warnings: this.warnings });
    }
  }

  stats() {
    return { warnings: this.warnings, allyHits: this.allyHits, allyKills: this.allyKills, civHits: this.civHits, civKills: this.civKills };
  }
}
