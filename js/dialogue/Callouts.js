// 무전 콜아웃·외침 문장 — 적 위치를 플레이어 기준 방위(북=-z, 동=+x)·장소·층·거리로 설명해 실제로 도움이 되게
import { gameRand as R } from '../core/Random.js';

export const DIRS8 = ['북', '북동', '동', '남동', '남', '남서', '서', '북서'];

// 방위각(도, 북=0 시계방향) — 화면 나침반과 같은 기준
export function bearingDeg(fromX, fromZ, toX, toZ) {
  return (Math.atan2(toX - fromX, -(toZ - fromZ)) * 180 / Math.PI + 360) % 360;
}

export function dirName(deg) {
  return DIRS8[Math.round(deg / 45) % 8];
}

const COVER_NAMES = { car: '차량 뒤', sandbag: '모래주머니 뒤', barrier: '방벽 뒤', rubble: '잔해 뒤', crate: '상자 뒤' };

/**
 * NPC 위치 설명
 * @returns {{ place: string, dir: string, dist: number, range: string }}
 */
export function describeLocation(game, npc) {
  const p = game.player.feet;
  const pos = npc.position;
  const dist = Math.hypot(pos.x - p.x, pos.z - p.z);
  const dir = dirName(bearingDeg(p.x, p.z, pos.x, pos.z));
  const nav = game.world.nav;
  const node = npc.navNode != null ? nav.get(npc.navNode) : null;
  const info = game.world.getIndoorInfo(pos);
  let place;
  if (info) {
    const fl = info.floor + 1;
    if (node && node.type === 'window') place = `${dir}쪽 건물 ${fl}층 창문`;
    else place = fl > 1 ? `${dir}쪽 건물 ${fl}층` : `${dir}쪽 건물 안`;
  } else if (pos.y > 2.5) {
    place = `${dir}쪽 옥상`;
  } else if (node) {
    if (node.type === 'alley') place = `${dir}쪽 골목`;
    else if (node.type === 'cover') place = `${dir}쪽 ${COVER_NAMES[node.tags && node.tags.kind] || '엄폐물 뒤'}`;
    else if (node.type === 'yard') place = `${dir}쪽 공터`;
    else if (node.type === 'doorOut') place = `${dir}쪽 건물 입구`;
    else place = `${dir}쪽 도로`;
  } else place = `${dir}쪽`;
  const range = dist < 12 ? '근접' : `${Math.round(dist / 5) * 5}미터`;
  return { place, dir, dist, range };
}

// 문장 모음 — {loc}, {range} 치환
export const LINES = {
  allySpotted: ['적 발견, {loc}!', '{loc}에 적! {range}!', '{loc}, 적이다!', '적 확인, {loc} {range}!'],
  allyEngage: ['엄호한다!', '제압 사격!', '사격 개시!'],
  allyReload: ['재장전!', '탄창 교체!'],
  allyKill: ['적 사살!', '하나 잡았다!'],
  allyDown: ['아군 쓰러졌다!', '한 명 당했다!', '부상자 발생!'],
  allyArrive: ['분대 합류한다!', '지원 왔다!', '증원 도착!'],
  allyClearStart: ['건물 진입한다!', '실내 소탕 시작!'],
  allyClearDone: ['클리어!', '건물 확보!'],
  allyWithdraw: ['다른 구역 지원 간다!', '이동한다, 여기 맡긴다!', '분대 이동!'],
  allySightLine: ['사선에서 비킨다!', '쏘지 마, 비킨다!'],
  allyFriendlyFire: ['사격 중지! 아군이다!', '사격 중지! 아군이야!'],
  allyAmbush: ['아군이다! 쏘지 마!', '아군이야, 아군!'],
  allyHurt: ['맞았다!', '피격!'],
  civAimed: ['쏘지 마세요!', '민간인이에요!', '살려주세요! 쏘지 마세요!'],
  civScream: ['꺄악!', '으악!', '살려줘요!', '사람 살려!'],
  civHit: ['아악! 왜 쏴요!', '으아악!'],
  civFlee: ['도망쳐!', '여기서 나가야 해!', '빨리, 빨리!'],
  civPanic: ['사람이 죽었어!', '도망쳐요!'],
};

export function line(kind, vars = {}) {
  const list = LINES[kind];
  let s = R.pick(list);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}
