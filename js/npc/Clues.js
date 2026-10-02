// 3단계 단서 카탈로그 — 관찰 모드가 알아채는 '사실'과 위장 적의 장비 단서
// · 장비 단서(gear) = 확정 증거: 진짜 아군·민간인에게는 절대 나타나지 않음. 작고 가까이서만 보임 (거리·조명 필요)
// · 행동 단서(behavior) = 의심 근거: NPC 마다 실제로 일어난 일만 기록(npc.behavior)되고, 진짜 인물도 가끔 비슷하게 행동함
// 사실(fact)은 { key, text, anomalous, kind: 'gear'|'behavior' } — 관찰 메모에는 결론("적입니다")을 절대 쓰지 않는다
import { gameRand as R } from '../core/Random.js';

// 위장 적 장비 단서 — 겉보기 소속별. apply(outfit) 로 복장에 덧입힌다 (tapeBand 는 표식 컴포넌트에서 처리)
export const GEAR_CLUES = {
  ally: {
    curvedRifle: { label: '굽은 탄창 소총', apply: (o) => { o.rifleStyle = 'curved'; } },
    enemyHelmet: { label: '챙 있는 둥근 헬멧', apply: (o) => { o.helmetStyle = 'enemy'; } },
    patchMissing: { label: '어깨 부대 패치 없음', apply: (o) => { o.patch = null; } },
    patchWrong: { label: '어깨 패치 모양이 다름', apply: (o) => { o.patch = R.chance(0.5) ? 'square' : 'round'; } },
    tapeBand: { label: '테이프 완장', insignia: 'tape' },
  },
  civilian: {
    combatBoots: { label: '군화', apply: (o) => { o.footwear = 'combat'; o.boots = 0x1e1a16; } },
    waistBulge: { label: '허리춤 불룩함', apply: (o) => { o.waistBulge = true; } },
    backRifle: { label: '등 뒤 총몸 윤곽', apply: (o) => { o.backRifle = true; if (o.bag === 'backpack') o.bag = null; } },
    radio: { label: '무전기', apply: (o) => { o.radio = true; } },
    vestStraps: { label: '조끼 끈', apply: (o) => { o.vestStraps = true; } },
    tacticalGloves: { label: '전술 장갑', apply: (o) => { o.tacticalGloves = true; o.gloves = 0x2b2a26; } },
  },
};

// 행동 사실 — anomalous: 의심스러운 행동(위장 적이 주로 보이지만 진짜도 가끔 함)
export const BEHAVIOR = {
  withSquad: { text: '분대와 함께 움직임' },
  loner: { text: '분대와 떨어져 혼자 움직임', anomalous: true },
  firedAtEnemy: { text: '적을 향해 사격함' },
  noFireInFight: { text: '교전 중인데 적에게 쏘지 않음', anomalous: true },
  fireAir: { text: '허공에 대고 쏨', anomalous: true },
  radioAck: { text: '아군 무전에 반응함' },
  ignoreRadio: { text: '아군 무전 지시에 반응하지 않음', anomalous: true },
  stare: { text: '계속 이쪽을 보며 다가옴', anomalous: true },
  escorting: { text: '뒤에서 따라오며 엄호함' },
  fromEnemySide: { text: '적이 있던 쪽에서 나타남', anomalous: true },
  cowered: { text: '총성에 웅크림' },
  noCower: { text: '총성에 웅크리지 않음', anomalous: true },
  handsUpQuick: { text: '조준하자 바로 손을 듦' },
  lateHands: { text: '조준하자 한참 뒤에야 손을 듦', anomalous: true },
  noHands: { text: '조준해도 손을 들지 않음', anomalous: true },
  towardPlayer: { text: '대피하지 않고 이쪽으로 다가옴', anomalous: true },
  helpCry: { text: '도와달라고 외침' },
  fled: { text: '대피로 쪽으로 달아남' },
  hideHands: { text: '손을 숨기고 있음', anomalous: true, variants: { back: '손을 등 뒤로 숨기고 있음', pocket: '손을 주머니에 넣은 채 빼지 않음' } },
  longWatch: { text: '한곳에서 이쪽을 오래 지켜봄', anomalous: true, variants: { window: '창가에서 오래 내다봄' } },
  radioTalk: { text: '무전기에 대고 무언가 말함', anomalous: true },
};

const SHOES = { sneakers: '운동화', dress: '구두', work: '작업화' };
const TOPS = { shirt: '셔츠', jacket: '재킷', coat: '코트', sweater: '스웨터' };

// glow: 빛나는 표식처럼 어두운 곳에서도 보이는 장비
function fact(key, text, anomalous = false, glow = false) {
  return { key: `gear:${key}`, text, anomalous: !!anomalous, kind: 'gear', glow };
}

// 지금 몸에 실제로 있는 장비로 만든 사실 (겉보기 소속 기준으로 이상 여부 판정)
export function gearFacts(npc) {
  const o = npc.rig.outfit;
  const ins = npc.insignia.describe();
  const ap = npc.apparentFaction;
  const out = [];
  if (ap === 'ally' || ap === 'enemy') {
    const asAlly = ap === 'ally';
    if (ins.tape) out.push(fact('insignia', '완장이 테이프로 엉성하게 감겨 있음', asAlly, true));
    else if (ins.colorName === 'blue') out.push(fact('insignia', '파란 완장·헬멧 띠', false, true));
    else if (ins.colorName === 'red') out.push(fact('insignia', '빨간 완장', false, true));
    if (o.headwear === 'helmet') {
      out.push(o.helmetStyle === 'ally' ? fact('helmet', '낮고 넓은 헬멧 (뒷목 가리개)') : fact('helmet', '챙 있는 둥근 헬멧', asAlly));
    }
    if (o.rifle) out.push(o.rifleStyle === 'straight' ? fact('rifle', '직선 탄창 소총') : fact('rifle', '굽은 탄창 소총', asAlly));
    if (o.patch === 'shield') out.push(fact('patch', '어깨 부대 패치: 파란 방패'));
    else if (o.patch) out.push(fact('patch', `어깨 패치 모양이 다름 (${o.patch === 'square' ? '네모' : '동그라미'})`, asAlly));
    else if (asAlly || o.vest != null) out.push(fact('patch', '어깨 부대 패치 없음', asAlly));
    out.push(fact('shoes', o.footwear === 'combat' ? '군화' : SHOES[o.footwear] || '신발'));
    return out;
  }
  // 민간인처럼 보이는 인물
  out.push(fact('clothes', `사복 (${TOPS[o.top] || '평상복'}${o.elder ? ', 노인' : ''})`));
  out.push(o.footwear === 'combat' ? fact('shoes', '군화 착용', true) : fact('shoes', SHOES[o.footwear] || '민간 신발'));
  out.push(o.tacticalGloves ? fact('gloves', '전술 장갑 착용', true) : fact('gloves', '맨손'));
  if (o.bag === 'carry') out.push(fact('bag', '짐 가방을 들고 있음'));
  else if (o.bag === 'backpack') out.push(fact('bag', '배낭을 멤'));
  if (o.waistBulge) out.push(fact('bulge', '허리춤이 불룩함', true));
  if (o.backRifle) out.push(fact('backRifle', '등 뒤로 길쭉한 총몸 윤곽이 비침', true));
  if (o.radio) out.push(fact('radio', '가슴에 무전기를 달고 있음', true));
  if (o.vestStraps) out.push(fact('straps', '옷 위로 조끼 끈이 보임', true));
  return out;
}

// 실제로 기록된 행동만 사실로 (hideHands 는 '지금 하고 있거나 최근' 일 때만)
export function behaviorFacts(npc, time) {
  const out = [];
  if (!npc.behavior) return out;
  for (const [key, rec] of npc.behavior) {
    const def = BEHAVIOR[key];
    if (!def) continue;
    if (key === 'hideHands' && time - rec.t > 12) continue;
    const text = def.variants && rec.variant && def.variants[rec.variant] ? def.variants[rec.variant] : def.text;
    out.push({ key: `beh:${key}`, text, anomalous: !!def.anomalous, kind: 'behavior' });
  }
  return out;
}

export function factsFor(npc, time) {
  return gearFacts(npc).concat(behaviorFacts(npc, time));
}
