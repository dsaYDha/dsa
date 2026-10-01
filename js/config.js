// =====================================================================
// 피아식별 — 튜닝 수치·키 설정 (모든 밸런스 값은 이 파일 한곳에서 조절)
// =====================================================================
// 단위: 거리 m, 시간 초, 각도는 별도 표기가 없으면 '도(deg)'

export const CONFIG = {
  version: '0.1.0 (1단계: 핵심 사격 루프)',

  // ------------------------------------------------------------------
  // 키 설정 (KeyboardEvent.code 기준 — 한글 IME 상태와 무관하게 동작)
  // Ctrl 은 Ctrl+W 탭 닫힘 위험 때문에 사용하지 않음
  // ------------------------------------------------------------------
  keys: {
    forward: ['KeyW', 'ArrowUp'],
    back: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    sprint: ['ShiftLeft', 'ShiftRight'],
    crouch: ['KeyC'],
    jump: ['Space'],
    reload: ['KeyR'],
    flashlight: ['KeyF'],
    debug: ['Backquote'],
  },
  // 이후 단계(관찰·대화)용으로 비워 둔 키 — 지금은 어떤 기능에도 묶지 않음
  reservedKeys: {
    interact: ['KeyE'], // 4단계: 말 걸기
    observe: ['KeyQ'], // 3단계: 관찰 모드
    dialog1: ['Digit1'], dialog2: ['Digit2'], dialog3: ['Digit3'], dialog4: ['Digit4'], // 4단계: 문답 선택지
  },
  mouse: { fire: 0, aim: 2 }, // 0=좌클릭, 2=우클릭

  // ------------------------------------------------------------------
  // 렌더링
  // ------------------------------------------------------------------
  render: {
    maxPixelRatio: 1.25, // 노트북 60fps를 위해 DPR 상한
    antialias: true,
    near: 0.08,
    far: 900,
    shadowMapSize: 2048,
    shadowRange: 42, // 방향광 그림자 카메라 반경 (플레이어를 따라감)
    exposure: 1.12,
    viewModelFov: 56, // 1인칭 총기 전용 카메라 FOV
    chunkSize: 50, // 정적 지오메트리 병합 청크 크기 (프러스텀 컬링 단위)
  },

  // ------------------------------------------------------------------
  // 맵 생성
  // ------------------------------------------------------------------
  map: {
    defaultSeed: 'PIASIK-1',
    size: 150, // 한 변 길이
    blocksPerSide: 4,
    roadWidth: 10,
    sidewalkWidth: 1.8,
    alleyWidth: 3.2,
    edgeMargin: 4, // 가장자리 잔해 벽 영역
    floorHeight: 3.2,
    wallThickness: 0.3,
    slabThickness: 0.25,
    parapetHeight: 1.05,
    solidFloors: [2, 5], // 진입 불가 건물 층수 범위
    enterableFloors: [2, 3], // 진입 가능 건물 층수 범위 (+옥상)
    enterableCount: 8, // 진입 가능 건물 수 (최소 6 보장)
    roofAccessChance: 0.8,
    stair: { laneWidth: 1.3, run: 4.8, landing: 1.2, steps: 16 },
    door: { width: 1.2, height: 2.25, frontWidth: 1.6, frontHeight: 2.4 },
    window: { width: 1.2, sill: 0.95, top: 2.3, spacing: 2.6 },
    interiorAmbient: 0.38, // 실내 간접광 배율 (실내를 바깥보다 어둡게)
    navSpacing: 3.0, // 실외 내비 그리드 간격
    navLinkRadius: 4.4,
    agentRadius: 0.4,
    propDensity: 1.0,
  },

  // ------------------------------------------------------------------
  // 분위기 (하늘·안개·조명·연기·불)
  // ------------------------------------------------------------------
  atmosphere: {
    fogColor: 0x6b5a52,
    fogDensity: 0.0125,
    sunColor: 0xffa060,
    sunIntensity: 2.4,
    sunElevation: 15, // 해 질 녘 낮은 고도
    sunAzimuth: 235,
    hemiSky: 0xb3a49c,
    hemiGround: 0x4a3c33,
    hemiIntensity: 2.5,
    maxFireLights: 4, // 동시에 켜지는 불길 점광원 최대 수
    fireLightRange: 14,
    fireLightIntensity: 26,
    smokeColumns: 5,
    ashCount: 260,
    horizonFlashInterval: [4, 13],
    distantGunfireInterval: [5, 14],
  },

  // ------------------------------------------------------------------
  // 플레이어
  // ------------------------------------------------------------------
  player: {
    maxHealth: 100,
    regenDelay: 5, // 마지막 피격 후 회복 시작까지 (명세: 5초간 안 맞으면 회복)
    regenRate: 16, // 초당 회복량
    radius: 0.35,
    standHeight: 1.8,
    crouchHeight: 1.2,
    eyeOffset: 0.15, // 머리 끝에서 눈까지
    walkSpeed: 4.3,
    sprintSpeed: 6.9,
    crouchSpeed: 2.2,
    adsSpeedMul: 0.6,
    groundAccel: 11,
    airAccel: 2.2,
    jumpSpeed: 5.6,
    gravity: 21,
    physicsSteps: 5,
    crouchTransition: 9,
    baseSensitivity: 0.0021, // rad / px
    adsSensitivityMul: 0.62,
    bob: { walkAmp: 0.035, sprintAmp: 0.06, crouchAmp: 0.02, stepLength: 2.1, roll: 0.006 },
    flashlight: { intensity: 95, angle: 21, penumbra: 0.45, range: 38 },
  },

  // ------------------------------------------------------------------
  // 무기 — 돌격소총
  // ------------------------------------------------------------------
  weapon: {
    name: 'AR-74',
    damage: 30,
    zoneMultiplier: { head: 3.6, torso: 1.0, arm: 0.75, leg: 0.75 },
    rpm: 640,
    magSize: 30,
    reloadTime: 2.3,
    range: 300,
    // 탄퍼짐 (도)
    spread: {
      hip: 1.1,
      ads: 0.12,
      move: 2.2, // 이동 속도에 비례해 더해짐 (최대치)
      sprint: 3.2,
      air: 4.5,
      crouchMul: 0.7,
      bloomPerShot: 0.32,
      bloomMax: 3.2,
      bloomRecovery: 6.5, // 도/초
      adsBloomMul: 0.45,
    },
    // 반동 (도) — 시점이 튀었다가 복귀
    recoil: { pitch: 0.95, yaw: 0.38, adsMul: 0.62, crouchMul: 0.8, recovery: 9 },
    adsFovMul: 0.66,
    adsTime: 0.17,
    tracerEvery: 2, // n발마다 예광탄
  },

  // ------------------------------------------------------------------
  // 진영 정의 — 표식 색이 피아식별의 핵심
  // trueFaction / apparentFaction 모두 이 키를 사용
  // ------------------------------------------------------------------
  factions: {
    enemy: { label: '적군', insignia: { color: 0xff1a12, shape: 'band' }, uniform: 0x59603f, vest: 0x3d4130 },
    ally: { label: '아군', insignia: { color: 0x1f6dff, shape: 'band' }, uniform: 0x5b6142, vest: 0x3e4231 },
    civilian: { label: '민간인', insignia: null, uniform: null, vest: null },
  },
  insignia: { emissive: 1.35, armbandHeight: 0.13, helmetBandHeight: 0.07 },

  // ------------------------------------------------------------------
  // 적군 유형
  // ------------------------------------------------------------------
  npc: {
    maxHealth: 100,
    zoneHealthNote: '부위 배율은 weapon.zoneMultiplier 사용',
    turnSpeed: 7,
    sightRange: 70,
    sightFov: 125, // 비경계 상태 시야각
    hearingRadius: 55, // 플레이어 총성 감지 반경
    perceptionInterval: [0.16, 0.26], // NPC 마다 분산되는 시야 판정 주기
    loseSightTime: 4.5,
    spawnGrace: 1.4, // 등장 직후 명중 불가 유예
    graceRamp: 1.2, // 유예 이후 명중률이 정상까지 오르는 시간
    corpseTime: 4.0,
    sinkTime: 1.4,
    shotInterval: 0.115,
    hitDamage: { rifleman: 8, assault: 7, window: 10 },
    types: {
      rifleman: { label: '소총수', walk: 1.7, run: 4.3, accuracy: 0.30, burst: [3, 5], burstPause: [0.7, 1.4], preferredRange: [12, 32] },
      assault: { label: '돌격병', walk: 2.2, run: 5.7, accuracy: 0.22, burst: [4, 7], burstPause: [0.45, 0.9], preferredRange: [4, 14] },
      window: { label: '창문 사수', walk: 1.5, run: 3.6, accuracy: 0.36, burst: [3, 4], burstPause: [1.0, 1.8], preferredRange: [10, 50] },
    },
    // 명중률 보정
    accuracy: {
      nearDist: 8, farDist: 60, farFactor: 0.28,
      moveFactor: 0.45, // 플레이어가 전력질주하면 이만큼 감소
      crouchFactor: 0.72,
      burstDecay: 0.07,
      movingShooterFactor: 0.65,
      max: 0.85,
    },
    coverPeek: [0.9, 2.2], // 엄폐 상태에서 숨어있는 시간
    aggressionTime: [14, 24], // 이 시간 이상 교착되면 우회/돌격 고려
    whizRadius: 2.2,
  },

  // ------------------------------------------------------------------
  // 위협 단계 (1분마다 상승) — 레벨 1 → maxLevel 로 선형 보간되는 값들
  // ------------------------------------------------------------------
  threat: {
    secondsPerLevel: 60,
    maxLevel: 10,
    maxActive: [4, 5, 6, 7, 8, 9, 10, 11, 12, 14], // 레벨별 동시 활성 적 상한
    accuracyMul: [0.72, 1.5],
    reactionDelay: [[0.55, 0.8], [0.3, 0.45]], // [레벨1 범위], [최고레벨 범위]
    flankChance: [0.12, 0.6],
    waveSize: [[2, 4], [6, 9]],
    sporadicInterval: [[3.0, 6.5], [1.2, 3.0]],
    lullDuration: [[8, 15], [5, 9]],
    typeWeights: [
      { rifleman: 0.8, assault: 0.2, window: 0.0 },
      { rifleman: 0.5, assault: 0.28, window: 0.22 },
    ],
    windowFromLevel: 2,
  },

  // ------------------------------------------------------------------
  // 스폰 디렉터 (소강 → 산발 → 습격 → 소강 리듬)
  // ------------------------------------------------------------------
  director: {
    firstLull: [2.5, 5],
    sporadicDuration: [14, 28],
    assaultTimeout: 32,
    relaxMaxTime: 22,
    chanceLullToAssault: 0.3,
    chanceSporadicToAssault: 0.6,
    lullStragglerChance: 0.25,
    minSpawnDist: 11,
    minIndoorSpawnDist: 7,
    maxSpawnDist: 58,
    preferredSpawnDist: 26,
    spawnPointCooldown: 12,
    visibilityMarginDeg: 14, // 시야각에 더하는 안전 여유
    cueLead: [0.9, 1.7], // 측면·후방 출현 전 소리 선행 시간
    cueAngleDeg: 65, // 정면에서 이 각도 이상 벗어나면 측면/후방 취급
    cueDistance: 30,
    intensityDecay: 0.045, // 초당 긴장도 감소
    intensityHigh: 0.85, // 이 이상이면 일찍 소강으로
    groupSpreadDeg: 70, // 습격 시 그룹 간 최소 방위각 차
  },

  // ------------------------------------------------------------------
  // 점수
  // ------------------------------------------------------------------
  score: {
    kill: 100,
    headshot: 50,
    quickKill: 50,
    quickKillWindow: 2.0, // 처음 보인 뒤 이 시간 안에 사살
    multiKillWindow: 1.5,
    multiKill2: 100,
    multiKill3: 250,
    comboWindow: 5.0,
    comboStep: 0.5,
    comboMax: 4.0,
  },

  audio: {
    masterVolume: 0.8,
    reverbSeconds: 1.9,
    maxNpcFootsteps: 6,
  },

  // 기본 설정값 (일시정지 메뉴에서 변경, localStorage 저장)
  defaults: { sensitivity: 1.0, fov: 78, volume: 0.8 },
  limits: { sensitivity: [0.2, 3.0], fov: [60, 100], volume: [0, 1] },

  debug: { showNavGraph: false },
};

// 위협 단계 보간 유틸 — 레벨 1이면 t=0, 최고 레벨이면 t=1
export function threatT(level) {
  return Math.min(1, Math.max(0, (level - 1) / (CONFIG.threat.maxLevel - 1)));
}
export function lerpThreat(pair, level) {
  const t = threatT(level);
  return pair[0] + (pair[1] - pair[0]) * t;
}
export function lerpRangeThreat(pairOfRanges, level) {
  const t = threatT(level);
  const [a, b] = pairOfRanges;
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}
