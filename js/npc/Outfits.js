// 복장 조합 — 진영별 장비 세트와 민간인 사복 무작위 조합
// 진짜 아군·적은 항상 config.gearSets 의 자기 진영 세트를 갖추고,
// 진짜 민간인은 항상 비무장·민간 신발·맨손(손이 보이는 상태)을 유지한다. (3단계 위장 판별 기준)
import { CONFIG } from '../config.js';
import { gameRand } from '../core/Random.js';
import { defaultOutfit } from './HumanoidRig.js';

// 군인 복장: 진영 색 + 장비 세트
export function soldierOutfit(faction) {
  const o = defaultOutfit(CONFIG.factions[faction]);
  const gear = CONFIG.gearSets[faction];
  if (gear) Object.assign(o, gear);
  return o;
}

// 민간인 팔레트 (군복 올리브 계열은 피함)
const TOPS = [0x7a3b32, 0x2f4a6b, 0x8a8172, 0x5b4a6e, 0x9b9488, 0x6b4a2e, 0xa86b2c, 0x30302e, 0x7d2f45, 0x3f5f6f, 0xb3a58a];
const PANTS = [0x2c3e5c, 0x3a3a3a, 0x5a4a3a, 0x4a4f55, 0x22252b, 0x6a5a48];
const SKIN = [0xc69078, 0xb08066, 0x8d5e45, 0xd2a088, 0xa87458];
const HAIR = [0x1c1612, 0x3a2a1c, 0x6b4a2e, 0x2a2420];
const HAT = [0x3a3a3a, 0x5a3a2a, 0x2f3f5a, 0x7a2f2f, 0x8a8478];
const BAGS = [0x3a3028, 0x5a3a22, 0x2a2a30, 0x6a5a40];

// 민간인 복장 무작위 조합 (성인·노인만)
export function civilianOutfit(rng = gameRand, elder = rng.chance(CONFIG.civilian.elderChance)) {
  const skin = rng.pick(SKIN);
  const top = elder ? rng.weighted({ coat: 0.45, sweater: 0.3, jacket: 0.15, shirt: 0.1 }) : rng.weighted({ shirt: 0.3, jacket: 0.35, sweater: 0.2, coat: 0.15 });
  const headwear = elder ? rng.weighted({ none: 0.35, hat: 0.4, cap: 0.1, beanie: 0.15 }) : rng.weighted({ none: 0.55, cap: 0.2, beanie: 0.2, hat: 0.05 });
  const footwear = elder ? rng.weighted({ dress: 0.5, work: 0.25, sneakers: 0.25 }) : rng.weighted({ sneakers: 0.55, dress: 0.2, work: 0.25 });
  const bag = rng.weighted({ none: 0.45, backpack: 0.2, shoulder: 0.15, carry: 0.2 });
  return {
    uniform: rng.pick(TOPS),
    vest: null,
    pants: rng.pick(PANTS),
    skin,
    boots: rng.pick([0x8a2a2a, 0x2a4a8a, 0x3a3a3a, 0x8a8a8a]), // 운동화 밑창 색
    helmet: rng.pick(HAT),
    gloves: skin, // 맨손
    hair: rng.pick(HAIR),
    headwear,
    helmetStyle: 'none',
    rifle: false,
    rifleStyle: null,
    footwear,
    top,
    bag: bag === 'none' ? null : bag,
    bagColor: rng.pick(BAGS),
    elder,
  };
}

/**
 * NPC 장비 구성 데이터 (3단계 시각 단서 판정용)
 * @returns {{ faction, headwear, helmetStyle, weapon, rifleStyle, magazine, footwear, footwearClass, vest, top, bag, elder,
 *            insignia: {visible, color, colorName, shape}, hands }}
 */
export function describeEquipment(npc) {
  const o = npc.rig.outfit;
  const armed = !!o.rifle;
  return {
    faction: npc.apparentFaction, // 겉보기 기준 (진짜 소속은 npc.trueFaction)
    headwear: o.headwear,
    helmetStyle: o.headwear === 'helmet' ? o.helmetStyle : null,
    weapon: armed ? 'rifle' : null,
    rifleStyle: armed ? o.rifleStyle : null,
    magazine: armed ? (o.rifleStyle === 'straight' ? 'straight' : 'curved') : null,
    footwear: o.footwear,
    footwearClass: o.footwear === 'combat' ? 'military' : 'civilian',
    vest: o.vest != null,
    top: o.top,
    bag: o.bag || null,
    elder: !!o.elder,
    insignia: npc.insignia.describe(),
    hands: npc.handsState ? npc.handsState() : armed ? 'weapon' : 'empty',
  };
}
