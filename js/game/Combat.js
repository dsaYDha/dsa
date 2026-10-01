// 히트스캔 판정 — 벽 관통 없음. 월드(Octree)와 NPC 히트박스 중 가까운 쪽에 맞는다
import { CONFIG } from '../config.js';

export class Combat {
  constructor(game) {
    this.game = game;
  }

  /**
   * 플레이어 사격
   * @returns {{ point: THREE.Vector3, npc?: object, zone?: string, distance: number }}
   */
  playerShot(origin, dir) {
    const game = this.game;
    const W = CONFIG.weapon;
    const worldHit = game.world.raycast(origin, dir, W.range);
    const limit = worldHit ? worldHit.distance : W.range;
    const npcHit = game.npcs.raycast(origin, dir, limit);
    if (npcHit) {
      const npc = npcHit.npc;
      const mul = W.zoneMultiplier[npcHit.zone] ?? 1;
      const amount = W.damage * mul;
      npc.takeDamage({ amount, zone: npcHit.zone, attacker: 'player', direction: dir, point: npcHit.point, distance: npcHit.distance });
      game.effects.blood(npcHit.point, dir);
      return { point: npcHit.point, npc, zone: npcHit.zone, distance: npcHit.distance };
    }
    if (worldHit) {
      game.effects.impact(worldHit.point, worldHit.normal, worldHit.surface);
      game.audio.impact(worldHit.point, worldHit.surface);
      return { point: worldHit.point.clone(), distance: worldHit.distance };
    }
    return { point: origin.clone().addScaledVector(dir, W.range), distance: W.range };
  }
}
