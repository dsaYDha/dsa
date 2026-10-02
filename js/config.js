// =====================================================================
// 피아식별 — 튜닝 수치·키 설정 (모든 밸런스 값은 이 파일 한곳에서 조절)
// =====================================================================
// 단위: 거리 m, 시간 초, 각도는 별도 표기가 없으면 '도(deg)'

export const CONFIG = {
  version: '0.3.0 (3단계: 위장 적·관찰)',

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
    observe: ['KeyQ'], // 3단계: 관찰 모드 (누르고 있기)
    debug: ['Backquote'],
  },
  // 4단계(말 걸기·문답)용으로 비워 둔 키 — 어떤 기능에도 묶지 않음
  reservedKeys: {
    interact: ['KeyE'], // 4단계: 말 걸기
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
    civilian: { label: '민간인', insignia: null, uniform: null, vest: null }, // 사복 — 복장은 npc/Outfits.js 에서 무작위 조합
  },
  insignia: { emissive: 1.35, armbandHeight: 0.13, helmetBandHeight: 0.07, tapeColor: 0x2c9dff }, // tapeColor: 위장 적의 급조 테이프 (진짜보다 하늘빛)

  // 장비 세트 — 진짜 적·아군은 항상 자기 진영 세트를 일관되게 갖춘다 (3단계 위장 판별의 기준)
  // 먼 거리에선 거의 구분되지 않고 가까이서만 보이는 차이
  gearSets: {
    enemy: { helmetStyle: 'enemy', rifleStyle: 'curved', footwear: 'combat' }, // 챙 있는 둥근 헬멧, 굽은 탄창·나무 개머리판
    ally: { helmetStyle: 'ally', rifleStyle: 'straight', footwear: 'combat', patch: 'shield' }, // 낮고 넓은 헬멧(뒷목 가리개), 직선 탄창·검은 개머리판, 어깨 파란 방패 패치
  },

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
    accuracyVsNpc: 0.75, // 적이 아군 NPC 를 쏠 때 명중률 배율
    damageVsNpcMul: 1.5, // 적이 아군 NPC 에게 주는 피해 배율
    yieldRadius: 0.75, // 앞에 다른 NPC 가 있으면 감속 (겹쳐 지나가지 않게)
    coverPeek: [0.9, 2.2], // 엄폐 상태에서 숨어있는 시간
    aggressionTime: [14, 24], // 이 시간 이상 교착되면 우회/돌격 고려
    whizRadius: 2.2,
  },

  // ------------------------------------------------------------------
  // 아군 — 파란 표식, 2~4명 분대, 보조 역할(낮은 명중률의 제압 사격)
  // ------------------------------------------------------------------
  ally: {
    maxActive: 6,
    squadSize: [2, 4],
    health: 120, // 머리 1발(30×3.6)로는 죽지 않음 — 빗나간 한 발엔 멈출 기회가 있게
    walk: 1.8,
    run: 4.4,
    accuracy: 0.12, // 낮게 — 적 처치의 주인공은 플레이어
    damage: 22, // 1발 피해 (부위 배율은 weapon.zoneMultiplier)
    headChance: 0.06,
    burst: [3, 6],
    burstPause: [0.55, 1.2],
    magSize: 30,
    reloadTime: 2.6,
    sightRange: 60,
    sightFov: 150,
    perceptionInterval: [0.2, 0.32],
    reaction: [0.4, 0.75],
    suppressRadius: 1.8, // 이 거리 안으로 지나간 아군 탄은 적을 숨게 만듦
    objectiveInterval: [6, 11], // 분대 목표 재평가 주기
    advanceStopDist: [14, 24], // 적과 이 거리에서 멈춰 엄폐
    clearChance: 0.3, // 적이 없을 때 근처 건물 실내 소탕 확률
    regroupDist: [7, 14], // 적이 없으면 플레이어 근처로
    sightLine: { width: 0.8, holdTime: 0.45, crossChance: 0.25, cooldown: 2.5 }, // 사선 회피
    calloutCooldown: 6, // 같은 분대 콜아웃 최소 간격
    initialSquad: true, // 시작 직후 플레이어 근처에 분대 하나
    // 분대 교대: 이 시간이 지나고 교전이 잠잠하면 다른 구역으로 이동(화면 밖에서 퇴장) → 새 증원 분대가 들어올 자리
    tour: [55, 95],
    minTour: 35, // 증원 대기 중이면 이 시간 이후 교대 앞당김
    withdrawQuiet: 8, // 마지막 교전 후 이만큼 조용해야 이동
    withdrawDist: [32, 60], // 이동 목표 (플레이어로부터)
    leaveDist: 24, // 플레이어 화면 밖 + 이 거리 이상이면 퇴장
  },

  // ------------------------------------------------------------------
  // 민간인 — 표식 없는 사복, 비무장
  // ------------------------------------------------------------------
  civilian: {
    maxActive: 10,
    health: 50,
    walk: 1.4,
    run: 4.0,
    elderChance: 0.3,
    elderSpeedMul: 0.6,
    hearRadius: 24, // 이 안의 총성에 웅크림·비명
    cowerTime: [2.0, 4.5],
    calmBeforeFlee: [3.0, 6.0], // 마지막 총성 뒤 이만큼 조용해야 대피 시작
    fleeCheck: [1.2, 3.0],
    fleeChance: 0.35,
    lullFleeMul: 2.5, // 소강 구간엔 대피 이동 증가
    aimReactDist: 24, // 플레이어가 이 거리 안에서 조준하면 손을 듦
    aimReactTime: 0.25,
    handsUpRelease: 1.3,
    shoutCooldown: 6,
    panicRadius: 35, // 민간인 사망 시 이 안의 민간인이 흩어져 도망
    panicTime: 20,
    initialCount: [3, 5], // 시작 시 건물·차량 뒤에 숨어 있는 민간인
    evacEdgeDist: 13, // 맵 가장자리에서 이 거리 안의 도로·골목 노드가 대피 지점
  },

  // ------------------------------------------------------------------
  // 오인 사격 페널티 — 판정은 피해자의 trueFaction 기준
  // ------------------------------------------------------------------
  penalty: {
    allyHit: -200,
    allyKill: -1000,
    allyKillComboLock: 10, // 초
    allyKillRadioMute: 30, // 초 — 아군 무전 콜아웃 중단
    civHit: -300,
    civKill: -1500,
    civKillComboLock: 15,
    maxWarnings: 3, // 누적 시 작전 해임 (게임 오버)
  },

  // ------------------------------------------------------------------
  // 3단계: 위장 적 — 가짜 아군(파란 표식) / 가짜 민간인(사복). trueFaction 은 enemy
  // 장비 단서 = 확정 증거(진짜에겐 없음, 작고 가까이서만 보임), 행동 단서 = 의심 근거(진짜도 가끔 비슷하게 행동)
  // [a, b] 쌍은 위협 단계 fromThreat → 최고 단계로 보간
  // ------------------------------------------------------------------
  disguise: {
    fromThreat: 2, // 첫 1분(위협 1단계)엔 위장 적 없음
    allyChance: [0.1, 0.3], // 아군처럼 보이는 등장 중 위장 적 비율
    civilianChance: [0.1, 0.25], // 민간인처럼 보이는 등장 중 위장 적 비율
    maxActive: [2, 3], // 동시 활성 위장 적 상한
    gearClues: [[2, 3], [0, 1]], // 위장 적의 장비 단서 수 (초반 2~3개 → 후반 0~1개, 0개 = 완벽 위장)
    behaviorTraits: [2, 3], // 행동 성향 수 (실제로 그 상황이 일어나야 단서가 됨)
    scoutChance: { ally: 0.15, civilian: 0.55 }, // 정찰형 비율 (나머지는 기습형)
    escortChance: 0.35, // 가짜 아군 기습형 중 '동행'으로 접근하는 비율
    nearSquadChance: 0.6, // 가짜 아군이 기존 아군 분대 근처에서 등장할 확률
    nearCiviliansChance: 0.6, // 가짜 민간인이 다른 민간인 근처에서 등장할 확률
    assaultInfiltrate: [0.35, 0.6], // 습격 구간 시작 시 혼란을 틈탄 위장 적 접근 확률
    blendTime: [6, 14], // 등장 후 섞여 있는 시간 (그 뒤 접근·동행·감시)
    ambush: {
      range: 10, // 이 거리 안에서만 기습
      opportunityDelay: [0.35, 0.8], // 기회(등 돌림·재장전·관찰 모드)가 이만큼 이어지면 기습
      patience: [[13, 20], [7, 12]], // 가까이 붙은 뒤 이 시간이 지나면 기습
      escortPatience: [[22, 34], [12, 20]], // 동행형은 등 뒤가 기본 위치라 더 오래 기다림
      backAngle: 110, // 플레이어 시선에서 이 각도 이상 벗어나 있으면 '등을 보임'
      telegraph: [0.5, 0.8], // 정체를 드러내는 예고 동작(무기 꺼내기 + 장전음) 시간
      damagedTelegraph: 0.35, // 먼저 맞았을 때는 더 짧게
      accuracyMul: 1.5, // 드러낸 직후 근거리 명중률 배율
      hotTime: 5, // 그 배율 유지 시간
    },
    scout: {
      watchToCall: [[16, 24], [9, 15]], // 플레이어를 이만큼 지켜보면 습격을 부름
      callTime: 1.4, // 무전 동작 시간
      revealAfterCall: [4, 7], // 부른 뒤 습격과 함께 정체를 드러내기까지
      watchRange: [12, 38],
      longWatchClue: 6, // 이 시간 넘게 지켜보면 '오래 내다봄' 단서
    },
    // 오판 유도용 진짜 행동 (위장 적과 비슷한 빈도)
    decoy: {
      allyChance: [0.3, 0.5], // 아군 분대 등장 중 낙오병(합류하러 다가옴)·동행 엄호
      regroupEscortChance: 0.2, // 플레이어 곁으로 재집결하는 분대가 한 명을 동행으로 붙일 확률 (위장 적 동행과 섞이게)
      civilianChance: [0.12, 0.25], // 민간인 등장 중 얼어붙음(웅크리지 못함)·도움 요청(다가옴)
      escortTime: [35, 70],
      frozenTime: [8, 18],
    },
  },

  // 3단계: 관찰 모드 (Q 누르고 있기) — 총을 내리고 집중, 사실을 하나씩 알아챔 (결론은 보여주지 않음)
  observe: {
    zoom: 2, // 시야 확대 배율
    raiseTime: 0.3, // Q 를 떼면 총을 다시 드는 시간 (사격 불가)
    blendTime: 0.18, // 화면 전환 시간
    coneDeg: 6, // 화면 중앙에서 이 각도 안의 가장 가까운 NPC
    maxDistance: 70,
    factInterval: 0.5, // 가까이서 사실 하나를 알아채는 시간
    nearDist: 8, // 이 거리까지는 기본 속도
    slowPerMeter: 1 / 12, // 그보다 멀면 1m 마다 이만큼 느려짐 (20m = 2배, 32m = 3배)
    gearMaxDist: 38, // 이보다 멀면 장비 세부는 안 보임
    darkInterior: 0.6, // 실내 어둠 정도가 이 이상이면 손전등이 비춰야 장비가 보임
    outlineTime: 8, // 이상 단서를 찾은 대상의 노란 윤곽 표시 시간
    memoLinger: 3.5, // Q 를 뗀 뒤 메모가 남는 시간
    moveMul: 0.6, // 관찰 중 이동 속도 배율
    sensitivityMul: 0.5, // 관찰 중 마우스 감도 배율
    ambientDuck: 0.4, // 주변 소리 줄임
  },

  // 자막·음성
  voice: {
    maxLines: 3,
    baseDuration: 1.7,
    perChar: 0.06,
    dedupeWindow: 3,
    speechVolume: 1,
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
    // 출현 비율 (적:아군:민간인). 적 출현 1회마다 아군·민간인 '출현 크레딧'이 비율대로 쌓인다
    mix: { enemy: 65, ally: 15, civilian: 20 },
    assaultAllyMul: 2.0, // 습격 구간엔 아군 증원 확률 증가
    mixNearEnemyChance: [0.15, 0.6], // 위협 단계 1 → 최고: 아군·민간인이 교전 중인 적 근처에 나타날 확률
    // 돌발 조우 — 근거리 출입구·모퉁이에서 갑자기 등장 (판단 시험 구간)
    ambush: {
      interval: [38, 70],
      intervalAtMax: [20, 38],
      firstAfter: 25,
      minDist: 3.5,
      maxDist: 8,
      mix: { enemy: 50, ally: 25, civilian: 25 },
      cueLead: [0.25, 0.5],
    },
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
    assist: 30, // 플레이어가 먼저 맞힌 적을 아군이 마무리
    evacuation: 25, // 민간인 대피 성공
    disguiseId: 200, // 정체를 드러내기 전에 위장 적 사살 ("위장 적 식별")
    evidence: 100, // 그 위장 적에게서 관찰로 이상 단서를 1개 이상 찾은 뒤 사살 ("근거 있는 판단")
  },

  audio: {
    masterVolume: 0.8,
    reverbSeconds: 1.9,
    maxNpcFootsteps: 6,
  },

  // 기본 설정값 (일시정지 메뉴에서 변경, localStorage 저장)
  defaults: { sensitivity: 1.0, fov: 78, volume: 0.8, speech: false },
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
