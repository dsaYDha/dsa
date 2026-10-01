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
| 2 | 민간인·아군 NPC, 오인 사격 페널티 | 예정 (구조 준비됨) |
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
    NPCBase.js        ★ 모든 인물 NPC 공통 베이스 (trueFaction/apparentFaction, 피해·사망 이벤트, 경로 이동)
    HumanoidRig.js    파츠 조립식 인간형 + 절차적 애니메이션 (뼈별 강체 스키닝 SkinnedMesh)
    Insignia.js       ★ 표식 컴포넌트 (색·형태 교체 가능)
    EnemySoldier.js   적군 AI 상태 머신 (소총수/돌격병/창문 사수)
    NPCManager.js     생성·갱신·히트박스 레이캐스트·엄폐/창가 선택·화면 노출 추적·getAimedNPC
  director/SpawnDirector.js ★ 스폰 디렉터 (리듬·출현 지점·예고음·위협 단계, 인구/생성기 등록 구조)
  game/
    ScoreSystem.js    점수·콤보·멀티킬·즉응 사살·결과 통계
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
- **ScoreSystem**: `NPC_KILLED` 구독 → 점수·콤보 계산 → `SCORE_KILL` 발행

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

그 외: `NPC_SPAWNED`, `NPC_REMOVED`, `PLAYER_DAMAGED {amount, health, sourcePosition, attacker}`, `PLAYER_DIED`,
`WEAPON_FIRED {shooter, isPlayer, position, direction}`, `BULLET_NEAR_MISS`, `SCORE_KILL`, `DIRECTOR_PHASE`, `THREAT_LEVEL`, `GAME_STATE`.

## 다음 단계 연결 지점

### 2단계 — 민간인·아군, 오인 사격 페널티
- `NPCBase` 를 상속해 `CivilianNPC`(trueFaction `civilian`), `AllyNPC`(`ally`)를 `js/npc/` 에 추가한다.
  복장은 `defaultOutfit(CONFIG.factions.xxx)` 를 바탕으로 만들고 민간인은 `headwear: 'none'`, `vest: null`, `rifle: false` 등.
- `NPCManager.spawnEnemy` 와 같은 패턴으로 생성 함수를 만들고 `director.registerFactory('civilian', fn)` 로 등록.
- 배치는 `director.registerPopulation(pop)` — `pop` 은 `update(dt) / reset() / onSpawned(npc, req) / debugInfo()` 를 가진 객체.
  건물 안 방(`spawnPoints` 의 `room` 타입), 거리 노드를 쓰면 된다. `director.isSpawnVisible()` 재사용 가능.
- 페널티: `Events.NPC_DAMAGED / NPC_KILLED` 를 구독해 `trueFaction !== 'enemy'` 일 때 처리. (현재 `ScoreSystem.onKill` 은 적이 아니면 무시)
- 적 AI 가 아군을 노리게 하려면 `EnemySoldier._perceive` 의 대상 선택(현재 플레이어 고정)을 일반화한다.
- `NPCManager.countActive(faction)`, 디버그 라벨은 이미 진영별로 동작한다.

### 3단계 — 위장 적, 시각 단서 관찰
- 위장: `npc.setApparentFaction('ally')` → 표식이 파란색으로 바뀌고, `setApparentFaction('civilian', 사복outfit)` → 사복 + 표식 제거.
  `trueFaction` 은 그대로 `enemy` 라 점수·AI 판정은 바뀌지 않는다.
- 시각 단서: `HumanoidRig.buildGeometries` 의 파츠(군화·조끼·총기 등)를 outfit 옵션으로 바꿔 끼우거나 `Insignia.setShape` 로 형태 이상(한쪽 완장만 등)을 만든다.
- 관찰 모드 키 `Q` 는 `CONFIG.reservedKeys.observe` 에 예약되어 있다.

### 4단계 — 말 걸기·구두 문답
- 조준 대상: `game.npcs.getAimedNPC({ maxDistance, coneDeg })` → `{ npc, distance }`
- 실내 판별: `game.world.isIndoors(pos)` / `game.world.getIndoorInfo(pos)` → `{ building, floor, room }`
- 키 `E`, `1`~`4` 는 `CONFIG.reservedKeys` 에 예약. `Input.onKey` 콜백 또는 `Input.down` 으로 읽으면 된다.
- 판단 통계: `NPC_DAMAGED/KILLED` 의 `timeSinceFirstSeen`, `apparentFaction` 활용.

### 5단계 — 다듬기
- 난이도 곡선은 `CONFIG.threat`(레벨별 상한·명중률·반응 시간·우회 확률·웨이브 크기·출현 간격·유형 가중치)만 조절하면 된다.
- 결과 화면(`Menus.showResult`)·기록(`Records`)이 이미 있다.

## 이번 단계에서 임의로 정한 설계 결정

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

## 알려진 한계 / 개선 후보

- 실제 브라우저 FPS 는 이 환경(헤드리스)에서 측정하지 못했다. 드로우콜·CPU 시간 기준으로만 확인 — 5단계에서 실기기 프로파일링 필요.
- NPC 끼리의 충돌 회피는 엄폐 지점 예약 정도뿐이다. NPC 탄은 다른 NPC 를 맞히지 않는다.
- 손전등은 그림자가 없어 벽 너머 면도 비출 수 있다(시야에선 가려짐).
- 진입 불가 건물의 창문은 텍스처일 뿐이라 들여다볼 수 없다(창문 사수·실내전은 진입 가능 건물에서만).
- 헤드리스 봇 기준 밸런스는 대략적이다. 사람 플레이 테스트로 `CONFIG.threat`·`CONFIG.npc.accuracy` 조정 권장.
