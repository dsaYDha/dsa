# CLAUDE.md — 피아식별 프로젝트 안내

이 파일은 이 저장소에서 작업하는 사람/에이전트를 위한 안내서다. 새 단계를 시작하기 전에 먼저 읽는다.

## 게임 개요

- **가제**: 피아식별 — 전쟁 중인 도심 시가지를 배경으로 한 브라우저 1인칭 시가전 FPS
- **설정**: 양측 군복이 거의 같아 몸에 붙인 색 표식(완장·헬멧 띠)으로 피아를 구분한다.
  적군 = 빨간 표식 / 아군 = 파란 표식 / 민간인 = 표식 없는 사복
- **핵심 재미 1순위**: 언제 어디서 나타날지 모르는 적을 최대한 많이 사살
- **핵심 재미 2순위**: 쏘기 전에 판단해야 하는 긴장감 (아군·민간인 오인 사격 불이익, 위장 적, 말 걸기)
- **설계 원칙**: 빨리 쏠수록 보너스(즉응 사살·콤보)가 크지만 성급하면 오인 사격 → 두 재미가 부딪히게

## 5단계 계획과 진행 상황

| 단계 | 내용 | 상태 |
| --- | --- | --- |
| 1 | 핵심 사격 루프 (맵·플레이어·무기·적군·스폰 디렉터·점수·흐름) | **완료** |
| 2 | 민간인·아군 NPC, 오인 사격 페널티 | **완료** |
| 3 | 위장 적, 시각 단서 관찰 시스템 | 예정 (구조 준비됨) |
| 4 | 말 걸기·구두 문답 (암구호, 실내 확인 문답, "손 들어") | 예정 (구조 준비됨) |
| 5 | 난이도 곡선, 결과 화면, 연출·사운드 마무리, 최적화 | 예정 |

### 1단계에서 구현한 것

- 시드 기반 150m×150m 도심: 4×4 블록 격자 도로, 골목, 2~5층 건물, 가장자리 잔해 둑 + 보이지 않는 벽
- 진입 가능 건물 8채(최소 6 보장): 출입구, 방 3개/층, 꺾인 계단(충돌용 쐐기 경사 + 보이는 계단), 뚫린 창문, 대부분 옥상 진입
- 전쟁 분위기: 무너진 건물·폐허, 잔해 더미(올라설 수 있음), 불탄 차량·버스·컨테이너, 모래주머니·바리케이드·체코 고슴도치, 포탄 구덩이, 깨진/불타는 창, 연기 기둥, 불길(파티클 + 깜박이는 점광원), 흐린 해 질 녘 하늘, 먼지 안개, 날리는 재, 지평선 폭발 섬광 + 지연된 포성, 먼 교전 소리
- 플레이어: 포인터 락, WASD/Shift/C/Space/F, Octree+Capsule 충돌, 앉기 머리 공간 검사, 시점 흔들림·발소리, 체력·비네트·피격 방향·회복
- 돌격소총: 히트스캔 연사, 30발/재장전, 정조준, 반동(튀었다 복귀), 탄퍼짐(이동·연사·공중·앉기 반영, 크로스헤어 연동), 총구 화염·예광탄·피탄(먼지·불꽃·탄흔 풀링), 1인칭 모델 애니메이션, 헤드샷 배율, 히트/킬 마커 + 효과음
- 적군: 파츠 조립식 인간형(GPU 스키닝 1 드로우콜), 실물 표식(완장·헬멧 띠, 발광), 부위별 판정, 절차적 애니메이션, A* 이동, 상태 머신 AI, 3유형(소총수·돌격병·창문 사수), 명중률 모델, 등장 유예, 3D 총성·발소리, 귀 옆 스침 소리 + 화면 흔들림
- 스폰 디렉터: 소강 → 산발 → 습격 → 정리 리듬(무작위 + 긴장도), 시야 밖 생성, 측면·후방 예고음, 1분마다 위협 단계 상승
- 점수·콤보·멀티킬·즉응 사살, HUD(미니맵 없음), 시작/일시정지(감도·FOV·볼륨)/결과 화면, localStorage 저장
- 디버그 오버레이(`` ` ``)

### 2단계에서 구현한 것

- **1단계 버그 수정**: 적 `engage` 지속 시간이 매 프레임 다시 뽑히던 문제(`engageDur` 저장), NPC 끼리 겹쳐 지나가던 문제(`isBlockedAhead` 양보 — 플레이어 몸도 장애물로 취급)
- **공통 병사 베이스 `Soldier`**: 1단계 `EnemySoldier` 의 지각·사격·엄폐 주기·탄창 로직을 뽑아 적·아군이 공유. 대상은 `'player'` 또는 NPC. NPC 대상 사격은 실제 `takeDamage`(공격자 = 그 NPC)로 처리
- **아군 `AllySoldier` + `AllySquad`**: 파란 표식, 아군 장비 세트(낮고 넓은 헬멧·뒷목 가리개, 직선 탄창 소총). 2~4명 분대가 알려진 적 쪽 엄폐 지점으로 전진·교전, 적이 없으면 근처 건물 실내 소탕 또는 플레이어 뒤·옆으로 재집결.
  낮은 명중률(0.12)의 제압 사격(근처로 지나간 탄은 적을 숨게 함), 적만 공격. 무전 콜아웃(적 발견·위치·거리, 엄호, 재장전, 클리어, 피격, 합류·이동).
  사선 회피(조준선 앞에서 앉기/옆 노드로 비키기, 플레이어가 쏘는 중이면 즉시 + 가로지르기 전에 틈 기다림, 가끔은 그냥 가로지름).
  분대 교대: 55~95초 머문 뒤 조용하면 화면 밖으로 이동·퇴장 → 새 증원 분대가 같은 출현 지점에서 등장
- **민간인 `CivilianNPC`**: 사복 파츠(상의 4종·바지·모자 4종·가방 3종·짐 들기·사복 신발), 성인·노인(구부정·느림), 비무장 맨손.
  상태 `enter → move → hide/peek → cower → flee → (대피 성공 시 사라짐)`. 방 안 가구 옆·창가·차량 뒤에 숨고, 근처 총성에 웅크려 비명,
  조용해지면(또는 여러 번 웅크린 뒤 짧은 틈에) 맵 가장자리 대피 지점으로 달아남. 가까이서 조준당하면 움찔 → 손 들기 + "쏘지 마세요!".
  민간인이 죽으면 반경 35m 민간인 공황(흩어져 도주). 적·아군 탄은 민간인을 맞히지 않음
- **오인 사격 `PenaltySystem`**: 1단계 `NPC_DAMAGED/KILLED` 구독 → 피해자 `trueFaction` 기준 감점·콤보 초기화/잠금·경고·아군 무전 두절, 경고 3회 → `OPERATION_DISMISSED` → 작전 해임 결과 화면
- **스폰 디렉터 확장**: 출현 비율 적 65 / 아군 15 / 민간인 20 (크레딧 방식), 아군·민간인도 적과 같은 출현 지점·등장 방식·예고음.
  돌발 조우(8m 이내 출입구·모퉁이, 적 50/아군 25/민간인 25, 짧은 예고음), 위협 단계가 오를수록 교전 중인 적 근처에 섞여 등장,
  습격 구간 아군 증원 2배, 소강·정리 구간·공황 중 민간인 대피 증가, 종류별 상한(적 4~14 / 아군 6 / 민간인 10)
- **자막·음성 `VoiceSystem`**: 하단 자막(화자 라벨, 우선순위 큐, 중복 억제, 채널 차단), 선택적 Web Speech(ko-KR, NPC 마다 음높이·속도), 설정 토글(기본 꺼짐)
- **HUD·결과**: 경고 (0/3), 콤보 잠금 남은 시간, 나침반(무전 방위 확인용), 자막, 오인 사격 피드백(가장자리 섬광·전용 마커·효과음·중앙 경고 문구).
  결과 화면에 종료 사유(전사/작전 해임)와 아군·민간인 피격/사살, 대피, 어시스트, 오인 사격 감점, 경고
- **디버그 오버레이**: 종류별 활성 수/상한, 출현 누계·비율, 크레딧, 돌발 조우, 페널티 상태, 모든 NPC 머리 위 `trueFaction`(겉보기와 다르면 함께)
- 다음 단계 준비: 모든 NPC 장비 구성을 데이터로 조회(`npc.getEquipment()`), `E`·`Q`·`1~4` 미사용 유지

## 실행·테스트

- 실행: 저장소 루트에서 `python3 -m http.server 8000` → `http://localhost:8000` (자세한 내용은 README.md)
- URL 옵션: `?seed=문자열`, `?nolock`(포인터 락 없이 진행 — 자동화 테스트용)
- 콘솔에서 `window.__game` 으로 모든 시스템에 접근할 수 있다.
  - 시뮬레이션만 빠르게 돌리기: `__game._updatePlaying(1/30)` 반복 호출 (렌더 없이 AI·디렉터 진행)
  - 위치 이동: `__game.debugTeleport(x, y, z, yaw)`
- 1단계 검증은 Playwright(헤드리스 Chromium, CDN 요청을 로컬 three@0.170.0 사본으로 라우팅)로 했다:
  시작→출현→사살→사망→결과→재시작, 8개 건물 모두 문→계단→최상층/옥상 키 입력 보행, 창밖 시야,
  시야 안 생성 0건(2개 시드, 각 5분 봇 플레이 50여 회 생성 중), 콘솔 에러·경고 0건, 같은 시드 재생성 결정성.
  헤드리스는 GPU 가 아니라 FPS 대신 드로우콜(적 9명 기준 약 210)과 업데이트 CPU 시간(약 1ms)으로 성능을 확인했다.
- 2단계 검증(같은 Playwright 환경): 1단계 회귀(8개 건물 계단 보행, 사망→결과→재시작, 일시정지, 시드 결정성) 통과, 콘솔 에러·경고 0건.
  오인 사격 → 경고 3회 → 작전 해임 결과 화면, 적·아군·민간인 근접 외형/자세 스크린샷, 아군↔적 교전·사살·어시스트, 민간인 숨기·웅크림·대피·손 들기,
  출현 비율(여러 시드 300초: 적 61~65 / 아군 15~20 / 민간인 17~20%), 돌발 조우 300초당 4~5회.
  NPC 27명(적 12·아군 5·민간인 9) 동시: 드로우콜 206~235, 업데이트 약 0.6ms/프레임.
  '확인 후 사격' 봇 vs '보이는 대로 사격' 봇 비교는 아래 "기대 점수 분석" 참고.

## 폴더 구조

```
index.html            진입점 (import map 으로 three@0.170.0 CDN, HUD/메뉴 DOM)
css/style.css         UI 스타일
js/
  main.js             엔트리
  config.js           ★ 모든 튜닝 수치·키 설정 (데미지, 연사, 스폰, 점수, 위협 단계, 조명 등)
  core/
    Game.js           렌더러·씬·시스템 연결, 상태 머신(loading/menu/playing/paused/dead/result), 메인 루프
    EventBus.js       이벤트 버스 + 이벤트 이름 상수(Events)
    Input.js          키보드(code)·마우스·포인터 락
    Settings.js       설정·최고 기록 localStorage
    Random.js         시드 RNG(mulberry32), gameRand(비결정)
  world/
    World.js          맵 생성 오케스트레이션 + 질의(isIndoors, getIndoorInfo, raycast, hasLineOfSight)
    CityGenerator.js  블록·필지·도로·소품 배치, 실외 내비 그래프, 출현 지점 카탈로그
    Buildings.js      진입 가능 건물(방·계단·창·노드), 진입 불가 건물, 폐허 / LocalFrame(건물 로컬 좌표)
    Props.js          차량·모래주머니·바리케이드·잔해·구덩이·가로등·전선 (반복물은 InstancedMesh)
    GeometryBatcher.js 정적 지오메트리를 (청크×재질)로 병합 + 충돌 삼각형 등록
    Collision.js      Octree(깊이 제한) + 캡슐 충돌 + 거리 제한 레이캐스트/시야 판정
    NavGraph.js       웨이포인트 그래프 + A*(이진 힙) + 2D 점유 격자
    Materials.js      재질 + 실내 음영 셰이더 패치(patchInterior)
    Textures.js       CanvasTexture 절차 생성
    Atmosphere.js     하늘 셰이더·안개·태양(그림자 추적)·불빛 풀·연기 기둥·재·지평선 섬광
  fx/
    Particles.js      인스턴스 빌보드 파티클 (시스템당 드로우콜 1)
    Effects.js        피탄·피·예광탄·탄흔 풀·적 총구 화염·플레이어 총구 섬광
  audio/AudioSystem.js Web Audio 합성 전부 (총성·발소리·문·잔해·유리·스침·포성·바람·심장박동)
  player/
    Player.js         이동·충돌·시점·흔들림·체력
    Weapon.js         소총 로직 (발사·탄퍼짐·반동·재장전·정조준)
    WeaponView.js     1인칭 총기 모델·애니메이션 (별도 씬/카메라 패스)
  npc/
    NPCBase.js        ★ 모든 인물 NPC 공통 베이스 (trueFaction/apparentFaction, 피해·사망 이벤트, 경로 이동, 장비 조회·적대 판정)
    HumanoidRig.js    파츠 조립식 인간형 + 절차적 애니메이션 (뼈별 강체 스키닝 SkinnedMesh) — 헬멧·소총·신발·상의·가방 변형, 손 들기·웅크림·짐 들기 자세
    Outfits.js        ★ 복장 생성 (soldierOutfit: 진영 장비 세트 / civilianOutfit: 사복 무작위) + describeEquipment (장비 데이터)
    Insignia.js       ★ 표식 컴포넌트 (색·형태 교체 가능, 헬멧 형태별 띠, describe())
    Soldier.js        ★ 적·아군 공통 병사 베이스 (지각·대상 선택·조준·점사·탄창·엄폐 주기·NPC 대상 사격)
    EnemySoldier.js   적군 AI 상태 머신 (소총수/돌격병/창문 사수) — 플레이어 우선, 근처 아군도 공격
    AllySoldier.js    아군 AI (enter/move/cover/hold/clear, 사선 회피, 분대 교대 퇴장)
    AllySquad.js      아군 분대 (목표: 전진·실내 소탕·재집결·교대 이동, 무전 콜아웃)
    CivilianNPC.js    민간인 AI (숨기·엿보기·웅크림·대피·손 들기·공황)
    NPCManager.js     생성(spawnEnemy/spawnAllySquad/spawnCivilian)·갱신·히트박스 레이캐스트·엄폐/창가 선택·화면 노출 추적·getAimedNPC·진영별 목록·대피 지점
  director/
    SpawnDirector.js  ★ 스폰 디렉터 (리듬·출현 지점·예고음·위협 단계, 인구/생성기 등록 구조, 출현 비율 크레딧, spawnAppearance)
    Populations.js    등록되는 인구: AllyPopulation(증원 분대·교대), CivilianPopulation(초기 배치·등장·대피 유도), AmbushEvent(돌발 조우)
  dialogue/
    VoiceSystem.js    ★ 자막·음성 모듈 (화자 라벨, 우선순위 큐, 채널 차단, Web Speech 선택) — 4단계 문답에서 재사용
    Callouts.js       무전·외침 대사 목록(LINES), 방위·위치 묘사(describeLocation: "동쪽 건물 2층 창문" 등)
  game/
    ScoreSystem.js    점수·콤보·멀티킬·즉응 사살·결과 통계 + 감점(applyPenalty)·콤보 초기화/잠금·어시스트·대피 점수
    PenaltySystem.js  ★ 오인 사격 페널티 (감점·콤보 잠금·경고·무전 두절·작전 해임)
    Combat.js         히트스캔 판정 (월드 vs NPC 히트박스, 가까운 쪽)
  ui/
    HUD.js            HUD 전체
    Menus.js          시작·일시정지·결과 화면
    DebugOverlay.js   디버그 오버레이
```

## config 위치

모든 튜닝 수치와 키 설정은 **`js/config.js`** 한 파일에 있다.
`CONFIG.keys`(키), `CONFIG.reservedKeys`(E·Q·1~4 예약), `CONFIG.weapon`, `CONFIG.npc`, `CONFIG.threat`(레벨 1 → 최고 레벨 보간 값),
`CONFIG.director`, `CONFIG.score`, `CONFIG.factions`(진영별 표식 색·군복 색), `CONFIG.map`, `CONFIG.atmosphere`, `CONFIG.render`.

2단계 추가:
- **`CONFIG.penalty`** — 오인 사격 수치 전부: `allyHit -200`, `allyKill -1000`, `allyKillComboLock 10`(초), `allyKillRadioMute 30`(초), `civHit -300`, `civKill -1500`, `civKillComboLock 15`, `maxWarnings 3`
- `CONFIG.score.assist`(+30), `CONFIG.score.evacuation`(+25)
- `CONFIG.ally` — 분대 크기·상한·체력·명중률·피해·사선 회피(`sightLine`)·교대(`tour`, `minTour`, `withdrawQuiet`, `withdrawDist`, `leaveDist`)
- `CONFIG.civilian` — 상한·체력·노인 비율·웅크림/대피 시간·조준 반응·공황 반경·초기 배치 수·대피 가장자리 거리
- `CONFIG.director.mix`(적 65/아군 15/민간인 20), `assaultAllyMul`, `mixNearEnemyChance`, `CONFIG.director.ambush`(돌발 조우 간격·거리·비율·예고음)
- `CONFIG.gearSets` — 진영별 장비 세트(헬멧·소총·신발), `CONFIG.npc.accuracyVsNpc / damageVsNpcMul / yieldRadius`
- `CONFIG.voice` — 자막 줄 수·표시 시간·중복 억제, `CONFIG.defaults.speech`(음성 기본 꺼짐)
위협 단계 보간은 `threatT / lerpThreat / lerpRangeThreat` 유틸을 쓴다.

## 핵심 클래스와 역할

- **Game**: 시스템 생성·연결, 상태 전환, 루프. `game.time`(진행 중에만 흐르는 게임 시간), `game.runTime`(이번 판 생존 시간)
- **World**: 생성 결과 보관. `world.nav`, `world.collision`, `world.buildings`, `world.enterable`, `world.spawnPoints`, `world.city.fires`
- **NPCBase**: `trueFaction`, `apparentFaction`, `health`, `firstSeenAt`(화면에 처음 보인 게임 시각), `takeDamage(info)`, `setApparentFaction(f, outfit)`, 경로 이동(`setPath`, `_followPath`)
- **EnemySoldier**: 상태 `enter → move → cover/post(hide↔peek) / engage / rush / search`, 지각(`_perceive`, NPC마다 0.16~0.26초 주기), 청각(`hearShot`), 사격(`_fireShot`, `_hitChance`)
- **NPCManager**: `spawnEnemy`, `raycast(origin, dir, maxDist)`(부위 판정), `findCover`, `pickPostNode`, `getAimedNPC`, `countActive`
- **SpawnDirector**: `HostilePopulation`(리듬), `spawnHostile`, `pickSpawnPoint`, `isSpawnVisible`, `registerPopulation`, `registerFactory`
- **Insignia**: `setColor(hex)`, `setShape('band'|'armband'|'helmet'|'none')`, `setVisible`
- **HumanoidRig**: `applyOutfit(outfit)`(같은 뼈대에 다른 복장), `animate(dt, {speed, aim, aimPitch, crouch})`, `onHit`, `startDeath`
- **ScoreSystem**: `NPC_KILLED` 구독 → 점수·콤보 계산 → `SCORE_KILL` 발행. `applyPenalty(points)`, `resetCombo()`, `lockCombo(sec)`, `comboLocked`, 어시스트·대피 → `SCORE_EVENT`
- **Soldier** (적·아군 공통): `target`('player' 또는 NPC), `candidateTargets()`(서브클래스가 정의), `rollDamage(target)`, `_perceive`, `_shooting`, `_fireShot`, `_coverCycle`, `_goTo`
- **AllySoldier / AllySquad**: `squad.plan()`(전진·소탕·재집결), `squad.callout(member, text, priority)`, `squad.reportEnemy`, `squad.withdraw()`, `member.orderMove/orderClear/orderWithdraw`
- **CivilianNPC**: `hearDanger(pos, dist)`, `onAimedAt(dt)`(손 들기), `startPanic()`, `encourageFlee()`, 대피 성공 시 `CIVILIAN_EVACUATED`
- **PenaltySystem**: `warnings`, `allyHits/allyKills/civHits/civKills`, `stats()`, `reset()`
- **VoiceSystem** (`game.voice`): `say({speaker, text, channel, priority, voice, force, duration})`, `mute(channel, sec)`, `isMuted`, `muteRemaining`, `setSpeech(on)`, `clear()`, `history`
- **NPC 공통 조회** (3단계 판단용): `npc.getEquipment()` → `{ faction, headwear, helmetStyle, weapon, rifleStyle, magazine, footwear, footwearClass, vest, top, bag, elder, insignia:{visible,color,colorName,shape}, hands }`,
  `npc.handsState()` → `'weapon'|'aiming'|'raised'|'covering'|'carrying'|'empty'`, `npc.isHostileTo(other)`

### 이벤트 (js/core/EventBus.js `Events`)

`NPC_DAMAGED` / `NPC_KILLED` 페이로드 (2단계 페널티, 3·4단계 판단 통계가 구독할 형식):

```js
{
  attacker,            // 'player' 또는 NPC 객체
  victim,              // NPC 객체
  trueFaction,         // 'enemy' | 'ally' | 'civilian'
  apparentFaction,     // 겉보기 소속
  zone,                // 'head' | 'torso' | 'arm' | 'leg'
  headshot,            // boolean
  damage,
  distance,            // 사격 거리(m)
  timeSinceFirstSeen,  // 화면에 처음 보인 뒤 경과 초 (못 봤으면 null)
  position, time,
}
```

2단계에서 페이로드에 `attackerFaction`('player' | NPC 의 trueFaction)과 `victimKind`('enemy'|'ally'|'civilian')를 추가했다. NPC 가 NPC 를 쏴도 같은 이벤트가 나간다(`attacker` = NPC).

그 외: `NPC_SPAWNED`, `NPC_REMOVED`, `PLAYER_DAMAGED {amount, health, sourcePosition, attacker}`, `PLAYER_DIED`,
`WEAPON_FIRED {shooter, isPlayer, position, direction}`, `BULLET_NEAR_MISS`, `SCORE_KILL`, `DIRECTOR_PHASE`, `THREAT_LEVEL`, `GAME_STATE`.
2단계 추가: `SCORE_EVENT {kind:'assist'|'evacuation', points, label}`, `FRIENDLY_FIRE {kind:'allyHit'|'allyKill'|'civHit'|'civKill', points, warnings, maxWarnings, victim, apparentFaction}`,
`OPERATION_DISMISSED {warnings}`, `CIVILIAN_EVACUATED {npc, position, time}`, `AMBUSH {kind, spawnPoint, npc}`.

## 다음 단계 연결 지점

### 2단계 — 완료
- 아군·민간인 추가는 위 구조(`NPCBase` 상속 → `NPCManager.spawnXxx` → `director.registerFactory` / `registerPopulation`)를 그대로 따랐다.
  새 인물 종류도 같은 패턴으로 추가하면 된다. 페널티는 `PenaltySystem` 이 `NPC_DAMAGED/KILLED` 의 `trueFaction` 으로 판정한다.

### 3단계 — 위장 적, 시각 단서 관찰
- 위장: `npc.setApparentFaction('ally')` → 표식이 파란색으로 바뀌고, `setApparentFaction('civilian', civilianOutfit())` → 사복 + 표식 제거.
  `trueFaction` 은 그대로 `enemy` 라 점수·페널티·AI 적대 판정은 바뀌지 않는다. 디버그 라벨은 겉보기 소속이 다르면 `enemy(겉:ally)` 로 표시된다.
- **장비 세트가 단서의 기준**: 진짜 아군은 항상 `CONFIG.gearSets.ally`(낮고 넓은 헬멧·뒷목 가리개, 직선 탄창, 검은 개머리판), 진짜 적은 항상 `gearSets.enemy`(챙 있는 둥근 헬멧, 굽은 탄창, 나무 개머리판).
  `setApparentFaction('ally')` 만 하면 표식만 파랗고 장비는 적 세트로 남는다 → 그 자체가 관찰 단서. 단서를 숨기려면 outfit 의 `helmetStyle`/`rifleStyle` 을 바꿔 넘긴다.
  사복 위장은 `civilianOutfit()` 결과를 고쳐(`footwear: 'combat'` 군화, `rifle`/`bag` 등) 넘기면 된다. 신발은 `footwear`('combat'|'sneakers'|'dress'|'work')로 이미 파츠가 다르다.
- 판정 데이터: `npc.getEquipment()`(위 형식)·`npc.handsState()`·`npc.insignia.describe()` — 관찰 모드(Q)는 이 값을 읽어 표시/판정하면 된다.
  표식 형태 이상(한쪽 완장만 등)은 `Insignia.setShape` 에 형태를 추가해 만든다(`'band'|'armband'|'helmet'|'none'`).
- 적대 판정 예외(위장 적이 아군인 척 접근 등)는 `NPCBase.isHostileTo` 와 `EnemySoldier.candidateTargets` 에서 확장한다.
- 관찰 모드 키 `Q` 는 `CONFIG.reservedKeys.observe` 에 예약되어 있다.

### 4단계 — 말 걸기·구두 문답
- 조준 대상: `game.npcs.getAimedNPC({ maxDistance, coneDeg })` → `{ npc, distance }` (민간인 손 들기 반응도 이걸 0.1초마다 쓴다: `NPCManager._updateAim`)
- 실내 판별: `game.world.isIndoors(pos)` / `game.world.getIndoorInfo(pos)` → `{ building, floor, room }`
- 대사·자막: `game.voice.say({ speaker: '민간인', text, channel: 'shout', priority, voice: npc.voice })` — NPC 마다 `npc.voice {id, pitch, rate}` 가 있어 TTS 를 켜면 사람마다 목소리가 다르다.
  플레이어 대사도 같은 모듈로(`speaker: '나'` 등). 대사 목록은 `dialogue/Callouts.js` 의 `LINES` 패턴을 따르면 된다.
- 민간인의 손 들기(`npc.handsUp`)·웅크림(`npc.cower`)은 애니메이션 입력값이라 "손 들어" 명령도 이 값을 쓰면 된다.
- 키 `E`, `1`~`4` 는 `CONFIG.reservedKeys` 에 예약. `Input.onKey` 콜백 또는 `Input.down` 으로 읽으면 된다.
- 판단 통계: `NPC_DAMAGED/KILLED` 의 `timeSinceFirstSeen`, `apparentFaction`, `FRIENDLY_FIRE` 활용.

### 5단계 — 다듬기
- 난이도 곡선은 `CONFIG.threat`(레벨별 상한·명중률·반응 시간·우회 확률·웨이브 크기·출현 간격·유형 가중치)만 조절하면 된다.
- 결과 화면(`Menus.showResult`)·기록(`Records`)이 이미 있다.

## 임의로 정한 설계 결정

### 1단계 설계 결정

1. **Three.js 0.170.0** 을 jsDelivr 에서 고정 버전으로 사용 (Octree/Capsule/BufferGeometryUtils 애드온 포함).
2. **맵 치수**: 150m, 4×4 블록(블록 28m), 도로 10m(인도 1.8m), 골목 3.2m, 가장자리 4m 는 잔해 둑. 바깥으로 못 나가게 ±72.9m 에 보이지 않는 벽.
   블록은 4분할/2분할/통블록(광장·큰 건물·폐허) 패턴 중 무작위.
3. **진입 가능 건물 평면은 하나의 템플릿**: 폭 10.4~12.6m, 2~3층(+옥상 80%). 왼쪽 방 2개 + 오른쪽 홀, 홀 안쪽에 2차선 꺾인 계단(층마다 차선 교대, 중앙벽·난간).
   도로 쪽을 정면으로 90° 단위 회전. 계단 충돌은 **쐐기 삼각형**, 보이는 계단은 반 칸 내려 발이 뜨지 않게 했다.
4. **실내 어둡게**: 셰이더 패치(`aInterior` 정점 속성 / NPC 는 `uInterior` 유니폼)로 실내 면은 태양광 0, 간접광 ×0.38.
   그림자맵 범위와 무관하게 먼 건물 실내도 어둡다. 손전등·불빛·총구 섬광 같은 점/스포트 광원은 그대로 적용.
5. **그림자는 플레이어 주변만**: 방향광 그림자 카메라 ±42m 가 플레이어를 따라가며 텍셀 단위로 스냅. 바닥·천장·창틀·작은 소품 재질은 그림자를 드리우지 않음.
6. **광원 수 고정**(셰이더 재컴파일 방지): 불빛 점광원 4개를 가까운 불에 0.3초마다 재배정, 총구 섬광 1, 손전등 1 — 끄고 켤 때 세기만 바꾼다.
7. **1인칭 총기는 별도 씬·카메라 패스**(깊이 초기화 후 렌더)로 벽에 파묻히지 않게 했다. 조명은 월드와 동기화(실내면 어둡게).
8. **NPC 렌더링**: 파츠를 뼈 하나씩에 강체 스키닝해 몸 전체를 `SkinnedMesh` 1개, 표식을 같은 뼈대의 `SkinnedMesh` 1개로 그린다(NPC당 드로우콜 2).
   부위 판정은 정점별 부위 코드(`geometry.userData.zones`)로 하고, 소총 파츠는 `none`(총알 통과). 그림자는 30m 이내 NPC만.
9. **NPC 이동은 물리 없이 내비 그래프 위**: 실외는 2D 점유 격자에서 샘플링(3m)한 노드 + 골목 중심선 + 엄폐 노드를 통과 가능 선분으로 연결,
   실내 노드는 건물 생성 시 직접 정의. 계단은 경사 시작·끝 노드를 넣어 높이 보간이 경사면과 일치. 가장 큰 연결 요소만 남긴다.
10. **적 사격은 확률 판정**(거리·플레이어 이동·앉기·점사 순번·등장 유예·시야 확보 직후 감점·위협 단계 반영)이지만,
    총구→플레이어 선분이 막혀 있으면 무조건 빗나간다. 빗나간 탄은 실제 레이로 피탄 이펙트를 남기고 2.2m 이내로 지나가면 스침 소리.
11. **데미지**: 소총 30 × 부위 배율(머리 3.6 → 헤드샷 즉사, 팔다리 0.75), 적 체력 100(몸통 4발). 적 1발 7~10.
12. **스폰 선택**: 먼저 출현 지점 *종류*를 가중치로 고르고(골목 노드가 압도적으로 많아도 문·창·엄폐물·방이 고르게 나오도록) 그 안에서 거리·방향 점수로 후보를 고른다.
    시야 판정 = 시야각 + 14° 여유 + 머리/가슴 높이(엄폐 등장은 웅크린 높이) 가림 레이. 실제 생성 직전에 한 번 더 확인하고, 보이면 근처 다른 숨은 지점으로 바꾼다.
13. **예고음**: 정면에서 65° 이상 벗어나거나 30m 이내(60%) 또는 25% 무작위로 0.9~1.7초 먼저 들려준다. 지점 종류별로 문(문 삐걱+쾅), 유리(창문), 잔해, 발소리.
14. **디렉터 리듬**: 첫 소강 2.5~5초 뒤 무조건 산발로 시작. 이후 소강→(30% 습격 / 70% 산발), 산발→(60% 습격 / 40% 소강), 습격(2~3 방향, 그룹 간 방위각 70° 이상)→정리→소강.
    긴장도(피격·사살·스침으로 상승, 초당 0.045 감소)가 0.85를 넘으면 산발을 끊고 정리로.
15. **콤보 배율**: 첫 사살 ×1, 5초 안 연속 사살마다 +0.5 (×1.5, ×2, … 최대 ×4). 배율은 그 사살의 (기본+보너스) 점수 전체에 곱한다.
    멀티킬 보너스는 2킬째 +100, 3킬째부터 매 킬 +250.
16. **즉응 사살 기준 시각(firstSeenAt)**: NPC마다 분산된 화면 노출 검사(프러스텀 + 카메라→머리/가슴 가림 레이)로 처음 보인 게임 시각.
17. **일시정지**: 포인터 락이 풀리면 자동 일시정지 + AudioContext 일시 중단. 브라우저 재잠금 제한(약 1초) 안에 클릭하면 안내 문구.
18. **시드**: 기본 `PIASIK-1`, 마지막으로 쓴 시드를 저장. 시작 화면에서 바꾸면 같은 페이지에서 맵을 다시 만든다(무작위 버튼은 한국어 단어 조합).
19. **글꼴**: 외부 글꼴 없이 시스템 한글 글꼴(맑은 고딕, Apple SD Gothic Neo, Noto Sans KR 순).
20. **렌더 설정**: DPR 상한 1.25, ACES 톤매핑, PCFSoft 그림자 2048, 정적 지오메트리 50m 청크 병합.
21. **엄폐 높이 규칙**: 웅크린 적의 머리 끝 ≈1.15m(눈 ≈1.0m), 선 적의 머리 끝 ≈1.85m. 엄폐 지점은 높이 1.25m 이상인 물체 옆에만 만든다
    (모래주머니 8단 1.32m, 콘크리트 방벽 1.25m, 차량 옆면(지붕 1.42m), 2단 상자, 1.3m 쓰레기통, 높이 1.25~2.4m 잔해 더미, 1.25~1.9m 남은 벽).
    그래서 '엄폐물 뒤 웅크린 채 생성'이 시야 판정과 실제 화면에서 일치한다. 창턱(0.95m)은 이보다 낮아 창가 사수의 헬멧이 살짝 보인다(의도된 단서).

### 2단계 설계 결정

22. **출현 비율 = 크레딧 방식**: 적이 한 명 출현 예약될 때마다 아군 크레딧 +15/65(습격 구간 ×2), 민간인 +20/65. 크레딧이 차면 같은 출현 지점 카탈로그·등장 방식·예고음으로 등장
    (아군 분대는 인원수만큼 크레딧 소모·집계). 1단계 적 리듬(소강→산발→습격→정리)은 건드리지 않는다. 시작 배치(아군 첫 분대, 숨어 있는 민간인 3~5명)는 비율 집계에서 뺀다.
23. **분대 교대**: 아군 상한(6)이 차면 증원이 못 들어오므로, 분대는 55~95초(증원 대기 중이면 35초 이상) 머물고 8초 이상 교전이 없으면 "다른 구역 지원" 무전 후
    32~60m 밖 진입 지점으로 이동, 플레이어 화면 밖 + 24m 이상(도착 후엔 12m)이면 사라진다. 그래서 아군이 계속 "새로" 나타난다.
24. **돌발 조우**: 첫 25~35초 뒤, 이후 38~70초(최고 위협 20~38초) 간격. 3.5~8m 의 같은 층, 플레이어 시야 밖 출입구·골목 끝·방·엄폐물 뒤에서 0.25~0.5초 예고음 후 등장.
    적은 돌격(rush)으로 바로 다가오지만 등장 유예(1.4초) 동안 명중 불가라 판단할 시간이 있다. 돌발 아군은 1.2초 뒤에야 "아군이다! 쏘지 마!" (판단을 먼저 시험).
    근처에 숨은 지점이 없으면 4초 뒤 다시 시도한다(제자리에 서 있으면 드물게 나온다).
25. **위협 단계와 혼재**: 아군·민간인 등장 시 `mixNearEnemyChance`(15% → 60%) 확률로 지금 교전 중인 적 근처(아군 20m·민간인 14m)의 출현 지점을 고른다 — 사선 위 민간인, 적과 붙은 아군.
26. **피아 판정은 trueFaction**: 적은 플레이어(최우선)와 50m 안 아군 최대 2명을 대상 후보로, 아군은 적만. NPC 탄은 같은 편·민간인에게 피해 없음(판정 자체를 안 함).
    적→아군 명중률 ×0.75, 피해 ×1.5(아군이 너무 오래 버티지 않게). 아군 명중률 0.12·피해 22 — 적 처치의 주인공은 플레이어.
27. **페널티**: 피격은 총알마다(−200/−300 + 콤보 초기화), 사살은 그 한 번(−1000/−1500 + 콤보 잠금 + 경고). 경고는 사살에만. 콤보 잠금 중엔 사살해도 배율이 오르지 않는다(×1 유지).
    아군 사살 시 30초 무전 두절 — 단, 맞은 아군의 "사격 중지!" 외침(`shout` 채널, `force`)은 항상 들린다. 플레이어가 죽인 아군에 대해선 분대가 "한 명 당했다" 무전을 하지 않는다.
28. **아군 체력 120**: 플레이어 소총 헤드샷(30×3.6=108)으로 즉사하지 않게 — 빗나간 한 발엔 −200 으로 끝나고 "사격 중지!" 를 듣고 멈출 기회가 있다. 민간인은 50(몸통 2발, 머리 1발).
29. **사선 회피 규칙**: 조준선(폭 0.8m + 거리×1%) 위에 0.45초 이상 있으면 반응. 플레이어가 쏘는 중이면 즉시. 조준선이 앉은 머리(1.4m)보다 높으면 앉고, 낮으면(플레이어가 앉아 쏘는 중 등) 옆 노드로 비킨다.
    이동 중엔 쏘고 있는 조준선을 가로지르기 직전에 0.8~2.2초 멈춰 틈을 기다린다(12.5% 는 그냥 가로지름 — 긴장 요소). 플레이어 3m 이내·정면 조준선 위 지점은 분대 목표에서 감점.
30. **민간인 대피**: 숨은 민간인은 (조용함 3~6초 + 확률) 또는 (3번 이상 웅크린 뒤 1.2초 조용 + 7m 안에 적 없음)일 때 맵 가장자리(내부 경계에서 13m 안쪽) 실외 노드로 달아나 도착하면 사라짐(+25).
    비명은 사람마다 6초, 자막은 전체 8초·사람마다 15초 간격(교전이 길어도 자막이 비명으로 덮이지 않게).
31. **나침반**: 무전 위치 묘사("동쪽 골목", "북서쪽 잔해 뒤")가 실제로 쓸모 있으려면 방위를 알아야 해서 화면 위에 나침반을 추가했다. 북 = −z.
32. **작전 해임 처리**: 경고 3회 → 상태 `dead`(사유 `dismissed`), 지휘부 무전 + 배너 후 3.4초 뒤 결과 화면. 해임된 판의 생존 시간은 최장 생존 기록에 넣지 않는다.
33. **음성**: Web Speech 는 기본 꺼짐(설정에서 켬). 한국어 음성이 없으면 켜도 자막만 나오고 설정 화면에 안내한다. 자막은 음성과 무관하게 항상 표시.

### 기대 점수 분석 (오인 사격 수치 근거)

- 적 사살 1명 ≈ 기본 100 + 즉응 50(+헤드샷 50) → 150~200, 콤보가 이어지면 ×1.5~×4.
- **보이는 대로 끝까지 쏘는 경우** 인물 1명당 기대값 (출현 비율 65/15/20, 아군 체력 120 → 몸통 4발, 민간인 50 → 2발):
  `0.65 × (150 × 평균 콤보 ×2 ≈ 300) + 0.15 × (−200×3 − 1000 = −1600) + 0.20 × (−300 − 1500 = −1800) ≈ 195 − 240 − 360 = −405`.
  게다가 35% 확률로 매번 콤보가 초기화·잠금되니 실제 적 점수도 ×1 근처로 떨어지고(→ 약 −500), 경고는 인물 약 8~9명마다 3회가 쌓여 작전 해임.
- **한 발 쏘고 확인하는 경우**: 아군·민간인마다 −200/−300 + 콤보 초기화 → 콤보를 거의 못 쌓아 확인 후 사격보다 확실히 낮다.
- **확인 후 사격**: 표식을 보는 0.3~0.5초는 즉응 사살 창(2초)·콤보 창(5초)보다 짧아 손실이 작다.
- 실측 (헤드리스 봇, 플레이어 무적, 300초, 여러 시드):
  - 보이는 대로 사격 봇(반응 0.35초): 2~45초 만에 작전 해임(−2,500 ~ −5,200), 해임을 피한 판도 −1,750.
  - 확인 후 사격 봇(반응 0.75초, 조준선에 비적군이 있으면 사격 보류): +1,200 ~ +18,000 (시작 위치 시야에 따라 편차 큼), 경고 0~1회.
    남는 오인 사격은 대부분 적과 붙어 싸우는 아군이 탄퍼짐에 맞는 경우 — 의도한 긴장 요소.

## 알려진 한계 / 개선 후보

- 실제 브라우저 FPS 는 이 환경(헤드리스)에서 측정하지 못했다. 드로우콜·CPU 시간 기준으로만 확인 — 5단계에서 실기기 프로파일링 필요.
- NPC 끼리의 충돌 회피는 엄폐 지점 예약 + 진행 방향 양보(최대 1.5초)뿐이다. 좁은 실내에선 잠깐 겹칠 수 있다.
- NPC 탄은 겨냥한 대상만 판정한다(사이에 있는 다른 NPC 를 막지 않음). 같은 편·민간인은 NPC 탄에 다치지 않는다(의도).
- 민간인은 대피 지점에 닿으면 그 자리에서 사라진다(맵 가장자리 잔해 둑 근처라 눈에 잘 띄지 않지만 보일 수는 있다).
- 돌발 조우는 플레이어 3.5~8m 안에 숨은 출현 지점이 있어야 해서, 넓은 광장 한가운데 오래 서 있으면 잘 안 나온다.
- 아군 분대 AI 는 단순하다(전진·소탕·재집결·교대). 엄폐 지점이 없는 곳에선 노드 위에 서서 싸운다.
- 손전등은 그림자가 없어 벽 너머 면도 비출 수 있다(시야에선 가려짐).
- 진입 불가 건물의 창문은 텍스처일 뿐이라 들여다볼 수 없다(창문 사수·실내전은 진입 가능 건물에서만).
- 헤드리스 봇 기준 밸런스는 대략적이다. 사람 플레이 테스트로 `CONFIG.threat`·`CONFIG.npc.accuracy` 조정 권장.
