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
| 3 | 위장 적, 시각 단서 관찰 시스템 | **완료** |
| 4 | 말 걸기·구두 문답 (암구호, 실내 확인 문답, "손 들어") | **완료** |
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

### 3단계에서 구현한 것

- **2단계 남은 버그 수정**: 민간인이 대피 지점에 닿으면 플레이어 눈앞에서 사라지던 문제 → `LEAVE` 상태(화면 밖이 되거나 15초가 지나면 퇴장)
- **위장 적 = `EnemySoldier` + `DisguiseController`** (새 NPC 클래스 없음): `trueFaction` 은 처음부터 `enemy`, 겉보기만 아군(파란 표식)·민간인(사복).
  정체를 드러내기 전엔 컨트롤러가 움직이고, 드러낸 뒤엔 1단계 적 상태 머신(engage / 창가 post)으로 넘어간다.
  - **가짜 아군**: 분대 근처·적이 있던 쪽에서 등장 → 분대 곁에 섞여 있다가(blend) 플레이어 등 뒤·옆으로 접근(approach) 또는 3~5m 뒤 동행(escort).
    교전 중 안 쏘거나 허공에 쏘거나(피해 없는 사격) 적 옆으로 크게 빗나가게 쏨, 아군 무전에 무반응, 플레이어를 바라보며 다가옴
  - **가짜 민간인**: 다른 민간인 근처·창가에서 등장 → 민간인처럼 숨어 있다가 접근. 손을 등 뒤/주머니에 숨김, 총성에 안 웅크림(또는 웅크리는 척),
    조준해도 손을 늦게 들거나 안 듦, 대피하지 않고 이쪽으로 옴, 숙련되면 "도와주세요!" 하며 다가옴
  - **유형**: 기습형(가까이 붙어 기회를 노림) / 정찰형(주로 가짜 민간인 — 창가·골목에서 지켜보다 무전으로 근처에 습격을 부르고, 4~7초 뒤 습격과 함께 정체를 드러냄)
  - **정체 드러내기**: 기회(등을 보임·재장전·관찰 모드) 0.35~0.8초 지속 또는 가까이 붙어 있은 지 7~20초(위협 단계별, 동행형 12~34초) → **예고 동작 0.5~0.8초**
    (가짜 아군: 왼손으로 완장을 뜯어 밑의 빨간 완장 / 가짜 민간인: 등 뒤 옷 속에서 숨긴 총을 꺼내 듦 + 빨간 완장) + 장전음 "철컥" + 긴장 효과음 →
    `apparentFaction = 'enemy'`, 5초간 명중률 ×1.5. 시야 밖(18m 안)이면 HUD 에 방향 경고 표시
  - 동시 활성 위장 적 상한 2~3, 위협 2단계(1분)부터. 4단계용 **위장 프로필**(장비 단서·행동 성향·숙련도 0~2)
- **장비 단서 = 실제 3D 파츠** (`HumanoidRig`): 아군 어깨 **파란 방패 패치**(진짜 아군 기준) / 가짜는 패치 없음·네모·동그라미, 적 헬멧, 굽은 탄창 소총,
  급조 **테이프 완장**(하늘빛이 도는 파랑 + 비스듬히 엉성하게 감김 + 늘어진 끝). 가짜 민간인: 군화, 허리춤 불룩함, 등 뒤 총몸 윤곽(총구·개머리 끝이 비침),
  가슴 무전기(안테나), 옷 위 조끼 끈, 전술 장갑. 위협 단계가 오를수록 수가 줄어든다(초반 2~3개 → 후반 0~1개, 0개 = 완벽 위장)
- **행동 단서 = 실제 애니메이션 + 행동 기록**: 손 숨기기(등 뒤/주머니), 충격으로 얼어붙음(두 손을 가슴에), 무전기에 대고 말하기(왼손을 귀로), 완장 뜯기, 숨긴 총 꺼내기 자세.
  모든 인물이 실제로 한 일만 `npc.behavior` 에 기록되고(`noteBehavior`), 진짜와 가짜가 같은 이동·기록 코드(`npc/Behaviors.js`)를 써서 행동만으로는 확신할 수 없다
- **오판 유도용 진짜 행동** (위장 적과 비슷한 빈도): 아군 **낙오병**(1인 분대, "낙오됐다! 합류하겠다!" 외치며 다가와 합류 → 동행), **동행 아군**(분대원 하나가 플레이어 3~5m 뒤에서 엄호, 실제로 적과 싸움),
  민간인 **얼어붙음**(총성에 웅크리지 못함), **도움 요청**("도와주세요!" 하며 3~5m 까지 다가와 머묾). 진짜 아군도 다른 분대의 위치 무전에 그쪽을 돌아보며(가끔 "확인!") 반응 기록
- **관찰 모드 `ObservationSystem` (Q 누르고 있기)**: 총을 내림(사격·정조준 불가, 떼면 0.3초 뒤 사격 가능), 시야 2배 확대, 가장자리 어둡게, 주변 소리 줄임 + 약한 심장 소리,
  이동 ×0.6·감도 ×0.5·달리기 불가. 화면 중앙 가장 가까운 인물(`getAimedNPC` 재사용)에게서 약 0.5초마다 사실 하나(멀수록 느림, 가려지면 불가,
  38m 넘으면 장비 세부 안 보임, 어두운 실내는 손전등이 비춰야 장비가 보임 — 빛나는 표식만 예외). 메모는 사실만, 결론은 쓰지 않는다.
  이상 단서를 하나라도 찾은 대상은 8초간 노란 윤곽(림 라이트, 끝날 무렵 깜박임). 관찰 중에도 실시간이라 가까운 위장 적에겐 기습 기회
- **점수**: 드러내기 전 위장 적 사살 +200("위장 적 식별"), 관찰로 그 대상의 이상 단서를 1개 이상 찾았으면 +100("근거 있는 판단"), 콤보 배율 적용. 드러낸 뒤엔 기본 점수만.
  사살 연출: 가짜 민간인은 숨긴 총이 바닥에 떨어지고(쇠붙이 소리), 가짜 아군은 파란 완장 조각이 날리며 밑의 빨간 띠가 드러남 + "위장 적 사살!" 문구·효과음
- **스폰 디렉터**: 위협 2단계부터 아군·민간인 출현 크레딧의 일부(아군 10→30%, 민간인 10→25%)를 '가짜' 크레딧으로 → 같은 출현 지점·등장 방식·예고음으로 위장 적 등장
  (정찰형 가짜 민간인은 창가 위주 `scoutPost`). 습격 구간 시작 시 35~60% 확률로 혼란을 틈탄 위장 적 침투(14~28m), 정찰형의 습격 요청(`callInAssault`)
- **브리핑·안내**: 시작 화면 "작전 브리핑"(위장 사실·진짜 아군 장비 기준·진짜 민간인 특징·관찰 방법), 위장 적 첫 등장 시 배너 1회, 관찰 모드 첫 사용 시 안내 1회
- **HUD·결과·디버그**: 관찰 게이지(진행도·거리·상태), 관찰 메모 패널, 킬 피드 "위장 적". 결과에 위장 적 사전 식별 사살(근거 n), 위장 적에게 기습당한 횟수, 관찰로 찾은 이상 단서 수.
  디버그: 위장 적 활성/상한·누계·침투·습격 요청, 진짜 행동 누계, 관찰 통계, 머리 위 라벨(유형·모드·숙련도·장비 단서·행동 성향·찾은/남은 이상 단서·기습 진행률과 지금 기회)
- 다음 단계 준비: `E`·`1~4` 미사용 유지(당시 `CONFIG.reservedKeys` — 4단계에서 `CONFIG.keys` 로 옮김), 위장 프로필 `npc.disguise.skill`, 실제 행동 기록·관찰 기록 조회

### 4단계에서 구현한 것

- **3단계 남은 문제 수정**: 관찰 모드가 보는 각도를 따지지 않던 문제 → 장비 사실마다 보이는 방향(`view`: 앞/뒤·옆/옆·비스듬히) — 각도 때문에 안 보이는 사실은 상태 문구에도 드러내지 않음.
  낮은 엄폐물 뒤에 웅크려 가슴이 가려진 인물을 조준 대상으로 못 잡던 문제 → `getAimedNPC` 원뿔 판정이 머리가 보여도 인정(관찰·말 걸기 공통).
  자막 화자 라벨을 겉모습 기준으로 통일(`[아군]` 외침 → `[파란 표식 병사]`, NPC 의 `talkLabel`)
- **말 걸기 `DialogueSystem` (E, 1~4)**: 화면 중앙 인물(2단계 `getAimedNPC` 재사용)에게 "정지!" + 화면 맨 아래 대화 메뉴. 실외 20m / 실내 10m, 시야 필요, 빨간 표식 무반응.
  4초 무입력·시야 상실(0.6초)·멀어짐·E 재입력·사격·사망·정체 드러냄이면 닫힘. **게임은 멈추지 않고** 총은 그대로 — 좌클릭 사격 시 대화 종료.
  대답은 질문 뒤 '대본'(몇 초 뒤 무슨 말·행동)으로 실시간 실행되고, 판정은 화면에 보여주지 않는다
- **암구호·실내 기준수·부대 `CountersignSystem`**: 문어/답어 쌍 37개, 실내 기준수 7~12, 위협 단계가 오를 때마다(약 1분) 둘 다 교체 →
  `[작전 무전] 암구호 변경. 문어 ○○, 답어 ○○` + `실내 기준수 ○` + HUD 암구호 카드 깜박임(교체 직후 20초는 이전 것 취소선). 시작 시 "금일 암구호 하달".
  아군 부대 3개(철방패대대=파란 방패 / 샛별중대=파란 별 / 봉우리대대=파란 삼각형) — 진짜 아군 분대마다 한 부대, 어깨 패치 모양이 부대와 일치
- **대답 규칙 `Responses.js`** (숙련도별 반응 표 — 아래 "4단계 숙련도별 반응 표"): 파란 표식 병사(암구호·실내 확인 문답·소속·"총 내려!"),
  민간인("손 들어!"·신분증·대피). 진짜 아군의 교체 직후 실수→정정(30%), 30초 안 세 번 넘게 물으면 짜증. 숙련도 0 은 막히면 즉시 정체 드러냄(예고 동작 유지),
  숙련도 1~2 는 '들킨 것 같으면' 기습 가속 또는 도주 → 숨었다가 다른 위치에서 다시 접근하거나 습격을 부름. 질문 자체도 기습까지 남은 시간을 줄임
- **3D 연출**: 부대 패치 별·삼각형, 신분증 소품(손에 들고 내밂), "총 내려!" 총구 내림 자세, 한 손 늦게 들기, 손을 들면 옷이 올라가 허리띠·숨긴 권총 손잡이가 드러남
- **대사 데이터 분리 `DialogueLines.js`**: 플레이어·파란 표식 병사·민간인·작전 무전 대사 전부, 종류마다 변형 3~4개, 암구호 단어 쌍·없는 부대명·고유어 숫자
- **점수·통계**: 문답에서 틀리거나 머뭇거린 위장 적(`npc.dialogueFailed`)을 드러내기 전에 사살 → +200 + '근거 있는 판단' +100. 문답에 막혀 드러내던 중 사살도 '사전 식별'.
  결과: 문답 횟수(말 걸기 횟수), 문답으로 찾아낸 위장 적, 문답으로 확인한 진짜 인물, 문답 중 기습당함
- **HUD·브리핑·설정**: 대화 메뉴(겉모습·거리·남은 시간·'응답 대기'), 암구호 카드(설정에서 '항상 표시'(기본)/숨김), 첫 말 걸기·첫 실내 문답 안내 1회,
  '대상 없음/너무 멀다' 안내. 작전 브리핑에 아군 부대·패치, 말 걸기 조작, 암구호 방식, 실내 기준수 방식(예시)
- **디버그**: 암구호 현재/이전·기준수·교체 횟수, 대화(없으면 조준) 대상이 아는 것(현재/이전 암구호·기준수·부대명), 문답 통계
- 다음 단계 준비: `CONFIG.dialogue` 한곳에 문답 수치, `Game.debugSpawn` 테스트 생성 도우미

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
- 3단계 테스트용 강제 생성 (위장 적 상한은 위협 2단계 전엔 0이라 먼저 `__game.director.elapsed = 120` 으로 단계를 올린다):
  - 위장 적: `__game.director.spawnAppearance('disguised', { as: 'ally'|'civilian', role: 'ambusher'|'scout', distRange: [10, 20] })` (예고음이 있으면 1~2초 뒤 생성)
  - 진짜 행동: `spawnAppearance('ally', { size: 1, decoy: 'straggler' })`, `spawnAppearance('ally', { size: 3, decoy: 'escort' })`, `spawnAppearance('civilian', { decoy: 'helpSeeker'|'frozen' })`
  - 관찰 상태: `__game.observation` (`active`, `target`, `memo()`), 인물별 기록: `npc.behavior`(Map), `npc.observed.found`, `npc.disguise`(프로필), `npc.ctl`(위장 컨트롤러: `mode`, `ambushProgress`, `oppNow`)
- 3단계 검증(같은 Playwright 환경): 1·2단계 회귀(8개 건물 계단 보행, 사망→결과→재시작, 오인 사격 → 작전 해임, 일시정지, 시드 결정성, 민간인 대피) 통과, 콘솔 에러·경고 0건.
  근접 스크린샷으로 장비 단서 파츠 전부(패치 3종, 테이프 완장, 적 헬멧·굽은 탄창, 군화, 허리 불룩, 등 총몸, 무전기, 조끼 끈, 전술 장갑)와 자세(손 숨기기 등 뒤/주머니, 얼어붙음, 무전, 완장 뜯기, 총 꺼내기) 확인.
  강제 생성으로 가짜 아군 접근 → 등 돌림 기습, 동행 → 재장전 기습, 정찰형 감시 → 습격 요청 → 정체 드러냄, 낙오병 합류 → 동행, 도움 요청 민간인(3~4m 에서 멈춤), 얼어붙음 확인.
  관찰: 시야 78° → 44°, 관찰 중과 뗀 직후(0.3초 안) 사격 불가, 사실이 하나씩 메모(진짜 아군은 중립 사실만 — 단 혼자 다니면 '분대와 떨어져 혼자 움직임'은 뜰 수 있음, 의도),
  어두운 실내는 손전등 없이는 장비 사실 안 나옴, 사전 식별 사살 100 + 200 + 100 과 라벨.
  밸런스(여러 시드 300초, 표식만 보고 쏘는 봇): 위장 적은 판당 0~4명(대부분 3~4명), 첫 등장 79~221초(위협 2단계 이후), 겉모습 기준 출현 비율 적 58~64 / 아군 17~21 / 민간인 18~22%.
  후반(위협 7~10)만 따로 돌리면 약 33초에 1명, 아군·민간인 겉모습 중 가짜 약 29%(설정 최대치와 일치). 표식만 믿는 봇은 300초 판에서 0~4회, 후반 긴 판에서 10~15회 기습당한다.
  NPC 31명(적 12·위장 3·아군 6·민간인 10) + 관찰 모드: 드로우콜 203~220, 업데이트 약 1.24ms/프레임.
- 4단계 테스트 도우미: `__game.debugSpawn(kind, o)` — 상한·예고음 없이 플레이어 근처 숨은 출현 지점(또는 `o.at` 근처 노드)에 즉시 생성.
  `debugSpawn('disguised', { as: 'ally'|'civilian', skill: 0|1|2, role, mode })`, `debugSpawn('ally', { size, decoy })`, `debugSpawn('civilian', { decoy })`, `debugSpawn('enemy', { type })`.
  말 걸기는 `__game.input.pressed.add('KeyE')` / `'Digit1'` 후 한 프레임 진행. 상태: `__game.dialogue`(`target`, `reaction`, `busyT`, `idleT`, `options()`, `stats`),
  `__game.countersign`(`current`, `previous`, `indoorBase`, `stale`, `knowledgeOf(npc)`), 대답 결과는 `dialogue:answer` 이벤트(`outcome`, `fail`).
- 4단계 검증(같은 Playwright 환경): 1~3단계 회귀(8개 건물 계단, 사망→결과→재시작, 오인 사격→작전 해임, 관찰 모드·위장 적 사전 사살 점수,
  위장 적 기습/정찰/진짜 행동 시나리오, 시드 결정성, 일시정지) 통과, 콘솔 에러·경고 0건.
  문답 규칙: 진짜 아군(암구호·소속·총 내림 정답), 위장 아군 숙련 0(도주·머뭇→엉뚱한 단어→기습)/1(이전 답어·없는 부대)/2(현재 답어·패치와 다른 부대),
  진짜 민간인(손·신분증·대피), 위장 민간인 숙련 0(거부→기습·도주)/1(늦게 듦·신분증 분실→도주)/2(한 손 늦게·위조 신분증·가짜 대피→되돌아옴),
  실내 확인 문답 20회(진짜 아군 5/5 정답, 위장 숙련 0~2 전원 머뭇거린 뒤 추측), 실외에서 2번 비활성('실내 전용'), 사격 시 대화 종료, 빨간 표식 무반응,
  암구호 교체(작전 무전 2줄·카드 깜박임·취소선), 도주→숨기→습격 요청/재접근, 총 내린 위장 아군은 85° 시선을 돌리면 기습(안 내린 경우 10초간 없음).
  말 거는 봇 소크(실제 디렉터 + 12초마다 근처 생성, 6분·2시드): 에러 0. 성능: NPC 31명 + 대화 중(신분증) + 관찰 모드 업데이트 약 1.4ms/프레임
  (같은 페이지 기준 대화 없음 0.9ms), 드로우콜 196~222(신분증은 보일 때만 +1).

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
    Materials.js      재질 + 실내 음영 셰이더 패치(patchInterior) + NPC 노란 윤곽(림 라이트 uHighlight)
    Textures.js       CanvasTexture 절차 생성
    Atmosphere.js     하늘 셰이더·안개·태양(그림자 추적)·불빛 풀·연기 기둥·재·지평선 섬광
  fx/
    Particles.js      인스턴스 빌보드 파티클 (시스템당 드로우콜 1)
    Effects.js        피탄·피·예광탄·탄흔 풀·적 총구 화염·플레이어 총구 섬광 + 떨어지는 숨긴 총(dropRifle)·뜯긴 완장 조각(shreds)
  audio/AudioSystem.js Web Audio 합성 전부 (총성·발소리·문·잔해·유리·스침·포성·바람·심장박동 + 관찰 집중·장전음 '철컥'·긴장음·테이프 뜯기·무전·알아챔)
  player/
    Player.js         이동·충돌·시점·흔들림·체력 (관찰 중 이동·감도 감소, 달리기 불가)
    Weapon.js         소총 로직 (발사·탄퍼짐·반동·재장전·정조준, 관찰 중·총 드는 중 사격 불가)
    WeaponView.js     1인칭 총기 모델·애니메이션 (별도 씬/카메라 패스, 관찰 중 총 내림)
  npc/
    NPCBase.js        ★ 모든 인물 NPC 공통 베이스 (trueFaction/apparentFaction, 피해·사망 이벤트, 경로 이동, 장비 조회·적대 판정, 행동 기록·관찰 기록, 4단계 대화 자세·화자 라벨)
    HumanoidRig.js    파츠 조립식 인간형 + 절차적 애니메이션 (뼈별 강체 스키닝 SkinnedMesh) — 헬멧·소총·신발·상의·가방 변형, 손 들기·웅크림·짐 들기 자세
                      + 3단계 단서 파츠(어깨 패치·허리 불룩·등 총몸·무전기·조끼 끈·전술 장갑)와 자세(손 숨기기·얼어붙음·무전·완장 뜯기·총 꺼내기), 노란 윤곽
                      + 4단계: 부대 패치 별·삼각형, 신분증 소품(setCard), 총구 내림·한 손 늦게·신분증 내밂 자세, 옷 올라감(shirtLift: 허리띠·권총 손잡이)
    Outfits.js        ★ 복장 생성 (soldierOutfit: 진영 장비 세트 / civilianOutfit: 사복 무작위) + describeEquipment (장비 데이터)
    Insignia.js       ★ 표식 컴포넌트 (색·형태 교체 가능, 헬멧 형태별 띠, 위장용 'tape' 형태, describe())
    Soldier.js        ★ 적·아군 공통 병사 베이스 (지각·대상 선택·조준·점사·탄창·엄폐 주기·NPC 대상 사격)
    EnemySoldier.js   적군 AI 상태 머신 (소총수/돌격병/창문 사수) — 플레이어 우선, 근처 아군도 공격. 위장 프로필이 있으면 정체를 드러낼 때까지 DisguiseController 가 조종
    Disguise.js       ★ 3단계 위장 적: 위장 프로필(rollDisguiseProfile)·위장 복장(disguiseOutfit)·DisguiseController(섞이기·접근·동행·감시·습격 요청·기습 조건·정체 드러내기)
    Clues.js          ★ 3단계 단서 카탈로그: GEAR_CLUES(장비 단서), BEHAVIOR(행동 사실), gearFacts/behaviorFacts/factsFor (관찰 모드가 읽는 '사실')
    Behaviors.js      3단계 공통 행동 보조: 이동(moveToward·escortTarget·pickApproachNode)과 행동 기록(trackApproach·trackSquad·trackFightFire) — 진짜·가짜가 같은 코드 사용
    AllySoldier.js    아군 AI (enter/move/cover/hold/clear/escort/join, 사선 회피, 분대 교대 퇴장, 동행 엄호·낙오병 합류, 무전 반응)
    AllySquad.js      아군 분대 (목표: 전진·실내 소탕·재집결·교대 이동, 무전 콜아웃, 동행 분리·1인 낙오병 분대)
    CivilianNPC.js    민간인 AI (숨기·엿보기·웅크림·대피·손 들기·공황, 얼어붙음·도움 요청, 대피 지점에서 화면 밖이 되면 퇴장)
    NPCManager.js     생성(spawnEnemy/spawnAllySquad/spawnCivilian/spawnDisguised)·갱신·히트박스 레이캐스트·엄폐/창가 선택·화면 노출 추적·getAimedNPC·진영별/겉보기별 목록·대피 지점·무전 전파
  director/
    SpawnDirector.js  ★ 스폰 디렉터 (리듬·출현 지점·예고음·위협 단계, 인구/생성기 등록 구조, 출현 비율 크레딧(진짜/가짜), spawnAppearance, callInAssault)
    Populations.js    등록되는 인구: AllyPopulation(증원 분대·교대), CivilianPopulation(초기 배치·등장·대피 유도), AmbushEvent(돌발 조우),
                      DisguisePopulation(위장 적 등장·오판 유도용 진짜 행동 추첨·습격 틈 침투)
  dialogue/
    VoiceSystem.js    ★ 자막·음성 모듈 (화자 라벨, 우선순위 큐, 채널 차단, Web Speech 선택) — 4단계 문답도 이걸로 출력 (player 채널, nodedupe)
    Callouts.js       무전·외침 대사 목록(LINES — 3단계: 동행·낙오병·무전 응답·도움 요청 추가), 방위·위치 묘사(describeLocation: "동쪽 건물 2층 창문" 등)
    DialogueSystem.js ★ 4단계 말 걸기 (E·1~4, 대상 선택·메뉴·닫힘 조건·대본 실행·통계·첫 안내)
    Responses.js      ★ 4단계 대답 규칙 = 숙련도별 반응 표 (질문 목록 QUESTIONS, '정지!' 반응, 질문별 대본)
    DialogueLines.js  ★ 4단계 대사 데이터 (플레이어·파란 표식 병사·민간인·작전 무전, 암구호 단어 쌍, 없는 부대명, 고유어 숫자)
    Countersign.js    ★ 4단계 암구호·실내 기준수·아군 부대 (교체·작전 무전·인물별 아는 것 knowledgeOf)
  game/
    ScoreSystem.js    점수·콤보·멀티킬·즉응 사살·결과 통계 + 감점(applyPenalty)·콤보 초기화/잠금·어시스트·대피 점수 + 위장 적 식별·근거 있는 판단 보너스
    PenaltySystem.js  ★ 오인 사격 페널티 (감점·콤보 잠금·경고·무전 두절·작전 해임)
    Combat.js         히트스캔 판정 (월드 vs NPC 히트박스, 가까운 쪽)
    Observation.js    ★ 3단계 관찰 모드 (Q 누르고 있기: 대상 선택·사실 알아채기·거리/조명/각도 제한·메모·노란 윤곽)
  ui/
    HUD.js            HUD 전체 (3단계: 관찰 화면·게이지·메모, 첫 안내, 정체 드러냄 방향 경고, "위장 적 사살!" / 4단계: 대화 메뉴, 암구호 카드, 첫 말 걸기 안내)
    Menus.js          시작(작전 브리핑)·일시정지(암구호 카드 설정 포함)·결과 화면
    DebugOverlay.js   디버그 오버레이 (3단계: 위장 여부·남은 단서·기습 조건 진행 / 4단계: 암구호 상태, 대상이 아는 것, 문답 통계)
```

## config 위치

모든 튜닝 수치와 키 설정은 **`js/config.js`** 한 파일에 있다.
`CONFIG.keys`(키 — 3단계 `observe: Q`, 4단계 `interact: E`, `dialog1~4: 1~4/숫자 패드`), `CONFIG.weapon`, `CONFIG.npc`, `CONFIG.threat`(레벨 1 → 최고 레벨 보간 값),
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

3단계 추가:
- **`CONFIG.disguise`** — 위장 적 전부. `[a, b]` 쌍은 위협 단계 `fromThreat`(2) → 최고 단계로 보간(`npc/Disguise.js` 의 `disguiseT / lerpD / lerpRangeD`)
  - `fromThreat 2`, `allyChance [0.1, 0.3]`(아군처럼 보이는 등장 중 가짜 비율), `civilianChance [0.1, 0.25]`, `maxActive [2, 3]`(동시 상한)
  - `gearClues [[2,3],[0,1]]`(장비 단서 수 범위: 초반 → 후반), `behaviorTraits [2, 3]`(행동 성향 수), `scoutChance {ally 0.15, civilian 0.55}`(정찰형 비율),
    `escortChance 0.35`(가짜 아군 기습형 중 동행 접근), `nearSquadChance 0.6`, `nearCiviliansChance 0.6`, `assaultInfiltrate [0.35, 0.6]`, `blendTime [6, 14]`(섞여 있는 시간)
  - `ambush` — 기습 조건: `range 10`(m), `opportunityDelay [0.35, 0.8]`(기회 지속 시간), `patience [[13,20],[7,12]]`, `escortPatience [[22,34],[12,20]]`, `backAngle 110`(°),
    `telegraph [0.5, 0.8]`(예고 동작 초), `damagedTelegraph 0.35`, `accuracyMul 1.5`, `hotTime 5`
  - `scout` — 정찰형: `watchToCall [[16,24],[9,15]]`, `callTime 1.4`, `revealAfterCall [4, 7]`, `watchRange [12, 38]`, `longWatchClue 6`
  - `decoy` — 오판 유도용 진짜 행동: `allyChance [0.3, 0.5]`(아군 분대 등장 중 낙오병·동행), `regroupEscortChance 0.2`, `civilianChance [0.12, 0.25]`(얼어붙음·도움 요청), `escortTime [35, 70]`, `frozenTime [8, 18]`
- **`CONFIG.observe`** — 관찰 모드: `zoom 2`, `raiseTime 0.3`(떼고 총 드는 시간), `blendTime 0.18`, `coneDeg 6`, `maxDistance 70`, `factInterval 0.5`, `nearDist 8`, `slowPerMeter 1/12`,
  `gearMaxDist 38`, `darkInterior 0.6`, `outlineTime 8`, `memoLinger 3.5`, `moveMul 0.6`, `sensitivityMul 0.5`, `ambientDuck 0.4`
- `CONFIG.score.disguiseId`(+200 위장 적 식별), `CONFIG.score.evidence`(+100 근거 있는 판단)
- `CONFIG.gearSets.ally.patch: 'shield'`(진짜 아군 어깨 파란 방패 패치), `CONFIG.insignia.tapeColor`(위장 테이프 완장 색 — 진짜 파랑보다 하늘빛)

4단계 추가 (`CONFIG.reservedKeys` 는 없앰 — E·1~4 는 이제 `CONFIG.keys`):
- **`CONFIG.dialogue`** — 말 걸기·문답 수치 전부
  - 거리·메뉴: `rangeOutdoor 20`, `rangeIndoor 10`, `coneDeg 5`, `menuTimeout 4`(대답이 끝난 뒤부터 다시 셈), `losGrace 0.6`, `leaveExtra 8`, `holdTime 1.2`
  - `units` — 아군 부대 3개 `{ name, patch, patchName }` (브리핑·패치·"소속 대!" 공통). `gearSets.ally.patch` 는 기본값이고 실제론 분대 부대의 패치
  - `countersign { staleWindow 20, realStaleChance 0.3, correctionDelay }`, `indoor { base [7, 12], fakeGuessChance 0.1 }`
  - 대답 시간: `answerDelay [0.5, 1.0]`(진짜 아군 암구호·소속), `indoorDelay [0.35, 0.65]`, `hesitate [1.3, 2.3]`(머뭇거린 뒤 대답)
  - 진짜 아군 짜증: `annoy { window 30, maxQuestions 3 }`, `annoyExtraDelay`
  - 위장 적: `halt`(숙련도별 [멈춤, 못 들은 척, 도주] 확률), `skill0Password`([엉뚱한 단어, 도주, 기습]), `skill0RevealOnStuck 0.35`, `skill0LowerRefuse 0.6`,
    `skill0HandsFlee 0.4`, `skill2UnitMismatch 0.5`, `suspect { boostChance 0.55, boostTime 12, revealIn [3, 6], oppMul 0.5, pressureQuestions 3 }`,
    `questionPressure 2.5`, `pressureMinLeft 2.5`, `aimPanicMulInTalk 0.5`, `flee { dist [24, 40], hideTime [8, 15], callChance 0.5 }`,
    `lowered { real 7, fake 9, backAngle 70, oppMul 0.8 }`, `hands { holdReal 4, late [1.1, 1.8], lag [0.7, 1.2] }`, `idShow 3.5`, `fakeEvac { walk [2.0, 3.6], returnChance 0.5 }`, `hintTime 6`
- `CONFIG.defaults.countersignCard`(true — 암구호 카드 항상 표시, 일시정지 설정에서 끄면 외워서 플레이), `CONFIG.score.evidence` 는 문답 실패도 근거로 인정
- 대사 문장은 config 가 아니라 **`js/dialogue/DialogueLines.js`**(쉽게 고칠 수 있게 데이터만 모은 파일)

## 핵심 클래스와 역할

- **Game**: 시스템 생성·연결, 상태 전환, 루프. `game.time`(진행 중에만 흐르는 게임 시간), `game.runTime`(이번 판 생존 시간)
- **World**: 생성 결과 보관. `world.nav`, `world.collision`, `world.buildings`, `world.enterable`, `world.spawnPoints`, `world.city.fires`
- **NPCBase**: `trueFaction`, `apparentFaction`, `health`, `firstSeenAt`(화면에 처음 보인 게임 시각), `takeDamage(info)`, `setApparentFaction(f, outfit)`, 경로 이동(`setPath`, `_followPath`)
  - 3단계: `behavior`(Map: 키 → `{first, t, n, variant}`), `noteBehavior(key, variant)`, `hasBehavior(key)`, `observationFacts()`(장비 + 기록된 행동 사실),
    `getObserved()` → `{ found: Map(키 → 사실), anomalies, outlineUntil }`, `disguised`(정체를 드러내기 전 위장 적인지), `looksHostile`(겉보기 적 = 아군·민간인 AI 가 적으로 인식)
  - 자세 입력값(0~1): `handsUp`, `cower`, `hideHands` + `handsMode('back'|'pocket')`, `shock`(얼어붙음), `tear`(완장 뜯기), `reach`(숨긴 총 꺼내기), `radioTalk`
- **EnemySoldier**: 상태 `enter → move → cover/post(hide↔peek) / engage / rush / search`, 지각(`_perceive`, NPC마다 0.16~0.26초 주기), 청각(`hearShot`), 사격(`_fireShot`, `_hitChance`)
  - 3단계: `disguise`(위장 프로필, 없으면 null), `ctl`(DisguiseController), 상태 `disguise`. 위장 중엔 `hearShot`·지각 대신 `ctl.update`, 맞으면 `ctl.startReveal('damaged')`,
    죽으면 `ctl.onKilled()`. `hotUntil`(드러낸 직후 명중률 ×1.5), `gunSound` 는 소총 형태(굽은/직선)를 따름
- **NPCManager**: `spawnEnemy`, `raycast(origin, dir, maxDist)`(부위 판정), `findCover`, `pickPostNode`, `getAimedNPC`, `countActive`
  - 3단계: `spawnDisguised({as, spawnPoint, entrance, threat, profile?, role?, infiltrate?, fromEnemySide?})`, `byFaction(f)`(진짜 소속) / `byApparent(f)`(겉보기 — 위장 적은 ally/civilian 쪽),
    `broadcastRadio(squad, enemy)`(위치 무전이 주변 아군 표식 인물에게 들림 → `onRadioCallout`), `countDisguised()`
- **SpawnDirector**: `HostilePopulation`(리듬), `spawnHostile`, `pickSpawnPoint`, `isSpawnVisible`, `registerPopulation`, `registerFactory`
  - 3단계: `credits.allyFake / civilianFake`(가짜 크레딧), 생성기 `'disguised'`, `capFor('disguised')`, `disguises`(DisguisePopulation: `spawnFake(as)`, `rollDecoy(kind)`, `onAssault()`),
    `callInAssault(fromNpc)`(정찰형의 습격 요청), `disguiseCount`, `decoyCount`, `spawnAppearance(kind, {as, role, decoy, nearPos, distRange, ...})`
- **Insignia**: `setColor(hex)`, `setShape('band'|'armband'|'helmet'|'tape'|'none')`, `setVisible`, `describe()` → `{visible, color, colorName, shape, tape}`
- **HumanoidRig 4단계**: animate 입력 `handsLag, lowered, showCard`, `setCard(visible)`, outfit 필드 `shirtLift`, 패치 `'star'|'triangle'` 추가
- **HumanoidRig**: `applyOutfit(outfit)`(같은 뼈대에 다른 복장), `animate(dt, {speed, aim, aimPitch, crouch, handsUp, cower, hideHands, handsMode, shock, tear, reach, radioTalk})`, `onHit`, `startDeath`,
  `setHighlight(intensity)`(노란 윤곽). 3단계 outfit 필드: `patch`('shield'|'square'|'round'|null), `waistBulge`, `backRifle`, `radio`, `vestStraps`, `tacticalGloves`
- **ScoreSystem**: `NPC_KILLED` 구독 → 점수·콤보 계산 → `SCORE_KILL` 발행. `applyPenalty(points)`, `resetCombo()`, `lockCombo(sec)`, `comboLocked`, 어시스트·대피 → `SCORE_EVENT`
- **Soldier** (적·아군 공통): `target`('player' 또는 NPC), `candidateTargets()`(서브클래스가 정의), `rollDamage(target)`, `_perceive`, `_shooting`, `_fireShot`, `_coverCycle`, `_goTo`
- **AllySoldier / AllySquad**: `squad.plan()`(전진·소탕·재집결), `squad.callout(member, text, priority)`, `squad.reportEnemy`, `squad.withdraw()`, `member.orderMove/orderClear/orderWithdraw`
  - 3단계: `member.startEscort(sec)`(동행), `member.startJoin()`(낙오병 합류), `member.onRadioCallout(enemy, squad)`, `squad.detachEscort(sec)`, `squad.straggler`, `squad.escortDecoyT`, `squad.free`.
    아군은 `byApparent('enemy')` 만 공격한다(위장 적에게 속음)
- **CivilianNPC**: `hearDanger(pos, dist)`, `onAimedAt(dt)`(손 들기), `startPanic()`, `encourageFlee()`, 대피 성공 시 `CIVILIAN_EVACUATED`
  - 3단계: `decoy`(`'frozen'|'helpSeeker'|null`), 상태 `frozen`(얼어붙음)·`seek`(도움 요청, 플레이어 3~5m)·`leave`(대피 지점 도착 후 화면 밖이 되면 퇴장)
- **DisguiseController** (`npc.ctl`, 3단계): 모드 `enter → blend → approach | escort | watch(→ call) → loiter → reveal`. `update(dt)`, `startReveal(reason)`, `onGunfire`, `onAimedAt`, `onRadioCallout`,
  `ambushProgress`(0~1), `oppNow`('등'|'재장전'|'관찰'|null), `identifiedKill`(드러내기 전 사살인지), `onKilled()`
- **ObservationSystem** (`game.observation`, 3단계): `active`, `weaponDown`(관찰 중 또는 총 드는 중 → 사격·정조준 불가), `target`, `distance`, `progress`, `status`, `memo()`,
  `factsFound`, `anomaliesFound`, `usedOnce`, `reset()`. 게임 루프에서 가장 먼저 갱신(`Game._updatePlaying`)
- **Clues / Behaviors** (3단계): `GEAR_CLUES`, `BEHAVIOR`, `factsFor(npc, time)` / `moveToward`, `escortTarget`, `pickApproachNode`, `trackApproach`, `trackSquad`, `trackFightFire`, `nearestVisibleHostile`
- **DialogueSystem** (`game.dialogue`, 4단계): `target`, `open`, `reaction`('stop'|'ignore'|'flee'), `busyT`(대답 대기), `idleT`(메뉴 남은 시간), `options()`(HUD 선택지),
  `sameBuilding()`, `tryOpen()`(E), `ask(slot)`(1~4), `close(reason)`, `stats { talks, questions, exposed, confirmed, ambushed }`, `notice`, `reset()`.
  게임 루프에서 관찰 다음에 갱신(`Game._updatePlaying`). 대본(steps)은 대화가 닫혀도(시간 초과·E) 끝까지 실행, 사격·정체 드러냄·죽음이면 버림
- **Responses** (4단계): `talkKind(npc)`('ally'|'civilian'|'fake'), `QUESTIONS`(겉보기별 메뉴), `haltReaction(npc)`, `respond(npc, q, { cs, number })` → `{ steps: [{ at, say, act, answer: { outcome, fail } }], end }`
- **CountersignSystem** (`game.countersign`, 4단계): `current/previous {challenge, reply}`, `indoorBase/prevIndoorBase`, `changedAt`, `stale`(교체 후 20초), `sinceChange`, `rotations`,
  `start()`(판 시작), `rotate()`(THREAT_LEVEL 때), `update(dt)`(작전 무전 송출), `knowledgeOf(npc)` → `{ current, previous, indoor, unit, real }`. 보조: `unitByName`, `unitByPatch`
- **NPC 대화 공통** (4단계, NPCBase): `talkLabel`('파란 표식 병사'|'민간인'), `sayTalk(text)`, `holdForTalk(sec)`(talkHoldT), `lowerWeapon(sec)`(lowerT → lowered 자세·사격 안 함),
  `presentCard(sec)`(cardT → 신분증), `lagHands(sec)`(handsLag), `noteQuestion(window)`, `dialogueFailed`, `unit`(진짜 아군 부대).
  AllySoldier: 대화 중 멈춤(교전 중이면 싸우며 대답)·사선 회피 중지, `lowerT` 동안 사격 안 함. AllySquad: `unit`. CivilianNPC: `commandHands(sec)`, `dlgEvacuate()`.
  DisguiseController: `talkHalt(reaction)`, `ignoring`, `stopIgnoring()`, `onQuestioned()`, `suspect()`, `startFlee(variant)`, `startFakeEvac()`, `commandHands(hold, lag)`, `onTalkAimed(step)`,
  모드 추가 `flee → hidden → (call | approach)`, `fakeEvac → (stand | approach)`, `suspectT`, `panicAcc`
- **Game.debugSpawn(kind, o)** (테스트용): 위 "실행·테스트" 참고
- **PenaltySystem**: `warnings`, `allyHits/allyKills/civHits/civKills`, `stats()`, `reset()`
- **VoiceSystem** (`game.voice`): `say({speaker, text, channel, priority, voice, force, duration})`, `mute(channel, sec)`, `isMuted`, `muteRemaining`, `setSpeech(on)`, `clear()`, `history`
- **NPC 공통 조회**: `npc.getEquipment()` → `{ faction(겉보기), headwear, helmetStyle, weapon, rifleStyle, magazine, footwear, footwearClass, vest, top, bag, elder, insignia:{visible,color,colorName,shape,tape}, hands,
  patch, concealed:{waistBulge, backRifle}, radio, vestStraps, gloves('bare'|'military'|'tactical') }` (3단계 필드: 마지막 줄),
  `npc.handsState()` → `'weapon'|'aiming'|'raised'|'covering'|'hidden'|'clutching'|'carrying'|'empty'`, `npc.isHostileTo(other)`(trueFaction 기준)

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
3단계 추가: `DISGUISE_SPAWNED {npc, profile}`, `DISGUISE_REVEALING {npc, reason}`(예고 동작 시작 — 장전음), `DISGUISE_REVEALED {npc, as, role, reason, ambush}`(정체를 드러냄, `ambush` = 먼저 맞아서가 아닌 기습),
`DISGUISE_KILLED {npc, as}`(드러내기 전 사살 — 점수는 `NPC_KILLED` 에서), `DISGUISE_CALLED {npc}`(정찰형이 습격을 부름), `OBSERVE_START {first}`, `OBSERVE_FACT {npc, fact, distance}`.
4단계 추가: `DIALOGUE_OPEN {npc, indoor, first, firstIndoor}`, `DIALOGUE_ASK {npc, question, number}`, `DIALOGUE_ANSWER {npc, outcome, fail}`(통계·테스트용 — 화면엔 판정 없음),
`DIALOGUE_CLOSE {npc, reason}`, `COUNTERSIGN_CHANGED {current, previous, indoorBase, prevIndoorBase, initial}`. `DISGUISE_REVEALING/REVEALED` 의 reason 에 `'questioned'`(문답에 막혀 드러냄) 추가.
위장 적의 `NPC_DAMAGED/KILLED` 는 `trueFaction: 'enemy'`, `apparentFaction: 'ally'|'civilian'`(드러내기 전) 으로 나간다 — 오인 사격 페널티 없음.

## 3단계 단서 목록과 판정 규칙

### 원칙
- **장비 단서 = 확정 증거**: 진짜 아군·민간인에게는 절대 없다(진짜 아군은 항상 `gearSets.ally` + 파란 방패 패치, 진짜 민간인은 항상 비무장·민간 신발·맨손).
  작아서 가까이서만 보이고, 관찰 모드에선 38m 이내 + (어두운 실내면) 손전등이 비춰야 메모된다. 위협 단계가 오를수록 위장 적의 장비 단서 수가 준다(2~3개 → 0~1개).
- **행동 단서 = 의심 근거**: 그 인물에게 *실제로 일어난 일만* `npc.behavior` 에 기록된다. 위장 적이 주로 보이지만 진짜 낙오병·동행 아군·얼어붙은/도움 청하는 민간인도 같은 기록을 남긴다.
- **모든 단서는 3D 로 보인다**: 관찰 모드는 '알아채기'를 도울 뿐, 같은 단서를 맨눈으로도 볼 수 있다(패치·완장·헬멧·탄창·신발·불룩함·총몸·무전기·끈·장갑, 손 숨기기·무전 자세 등).
- **관찰 메모는 사실만** 쓴다. "적입니다" 같은 결론은 절대 쓰지 않는다. 이상(anomalous) 사실을 하나라도 찾으면 그 인물에 8초간 노란 윤곽(판단은 플레이어 몫).

### 장비 단서 (`npc/Clues.js` `GEAR_CLUES` — 위장 프로필 `gear` 의 키)
| 겉보기 | 키 | 3D 표현 | 관찰 메모 (이상) | 진짜일 때 메모 (중립) |
| --- | --- | --- | --- | --- |
| 아군 | `curvedRifle` | 굽은 탄창·나무 개머리판 소총 | 굽은 탄창 소총 | 직선 탄창 소총 |
| 아군 | `enemyHelmet` | 챙 있는 둥근 헬멧 | 챙 있는 둥근 헬멧 | 낮고 넓은 헬멧 (뒷목 가리개) |
| 아군 | `patchMissing` / `patchWrong` | 어깨 패치 없음 / 올리브색 네모·누런 동그라미 패치 | 어깨 부대 패치 없음 / 어깨 패치: 올리브색 네모·누런 동그라미 | 어깨 부대 패치: 파란 방패·별·삼각형 (4단계: 부대마다) |
| 아군 | `tapeBand` | 하늘빛 테이프 완장·헬멧 띠, 비스듬히 엉성하게 감김 + 늘어진 끝 | 완장이 테이프로 엉성하게 감겨 있음 | 파란 완장·헬멧 띠 |
| 민간인 | `combatBoots` | 군화 | 군화 착용 | 운동화·구두·작업화 |
| 민간인 | `waistBulge` | 허리춤 불룩함 (손을 들면 옷이 올라가 권총 손잡이·권총집이 드러남) | 허리춤이 불룩함 / 손을 들자 허리춤에 권총 손잡이가 드러남 | (메모 없음 — 손을 들면 허리띠만 보임) |
| 민간인 | `backRifle` | 등 뒤 총몸 윤곽 + 총구·개머리 끝 | 등 뒤로 길쭉한 총몸 윤곽이 비침 | (메모 없음) |
| 민간인 | `radio` | 가슴 무전기 + 안테나 | 가슴에 무전기를 달고 있음 | (메모 없음) |
| 민간인 | `vestStraps` | 옷 위 조끼 끈 | 옷 위로 조끼 끈이 보임 | (메모 없음) |
| 민간인 | `tacticalGloves` | 어두운 전술 장갑 | 전술 장갑 착용 | 맨손 |

- 그 밖의 중립 장비 사실: 사복 종류(셔츠·재킷·코트·스웨터, 노인), 짐 가방·배낭, 군화(군인), 빨간 완장(드러낸 적).
- 표식 사실(`glow`)은 빛나서 어두운 실내에서도 가까우면(38m 안) 손전등 없이 메모된다.
- 보이는 방향(`view`, 4단계 전 수정): 어깨 패치 `side`(인물 정면 기준 25~140°에서 볼 때), 등 뒤 총몸 `back`(75° 이상), 허리춤·무전기 `front`(100° 이하), 나머지 `any`.
  옷이 올라가 드러난 권총 손잡이는 `any`.

### 행동 사실 (`npc/Clues.js` `BEHAVIOR` — `npc.noteBehavior(key)` 로 기록)
| 겉보기 | 이상 (의심 근거) | 기록 조건 | 진짜도 보이는 경우 |
| --- | --- | --- | --- |
| 아군 | `loner` 분대와 떨어져 혼자 움직임 | 15m 안에 다른 아군 표식 인물 없이 5초 | 낙오병·동행 아군 |
| 아군 | `noFireInFight` 교전 중인데 적에게 쏘지 않음 | 빨간 표식이 보이는데 마지막 사격 뒤 4초가 넘은 상태가 4초 이어짐 | 재장전·사선 회피로 한동안 못 쏜 아군 (드묾) |
| 아군 | `fireAir` 허공에 대고 쏨 | 위로 쏜 사격 | — |
| 아군 | `ignoreRadio` 아군 무전 지시에 반응하지 않음 | 플레이어 40m 안에서 다른 분대의 적 위치 무전을 무시 | — |
| 아군 | `stare` 계속 이쪽을 보며 다가옴 | 25m 안에서 플레이어를 바라보며 2.5초 다가옴 | 낙오병(합류하러 다가옴) |
| 아군 | `fromEnemySide` 적이 있던 쪽에서 나타남 | 교전 중(또는 화면에 보이는) 빨간 표식 25m 안에서 등장 | 적 근처에 섞여 등장한 아군 |
| 민간인 | `hideHands` 손을 등 뒤로/주머니에 숨기고 있음 | 지금 또는 최근 12초 안에 숨김 | — |
| 민간인 | `noCower` 총성에 웅크리지 않음 | 들리는 총성에 웅크리지 않음 | 얼어붙은 민간인 |
| 민간인 | `lateHands` / `noHands` 조준하자 한참 뒤에야 / 조준해도 손을 들지 않음 | 조준 1.3~2.1초 뒤 / 1.2초 넘게 안 듦 | — |
| 민간인 | `towardPlayer` 대피하지 않고 이쪽으로 다가옴 | 30m 안에서 2초 다가옴 | 도움 요청 민간인 |
| 민간인 | `longWatch` 한곳에서 이쪽을 오래 지켜봄 / 창가에서 오래 내다봄 | 정찰형이 6초 넘게 지켜봄 | — |
| 민간인 | `radioTalk` 무전기에 대고 무언가 말함 | 정찰형의 습격 요청 | — |

4단계 말 걸기 행동 (대답 '내용'은 기록하지 않음 — 판정은 플레이어 몫):

| 이상 (의심 근거) | 기록 조건 | 중립 (진짜도) |
| --- | --- | --- |
| `ignoredHalt` "정지!"를 못 들은 척 계속 걸어감 | 위장 적 '못 들은 척' | `stoppedOnHalt` "정지!"에 멈춰 섬 |
| `fledTalk` "정지!"에 / 질문을 받자 달아남 | 위장 적 도주 | `loweredWeapon` 지시에 총구를 내림 |
| `hesitated` 질문에 머뭇거림 | 위장 적의 머뭇거림 (실내 문답은 위장 적이면 항상) | `showedEmptyHands` 빈손을 들어 보임 |
| `refused` 지시를 거부함 | 숙련 0 의 거부 | `showedId` 신분증을 보여 줌 (위조 포함) |
| `lateHands` / `oneHandLate` "손 들어!"에 늦게 / 한 손을 늦게 듦 | 숙련 1 / 2 | `evacOk` 대피하라는 말에 대피로로 감 |
| `noId` 신분증이 없다고 함 | 숙련 0~1 | `annoyed` 거듭 묻자 짜증을 냄 |
| `fakeEvac` 대피하라는 말에 가다가 멈춤 / 되돌아옴 | 위장 민간인 | |

중립 행동 사실: `withSquad` 분대와 함께 움직임, `firedAtEnemy` 적을 향해 사격함(가짜 아군의 빗나가게 쏘기도 여기에 기록), `radioAck` 아군 무전에 반응함, `escorting` 뒤에서 따라오며 엄호함,
`cowered` 총성에 웅크림(가짜의 웅크리는 척 포함), `handsUpQuick` 조준하자 바로 손을 듦, `helpCry` 도와달라고 외침(숙련된 가짜 민간인도), `fled` 대피로 쪽으로 달아남.

### 관찰 판정 규칙 (`game/Observation.js`)
- 대상: `getAimedNPC({ maxDistance: 70, coneDeg: 6 })` — 화면 중앙에 가장 가까운 인물. 대상이 바뀌면 진행도 초기화. 가려지면(조준 판정 실패) 대상 없음.
- 간격: `0.5초 × (1 + max(0, 거리 − 8m) / 12)` 마다 아직 찾지 않은 사실 하나를 무작위로(20m = 1초, 32m = 1.5초).
- 장비 사실은 38m 이내 + 밝음(실내 어둠 0.6 이상이면 손전등 범위·각도 안) 필요. 행동 사실은 거리·조명 제한 없음(이미 일어난 일).
- 찾은 사실은 인물별로 저장(`npc.observed.found`) — 다시 관찰해도 이어서 쌓인다. 상태 문구: "관찰 중…", "어두워서 장비가 안 보임 — 손전등(F)", "너무 멀어서 장비가 안 보임", "더 알아낸 것 없음".
- 이상 사실을 찾으면 `observed.anomalies++`, 8초 노란 윤곽, 알아챔 효과음(이상/중립 음이 다름). 결과 화면의 "관찰로 찾은 이상 단서" 에 집계.
- 장비 사실은 보는 각도도 맞아야 메모된다(위 `view`). 각도 때문에 안 보이는 사실은 상태 문구에 드러내지 않는다("더 알아낸 것 없음"과 같게).
- 사살 점수의 "근거 있는 판단"(+100) 은 그 인물의 `observed.anomalies > 0` 이거나 4단계 문답에서 틀리거나 머뭇거렸을 때(`dialogueFailed`).

## 위장 프로필 구조 (`npc.disguise`, `npc/Disguise.js` `rollDisguiseProfile`)

```js
{
  as: 'ally' | 'civilian',          // 겉보기 소속 (trueFaction 은 항상 'enemy')
  role: 'ambusher' | 'scout',       // 기습형 / 정찰형 (scoutChance: 아군형 15%, 민간인형 55%)
  mode: 'approach' | 'escort' | 'watch',  // 접근 / 동행(가짜 아군 기습형의 35%) / 감시(정찰형)
  skill: 0 | 1 | 2,                 // 위장 숙련도 = 장비 단서 수로 결정 (2개 이상 → 0, 1개 → 1, 0개 → 2 '완벽 위장')
  gear: ['curvedRifle', ...],       // 장비 단서 키 (GEAR_CLUES) — 진짜에겐 절대 없는 확정 증거
  traits: Set(['loner', ...]),      // 행동 성향 2~3개 (숙련도 2 면 하나 적게). 실제로 그 상황이 일어나야 기록(단서)이 된다
                                    //   아군형: loner, noFire|fireAir, ignoreRadio, stare, fromEnemySide / 민간인형: hideHands, noCower, lateHands|noHands
  handsMode: 'back' | 'pocket',     // 손 숨기는 방식
  infiltrate: boolean,              // 습격 구간 혼란을 틈탄 침투 (섞이는 시간 짧음)
  revealed, revealedAt, revealReason, revealStarted,  // 'back'|'reload'|'observe'|'patience'|'scout'|'cornered'|'damaged'|'questioned'(4단계)
  patchUnit: '샛별중대',            // 4단계: 어깨에 단 부대 패치 (patch 단서가 있으면 그게 우선)
  unitClaim: '봉우리대대',          // 4단계: "소속 대!" 대답 — 숙련 0: 어색한 없는 부대 / 1: 그럴듯한 없는 부대 / 2: 진짜 부대명(skill2UnitMismatch 확률로 패치와 다름)
}
```

- 숙련도 효과(3단계): 숙련될수록 행동 성향이 적고, 관찰 모드를 기회로 삼는 데 더 오래 기다리며(×(1 + 0.6·skill)), 조준당했을 때 버티는 시간이 길고(×(1 + 0.3·skill)),
  가짜 민간인은 "도와주세요!"·"쏘지 마세요!" 를 외칠 확률이 높다.
- 4단계: 숙련도가 곧 문답 능력 — 아래 "4단계 숙련도별 반응 표". `rollDisguiseProfile(as, threat, { skill })` 로 숙련도를 지정할 수 있다(테스트·디버그).

## 4단계 대화 시스템 구조

```
E (game.dialogue.tryOpen)
  └ getAimedNPC({ maxDistance: 22, coneDeg: 5 }) → 거리(실외 20 / 실내 10)·겉보기(빨간 표식이면 무반응) 확인
  └ [나] "정지!" + Responses.haltReaction(npc) → 'stop'(멈춰 섬) | 'ignore'(위장: 못 들은 척) | 'flee'(위장: 도주)
  └ 메뉴 열림 (HUD #dialog-menu): Responses.QUESTIONS[겉보기] — 파란 표식: 암구호·실내 확인 문답(같은 건물에서만)·소속·총 내려 / 민간인: 손 들어·신분증·대피
1~4 (dialogue.ask)
  └ [나] 질문 대사 (DialogueLines) → Responses.respond(npc, q, ctx) → 대본 steps 를 실시간 실행
       say: npc.sayTalk(겉모습 라벨) / act: 각 AI 의 행동(멈춤·총 내림·손 들기·신분증·대피·도주·정체 드러냄…) / answer: 통계·dialogueFailed
  └ 대답이 끝날 때까지 메뉴는 '응답 대기', 끝나면 4초 타이머 다시
닫힘: 4초 무입력 · 시야 0.6초 상실 · (말 걸기 거리 + 8m) 멀어짐 · E · 사격(WEAPON_FIRED) · 상대 사망 · 정체 드러냄(DISGUISE_REVEALING) · 플레이어 사망/해임
```
- 대화 중에도 모든 시스템이 그대로 돈다(관찰 모드와 동시에도 가능). 총은 들고 있고 정조준·재장전·이동 모두 가능.
- 대화 상대는 2단계 '겨누면 손 들기' 반응을 하지 않는다("손 들어!"로 따로 시험). 위장 민간인은 대신 궁지 압박만 쌓인다(숙련 1~2 는 절반).
- 멈춰 선 상대는 대화 동안 서 있고(talkHoldT), 닫힌 뒤 1.2초 더 서 있다가 하던 일로 돌아간다. 진짜 아군은 적과 교전 중이면 싸우면서 대답.
- 대사 위치: **`js/dialogue/DialogueLines.js`** (DLINES 키별 변형 목록, `{c}{r}{p}{w}{n}{a}{unit}{sq}{dir}` 치환). 화자 라벨은 `SPEAKER`.

## 4단계 암구호·실내 기준수 규칙

- **암구호**: 문어/답어 쌍(`PAIRS` 37개). 판 시작에 '금일 암구호 하달' + 직전 쌍을 '유출된 이전 암구호'로 둔다. 위협 단계가 오를 때마다(THREAT_LEVEL, 약 1분) 교체 —
  `[작전 무전] 암구호 변경. 문어 ○○, 답어 ○○.` → 1.6초 뒤 `실내 기준수 ○.` (아군 사살 무전 두절과 무관하게 들림), HUD 카드 3초 깜박임, 20초간 이전 것 취소선.
  플레이어는 질문할 때 현재 문어를 자동으로 외친다(메뉴에 단어를 보여주지 않음 — 카드를 숨기면 무전으로 들은 걸 기억해야 함).
- **실내 기준수**: 7~12(직전 값과 다르게). 플레이어가 외치는 수는 1 ~ (기준수−1) 무작위, 정답 = 기준수 − 외친 수. 합이 맞는지는 표시하지 않는다.
  아군 부대 안에서만 공유 → 위장 적은 숙련도와 무관하게 모름(머뭇거린 뒤 추측, `fakeGuessChance` 10%로 우연히 정답). **같은 건물 안**(플레이어·상대 모두 `getIndoorInfo` 같은 건물)일 때만 물을 수 있다.
- **아군 부대**: 진짜 아군 분대는 생성 때 `config.dialogue.units` 중 하나 → 분대원 전원의 어깨 패치 = 그 부대 패치, "소속 대!"에 "{부대} {분대 호출명} 분대" 로 답함.
- 그 인물이 아는 것(`countersign.knowledgeOf`): 진짜 아군 = 현재·이전 암구호·기준수·자기 부대 / 위장 숙련 2 = 현재·이전 암구호, 진짜 부대명 하나 / 숙련 1 = 이전(유출) 암구호, 가짜 부대명 / 숙련 0 = 없음.

## 4단계 숙련도별 반응 표 (`dialogue/Responses.js`)

| 질문 | 진짜 | 위장 숙련 0 | 위장 숙련 1 | 위장 숙련 2 |
| --- | --- | --- | --- | --- |
| "정지!" | 멈춰 돌아봄 (60% 대답 "왜 그래?") | 멈춤 30 / 못 들은 척 35 / 도주 35% | 60 / 30 / 10% | 95 / 5 / 0% |
| 암구호 | 0.5~1초 현재 답어. 교체 후 20초 안 30%: 이전 답어 → 1초 뒤 "아, 바뀌었지! ○○!" | 머뭇("어... 그게...") → 엉뚱한 단어 50 / 도주 25 / 바로 기습 25% | 0.5~1초 **이전 답어** (자신 있게, 정정 없음) | 0.5~1초 **현재 답어** — 암구호로는 구분 불가 |
| 실내 확인 문답 | 0.35~0.65초 정답 | 머뭇 → 추측(10% 정답) | 머뭇 → 추측 | 머뭇 → 추측 |
| 소속 대! | 0.5~1초 자기 부대(패치 일치) | 머뭇 → 어색한 없는 부대 | 그럴듯한 없는 부대 | 진짜 부대명 (50% 패치와 다른 부대) |
| 총 내려! | "아군이라니까, 진정해!" + 7초 총구 내림 | 거부 60 / 기습 40% | 따르는 척 9초 — 그동안 시선을 70° 넘게 돌리면 기습 기회(필요 시간 ×0.8) | 같음 |
| 손 들어! | 즉시 빈손 4초 | 도주 40 / 거부 60% | "...알았어요" 1.1~1.8초 뒤 듦 | 들지만 한 손이 0.7~1.2초 늦음 |
| 신분증 | 0.6~1초 신분증을 꺼내 보여 줌 | 머뭇 → "잃어버렸어요" | 머뭇 → "잃어버렸어요" | 위조 신분증 (겉보기 같음) |
| 대피하세요 | 대피로로 감 | 가는 척 2~3.6초 → 멈춤 50 / 되돌아옴 50% | 같음 | 같음 |
| 30초 안 4번째 질문부터 | 짜증("몇 번을 말해!") + 대답 1.2~1.8초 늦음 | — | — | (아군형) 같게 흉내 |

- 막혔을 때(머뭇·거부·분실): 숙련 0 → 35% 즉시 정체 드러냄(`'questioned'`, 예고 동작 0.5~0.8초 유지). 숙련 1~2 → '들킨 것 같음'(실내 추측·신분증 분실 뒤, 질문 3번째부터):
  55% 기습 가속(붙어 있으면 3~6초 안에 기습, 기회 필요 시간 ×0.5, 12초) / 45% 도주(24~40m, 가능하면 시야 밖) → 8~15초 숨었다가(보이는 동안은 안 셈) 50% 습격 요청, 아니면 다른 위치에서 재접근.
- 질문 한 번마다 '오래 붙어 있음' 기습까지 남은 시간 −2.5초(단 최소 2.5초는 남김) — 묻는 행위가 기습을 부를 수 있다.
- 도주 중·숨은 위장 적은 질문에 대답하지 않는다. 못 들은 척 걷던 위장 적은 질문을 받고서야 "...저요?" 하고 멈춘다.
- 실패로 치는 대답(`fail` → `dialogueFailed`, 점수 '근거 있는 판단'): 엉뚱한 단어·유출 답어·추측(맞혀도 머뭇거렸으므로)·없는 부대·패치와 다른 부대·거부·도주·기습·늦은 손·한 손 늦음·신분증 분실·가짜 대피(멈추거나 되돌아올 때).

## 다음 단계 연결 지점

### 2단계 — 완료
- 아군·민간인 추가는 위 구조(`NPCBase` 상속 → `NPCManager.spawnXxx` → `director.registerFactory` / `registerPopulation`)를 그대로 따랐다.
  새 인물 종류도 같은 패턴으로 추가하면 된다. 페널티는 `PenaltySystem` 이 `NPC_DAMAGED/KILLED` 의 `trueFaction` 으로 판정한다.

### 3단계 — 완료
- 위장 적은 새 NPC 종류가 아니라 `EnemySoldier` + 위장 프로필(`opts.disguise`) + `DisguiseController` 로 만들었다. 생성은 `NPCManager.spawnDisguised` → 생성기 `'disguised'` → `DisguisePopulation`.
- 겉보기 판정은 `npc.apparentFaction` / `npcs.byApparent(f)` / `npc.looksHostile`, 진짜 판정(점수·페널티·적 AI)은 `trueFaction` / `byFaction` / `isHostileTo` 그대로.
  적 AI 는 위장 적을 처음부터 같은 편으로 알고(공격 안 함), 아군·민간인 AI 는 겉보기만 본다(드러내기 전엔 속음, 드러낸 뒤 `apparentFaction = 'enemy'` 가 되면 바로 적으로 인식).
- 새 단서는 ① `HumanoidRig` 파츠/자세 → ② `Outfits` 필드·`describeEquipment` → ③ `Clues.js` `GEAR_CLUES`(위장 프로필에서 고를 수 있게) + `gearFacts`(관찰 메모 문구) 순서로 추가한다.
  새 행동 단서는 `BEHAVIOR` 에 키를 만들고, 진짜·가짜 양쪽에서 같은 조건으로 `noteBehavior(key)` 를 부르면 관찰 모드가 자동으로 읽는다.

### 4단계 — 완료
- 대화는 `DialogueSystem`(흐름) + `Responses`(규칙) + `DialogueLines`(문장) + `CountersignSystem`(그날의 약속)로 나눴다. 새 질문은
  ① `Responses.QUESTIONS` 에 항목 → ② `respond()` 의 진짜/위장 분기에 대본 → ③ `DialogueLines.DLINES` 에 대사 → ④ 필요하면 NPC 행동 메서드 + `Clues.BEHAVIOR` 기록 순서로 추가한다.
- 판정을 화면에 띄우지 않는 원칙: 대답 결과는 `DIALOGUE_ANSWER` 이벤트·`npc.dialogueFailed`·통계에만. 관찰 메모에는 '머뭇거림·거부·도주' 같은 행동만 남는다.

### 5단계 — 다듬기 (연결 지점)
- **난이도 곡선**: `CONFIG.threat`(적 수·명중률·반응·우회·웨이브·간격·유형) + `CONFIG.disguise`(위장 비율·상한·장비 단서 수·기습 조건·정찰) + `CONFIG.dialogue`
  (숙련도별 반응 확률, 질문 압박, 도주·기습 가속, 실내 기준수 추측 확률)를 함께 조절. 위장 숙련도 분포는 `disguise.gearClues`(장비 단서 수 → 숙련도)로 정해진다.
  암구호 교체 주기는 지금 위협 단계(`threat.secondsPerLevel`)에 묶여 있다 — 따로 두려면 `CountersignSystem` 에 타이머를 추가.
- **결과 화면 개편**: `Game._finishRun` 이 모으는 결과 객체 `r`(ScoreSystem.result + 정확도 + PenaltySystem.stats + 관찰 + 문답 통계 `dialogue*`)를 `Menus.showResult` 가 행 목록으로 그린다.
  판단 통계는 `NPC_DAMAGED/KILLED`(`timeSinceFirstSeen`, `apparentFaction`), `FRIENDLY_FIRE`, `DISGUISE_*`, `OBSERVE_FACT`, `DIALOGUE_*` 이벤트를 구독해 더 만들 수 있다.
- **연출·사운드**: 전부 `audio/AudioSystem.js` 합성. 대화는 TTS(설정) 외엔 효과음이 없다 — 플레이어 외침·무전 교체음 등을 추가할 자리는 `DialogueSystem._sayPlayer`, `CountersignSystem.update`.
- **최적화**: NPC 1명 = 드로우콜 2(몸·표식) + 신분증을 보일 때 1. 업데이트 비용은 디버그 오버레이 `ms` 와 위 성능 측정 방법 참고. 실기기 FPS 측정이 남아 있다.

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

### 3단계 설계 결정

34. **위장 적 = `EnemySoldier` + `DisguiseController`**: 새 인물 클래스를 만들지 않고 적 병사에 위장 프로필과 컨트롤러를 붙였다. `trueFaction` 이 생성 순간부터 `enemy` 라
    점수·페널티·적 AI 판정은 손대지 않았고, 정체를 드러내면 1단계 적 상태 머신(engage, 창가면 post)으로 그대로 넘어간다. 아군·민간인 AI 는 겉보기(`byApparent`)만 본다.
35. **출현 = 가짜 크레딧**: 2단계 아군·민간인 크레딧의 일부(위협 2단계 10% → 최고 30% / 25%)를 가짜 크레딧으로 돌린다. 그래서 겉보기 출현 비율(적 65 / 아군 15 / 민간인 20)은 그대로이고
    위장 적은 "아군·민간인처럼 보이는 사람 중 일부"다. 위장 적은 적 상한(4~14)·적 리듬 계산(`activeHostiles`)에서 빠지고 따로 상한 2~3을 둔다(1순위 재미인 적 사격량을 줄이지 않게).
    가짜 크레딧은 1.5 까지만 쌓아 한꺼번에 몰려나오지 않게 했다. 첫 1분(위협 1단계)엔 위장 적·오판 유도 행동 모두 없다.
36. **장비 단서 수·숙련도**: 장비 단서 수는 위협 단계로 보간한 범위(2~3 → 0~1)에서 뽑고, 숙련도는 그 수로 정한다(2개 이상 0, 1개 1, 0개 2). 행동 성향은 2~3개(숙련도 2 는 하나 적게).
    장비 단서는 겉보기별 후보에서 중복 없이 고르고, 가짜 아군 패치는 '없음'(55%)·'다른 모양' 중 하나, 정찰형 가짜 민간인은 장비 단서가 있으면 절반 확률로 그중 하나가 무전기다.
37. **진짜의 기준은 절대 깨지 않는다**: 진짜 아군은 항상 아군 장비 세트 + 파란 방패 패치 + 정상 완장, 진짜 민간인은 항상 비무장·민간 신발·맨손. 그래서 장비 단서 하나 = 확정 증거.
    반대로 행동은 진짜도 같은 코드(`Behaviors.js`)·같은 기준으로 기록되고, 오판 유도용 진짜 행동(낙오병·동행·얼어붙음·도움 요청)을 위장 적과 비슷한 빈도로 넣었다
    (아군 분대 등장 중 30→50%, 플레이어 곁 재집결 시 20% 동행, 민간인 등장 중 12→25%). 그래서 '혼자 다가오는 파란 표식'·'다가오는 사복'만으로는 확신할 수 없다.
38. **기습 조건**: 플레이어와 서로 보이고 10m 안일 때만. ① 기회 — 등을 보임(시선에서 110° 이상), 재장전 중, 7m 안에서 관찰 모드 — 가 0.35~0.8초 이어지면, 또는
    ② 가까이 붙어 있은 지 13~20초(최고 위협 7~12초, 동행형 22~34 → 12~20초)가 지나면. 동행형은 원래 등 뒤에 있으므로 '등을 보임'은 기회에서 뺐다(곧바로 터지지 않게).
    관찰 모드를 기회로 삼는 데는 숙련도만큼 더 오래 기다린다(×(1 + 0.6·skill)) — 관찰 자체가 위험하되 즉사 함정은 아니게. 정찰형은 습격을 부르기 전엔 6m 안으로 다가올 때만 기습.
    가짜 민간인은 10m 안에서 오래 겨눠지면(2.2~3.4초 × (1 + 0.3·skill)) 먼저 터진다('cornered').
39. **예고 동작은 반드시 보이고 들린다**: 0.5~0.8초(먼저 맞았으면 0.35초) 동안 가짜 아군은 왼손으로 완장을 뜯고(조각이 날림 + 테이프 뜯는 소리), 가짜 민간인은 오른손을 등 뒤 옷 속에 넣어 총을 꺼낸다.
    시작과 동시에 3D 장전음 "철컥" + (30m 안이면) 짧은 긴장음, 화면 밖 18m 안이면 HUD 방향 경고. 겉모습은 동작의 절반(먼저 맞았으면 80%) 시점에 바뀐다:
    가짜 아군은 같은 장비에 빨간 완장, 가짜 민간인은 사복에 굽은 탄창 소총 + 빨간 완장. 드러낸 뒤 5초간 명중률 ×1.5, 등장 유예 없음(근거리 기습이라 위협적이어야 함).
40. **'사전 식별' 판정**: 정체를 다 드러내기 전에 죽였으면 식별(+200). 단 위장 적이 스스로 드러내기 시작한 뒤(기습·습격 요청·궁지)의 사살은 반응 사격이라 식별로 치지 않고,
    플레이어가 먼저 쏴서 드러내는 중이면 식별로 인정한다(`identifiedKill`). '근거 있는 판단'(+100)은 그 인물에게서 관찰로 이상 사실을 하나 이상 찾은 경우 — 맨눈 판단도 +200 은 받는다.
    보너스는 다른 보너스처럼 콤보 배율 안에 들어간다. 오인 사격(진짜를 쏨)은 2단계 페널티 그대로.
41. **관찰 모드 수치**: 시야 2배(FOV 를 tan 비율로 줄임 — 정조준과 같은 방식), 이동 ×0.6·감도 ×0.5·달리기 불가, 총을 내려 사격·정조준 불가, Q 를 떼면 0.3초 뒤 사격 가능.
    주변 소리 ×0.4 + 약한 심장 소리. 사실은 남은 것 중 무작위 순서(장비부터 다 보이면 너무 쉬워서). 거리 8m 까지 0.5초, 그 뒤 12m 마다 0.5초씩 느려짐.
    장비 세부는 38m 까지, 어두운 실내(어둠 0.6 이상)는 손전등(F)이 비춰야 보인다 — 빛나는 표식 사실만 예외(가까우면 보임).
42. **노란 윤곽은 림 라이트**: NPC 셰이더 패치에 `uHighlight` 유니폼을 더해 가장자리를 노랗게 빛나게 했다(추가 드로우콜·외곽선 패스 없음). 8초, 끝나기 1.5초 전부터 깜박임.
    이상 사실이 하나라도 있는 대상에게만 켜진다 — 윤곽은 '의심할 사실이 있다'는 뜻이지 판정이 아니다(진짜 낙오병도 '혼자 움직임' 때문에 켜질 수 있다).
43. **관찰 메모는 사실만**: 대상 라벨도 겉모습으로만("파란 표식 군인", "사복 차림 노인"). 이상 사실 앞에 `?` 표시만 붙이고, '진짜/가짜/적' 같은 말은 어디에도 쓰지 않는다.
    진짜 인물의 장비는 중립 사실("직선 탄창 소총", "어깨 부대 패치: 파란 방패", "맨손")로 보여 줘서, 플레이어가 기준과 비교해 스스로 결론 내리게 했다.
44. **동행 위치**: 진짜·가짜 모두 `escortTarget` — 플레이어 뒤 4.2m, 옆 ±2.2m. 지금 자리가 3.5~7.5m 이고 정면 ±35° 밖이면 움직이지 않는다(플레이어가 돌아설 때마다 조준선을 가로질러 뛰지 않게).
    동행 중 조준선을 막으면 반대쪽 옆으로 비킨다(동행은 유지). 진짜 동행 아군은 실제로 적을 쏘고 35~70초 뒤 "분대로 복귀한다!" 하고 떠난다.
45. **정찰형 감시 자리**: 자기 건물 창가 우선, 그다음 플레이어 12~38m(20m 선호)의 창가·실외 지점. 창가는 바깥이 플레이어 쪽을 향해야 하고, 창 노드가 벽에서 1m 안쪽이라
    창 쪽으로 0.55m 다가선 위치에서 시야를 검사(후보 40개까지)·실제로도 그 자리에서 내다본다. 보이는 자리가 없으면 플레이어 14~22m 로 다가가 다시 찾는다.
    시야가 확보된 채 16~24초(최고 위협 9~15초) 지켜보면 무전(왼손을 귀로 + 무전 잡음) → 습격 시작(이미 습격 중이면 2명 추가) → 4~7초 뒤 플레이어가 보이고 45m 안이면 정체를 드러냄.
46. **습격 혼란 침투**: 디렉터가 습격 구간을 시작할 때(정찰형이 부른 습격 제외) 35→60% 확률로 기습형 위장 적 1명이 14~28m 에서 등장하고, 섞여 있는 시간을 0.2배로 줄여 곧장 다가온다.
47. **총소리도 장비를 따른다**: NPC 총성 음색은 소총 형태로 정한다(굽은 탄창 = 적 음색, 직선 = 아군 음색). 굽은 탄창 소총을 든 가짜 아군은 허공에 쏴도 적 총소리가 난다(장비 단서와 일치하는 귀 단서).
48. **가짜 아군의 교전 흉내**: 성향에 따라 안 쏘거나(noFire), 허공에 쏘거나(fireAir), 적 옆 2~3m·위로 크게 빗나가게 쏜다(전투 성향이 없는 위장 적 — 중립 사실 '적을 향해 사격함'으로 기록되는 그럴듯한 흉내).
    모두 피해 판정 없는 사격(총구 화염·소리·예광탄·피탄만)이다.
49. **첫 안내는 판마다 한 번**: 위장 적이 처음 등장하면 0.6초 뒤 "위장 적 주의" 배너, 관찰 모드를 처음 쓰면 짧은 안내 문구(6초). 시작 화면 브리핑은 항상 보인다(4줄).
50. **도움 요청 민간인의 거리**: 플레이어 3.2~5.5m(등 뒤·옆 선호)에서 멈추고, 2.2m 안으로 붙으면 다른 자리로. 조준선 위에 오래 서 있거나 몸을 비비지 않게.
51. **대피 퇴장(2단계 잔여 수정)**: 대피 지점에 닿은 민간인은 플레이어 화면에 안 보일 때 사라진다(최대 15초 대기 후엔 그냥 퇴장).

### 4단계 설계 결정

52. **대화 = 실시간 '대본'**: 질문하면 대답이 몇 초 뒤 무슨 말·행동으로 나올지 대본을 만들어 게임 시간으로 실행한다. 메뉴는 대답을 기다리는 동안 '응답 대기'로 막고,
    끝난 뒤부터 4초 타이머를 다시 센다(대답을 듣는 시간 때문에 메뉴가 닫히지 않게). 대화가 시간 초과·E 로 닫혀도 이미 시작한 대답은 마저 하고, 사격·정체 드러냄·죽음이면 끊는다.
53. **거리 판정 '실내 10m'**: 플레이어나 상대 중 한쪽이라도 건물 안이면 10m(실내는 좁고 문 너머 소리가 막힘). 시야는 가슴 또는 머리가 보이면 인정(낮은 엄폐물 뒤 인물).
54. **대화 상대는 '겨눔' 반응 제외**: 말을 거는 동안엔 상대에게 총구가 향하는 게 당연하므로 2단계 '겨누면 손 들기'를 끄고 "손 들어!"로 따로 시험한다(진짜·가짜 공정하게).
    위장 민간인의 궁지 압박(겨눠지면 먼저 기습)은 계속 쌓이되 숙련 1~2 는 절반 — 대화 자체가 위험하지만 숙련된 위장은 태연한 척한다.
55. **암구호 교체 = 위협 단계 상승 시점**: '약 1분마다'를 위협 단계(1분)와 맞춰 이벤트 하나로 묶었다. 실내 기준수도 같은 순간 따로 뽑는다(직전 값과 다르게). 무전은 지휘부 채널이라 무전 두절과 무관.
    판 시작 시 '어제 암구호'를 이전 암구호로 두어 숙련 1 위장 적의 '유출된 답어'가 처음부터 존재한다(카드엔 교체 직후 20초만 이전 것을 보여줌).
56. **실내 확인 문답은 '같은 건물 안'에서만**: 둘 다 같은 진입 가능 건물의 실내일 때만 메뉴 2번이 열린다. 플레이어가 외치는 수는 게임이 정해 계산 부담은 플레이어에게(자동 판정 없음).
    위장 적은 숙련도와 무관하게 항상 머뭇거린다 — 가장 확실한 수단이지만 실내로 끌어들이는 수고가 든다.
57. **아군 부대 3개와 패치 모양**: 3단계의 '파란 방패' 기준을 부대별 파란 패치(방패·별·삼각형)로 넓혔다. 가짜 패치(올리브색 네모·누런 동그라미)는 색부터 달라 기존 단서가 유지된다.
    숙련 2 위장 적은 진짜 부대명을 대지만 절반은 자기 패치와 다른 부대 — 브리핑의 부대↔패치를 기억하는 플레이어만 잡아낼 수 있는 미묘한 단서.
58. **진짜도 헷갈리게**: 교체 직후 20초 안 진짜 아군 30%가 이전 답어를 말했다가 정정(위장 숙련 1 은 정정하지 않음) — '첫 대답만 듣고 쏘기'를 막는다.
    진짜 아군도 30초 안에 4번째 질문부터 짜증을 내며 대답이 늦어진다(감점 없음). 숙련 2 위장 아군도 이 짜증을 흉내 낸다.
59. **신분증은 덜 확실한 수단**: 숙련 2 의 위조 신분증은 겉보기가 진짜와 같다(같은 소품). 숙련 0~1 만 "잃어버렸어요".
60. **"손 들어!"와 숨긴 무기**: 손을 들면(이유와 무관하게) 사복의 옷이 올라가 허리띠가 보이고, 허리춤에 숨긴 무기가 있으면 권총 손잡이·권총집이 드러난다(3D + 관찰 사실 '손을 들자…', 각도 무관).
    3단계 장비 단서와 4단계 명령이 맞물리게 한 것.
61. **도주 → 숨기 → 재등장**: 도주한 위장 적은 24~40m(가능하면 시야 밖)로 달아나 8~15초(플레이어에게 보이는 동안은 시간이 안 감) 숨었다가 50% 습격 요청(정찰형과 같은 무전 동작), 아니면 다른 위치에서 재접근.
62. **'들킨 것 같음'의 기습 가속은 즉시가 아니라 3~6초 뒤**: 틀린 대답을 듣고 판단할 시간이 남게. 질문 압박도 남은 시간을 2.5초 아래로는 줄이지 않는다.
    숙련 0 의 즉시 정체 드러냄·바로 기습도 3단계 예고 동작(0.5~0.8초 + 장전음)은 그대로.
63. **'사전 식별' 확장**: 문답에 막혀 드러내던 중(`'questioned'`) 사살도 플레이어의 판단으로 인정(+200). 문답 실패(`dialogueFailed`)는 관찰 이상 단서처럼 '근거 있는 판단'(+100).
    진짜를 확인한 것 자체엔 점수가 없고 통계만(실수하지 않은 것이 보상).
64. **화자 라벨은 겉모습뿐**: 대화·외침 자막은 `[파란 표식 병사]`/`[민간인]`(진짜·가짜 공통), 플레이어는 `[나]`, 암구호 교체는 `[작전 무전]`. 분대 무전 `[아군 무전 · 알파]` 는 진짜 분대만 쓰므로 유지.
65. **대화와 관찰은 독립**: 관찰 모드(총 내림)와 대화(총 듦)를 동시에 할 수 있다 — 서로 막지 않고, 대화 상대에게 관찰도 그대로 된다.
66. **암구호 카드 숨김 = 난이도 옵션**: 카드를 끄면 작전 무전으로 들은 단어를 기억해야 한다. 질문할 때 문어는 자동으로 외치므로 기억할 건 답어와 기준수.

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

### 3단계 기대 점수 (위장 적)

- 위장 적 사전 식별 사살 = 100 + 200(+ 근거 100) + 즉응·헤드샷 → 300~500, 콤보 배율까지. 드러낸 뒤 사살은 기본 100(+헤드샷)뿐이고 그 전에 근거리 고명중 기습을 받는다.
- **장비 단서를 보고 쏘기**: 장비 단서는 진짜에겐 없으므로 위험 0 — 확인에 드는 시간(가까이 0.5초씩, 무작위 순서)과 그동안 총을 내리는 위험만 대가.
- **행동만 보고 쏘기**: 오판 유도용 진짜 행동이 위장 적과 비슷한 빈도라(측정: 판마다 진짜 행동 수 = 위장 적 수의 0.3~1.1배) '혼자 다가오는 파란 표식'·'다가오는 사복'의
  대략 1/4~1/2 은 진짜다. 진짜 비율 1/3 이면 `2/3 × (+300) + 1/3 × (−200×3 − 1000)` ≈ −330 → 행동 단서만으로 쏘는 건 손해. 행동은 '관찰하거나 거리를 둘 이유'로 쓰라는 설계.
- **완벽 위장(장비 0개)**: 후반에만 나오며 행동으로만 의심 가능 — 등을 보이지 않고·재장전을 엄폐 뒤에서 하는 식으로 기습 기회를 안 주고, 드러내는 순간(예고 0.5~0.8초)에 반응하는 것이 3단계의 해법(4단계 문답이 확인 수단).
- 실측: 표식만 믿고 위장을 무시하는 봇은 300초 판에서 기습 0~4회, 위장 적에게 받은 피해 0~44(그 외 8~112). 후반부터 시작한 긴 판에선 기습 10~15회, 위장 적 피해 84~211(그 외 68~272)로
  다른 적 전체와 비슷해진다 — 후반엔 위장을 무시할 수 없게.

### 4단계 기대 점수 (문답)

- 문답은 시간을 쓰는 만큼 확실해진다: 실외 암구호 1회 ≈ 1.2~2초(질문 + 대답), 실내 문답도 비슷하지만 같은 건물 안이어야 한다. 그동안 다른 적의 즉응 사살(2초)·콤보(5초) 기회를 놓친다.
- 위장 적을 문답으로 가려 쏘면 300~500(+ 콤보) — 행동만 보고 쏘는 기대값(진짜 비율 1/3 이면 약 −330)보다 확실히 낫지만, 묻는 동안 기습을 부를 수 있다
  (숙련 0 은 35% 즉시 드러냄, 1~2 는 들킨 것 같으면 3~6초 안에 기습 또는 도주).
- 숙련 2(완벽 위장)는 실외에서 암구호로 못 가리고(소속을 물어 패치와 비교하면 절반은 잡힘), 실내 문답으론 항상 머뭇거림 → 후반 완벽 위장 대응 수단이 생겼다.
- 실측(헤드리스, 강제 생성): 실내 문답 20회 — 진짜 아군 5/5 정답·즉답, 위장(숙련 0~2) 15/15 머뭇거린 뒤 오답(추측 정답 0회). 소크 봇(6분·5분): 말 걸기 10회·질문 28회씩, 위장 적을 문답으로 1~2명 찾아 그중 1명을 사전 식별 + 근거 있는 판단으로 사살.

## 알려진 한계 / 개선 후보

- 실제 브라우저 FPS 는 이 환경(헤드리스)에서 측정하지 못했다. 드로우콜·CPU 시간 기준으로만 확인 — 5단계에서 실기기 프로파일링 필요.
- NPC 끼리의 충돌 회피는 엄폐 지점 예약 + 진행 방향 양보(최대 1.5초)뿐이다. 좁은 실내에선 잠깐 겹칠 수 있다.
- NPC 탄은 겨냥한 대상만 판정한다(사이에 있는 다른 NPC 를 막지 않음). 같은 편·민간인은 NPC 탄에 다치지 않는다(의도).
- 대피 지점에 닿은 민간인은 화면 밖이 되면 사라지지만, 15초 넘게 계속 보고 있으면 눈앞에서 사라진다.
- 돌발 조우는 플레이어 3.5~8m 안에 숨은 출현 지점이 있어야 해서, 넓은 광장 한가운데 오래 서 있으면 잘 안 나온다.
- 아군 분대 AI 는 단순하다(전진·소탕·재집결·교대). 엄폐 지점이 없는 곳에선 노드 위에 서서 싸운다.
- 손전등은 그림자가 없어 벽 너머 면도 비출 수 있다(시야에선 가려짐).
- 진입 불가 건물의 창문은 텍스처일 뿐이라 들여다볼 수 없다(창문 사수·실내전은 진입 가능 건물에서만).
- 헤드리스 봇 기준 밸런스는 대략적이다. 사람 플레이 테스트로 `CONFIG.threat`·`CONFIG.npc.accuracy` 조정 권장.
- (3단계) 위장 밸런스도 봇 기준이다. 후반 기습 피해가 크게 느껴지면 `CONFIG.disguise.ambush`(`patience`·`accuracyMul`·`opportunityDelay`)와 `allyChance/civilianChance`·`maxActive` 를 조정.
- (3단계) 행동 기록은 플레이어가 그 순간을 보지 않았어도 남는다(관찰 = '그 인물이 한 일을 알아챔'으로 단순화). 예: 다른 곳에서 무전을 무시한 일도 나중에 메모될 수 있다.
- (3단계) 동행·도움 요청처럼 플레이어 3~5m 에 붙는 진짜 인물이 있을 때 급히 몸을 돌려 쏘면 오인 사격이 난다(의도된 긴장 요소지만, 봇 측정에서 남은 오인 사격의 대부분).
- (3단계) 정찰형의 감시 자리는 시야 검사 40회 안에서 고르므로 건물이 빽빽한 곳에선 못 찾고 다가가는 경우가 있다. 1단계 창문 사수는 여전히 창 노드(벽에서 약 1m 안쪽)에서 쏘아 창 각도 밖은 못 본다(정찰형만 창 쪽으로 0.55m 다가선다).
- (3단계) 위장 적의 '쏘지 않음'·'허공 사격'은 피해 판정이 없는 흉내 사격이라, 근처 적의 제압 반응(`onSuppressed`)을 일으키지 않는다.
- (4단계) 문답 밸런스(숙련도별 반응 확률·질문 압박·도주)는 강제 생성 테스트와 단순한 봇으로만 확인했다. 사람 플레이로 `CONFIG.dialogue` 조정 권장.
- (4단계) 대화 상대는 한 명뿐이다(분대 전체에 묻기·여러 사람 동시 대화 없음). 같은 자리에 여러 명이 겹쳐 있으면 화면 중앙에 가장 가까운 한 명이 대상.
- (4단계) 플레이어 외침에는 효과음·음성이 없고(TTS 를 켜면 읽음), 대사는 자막 중심이다. 대화 메뉴는 화면 맨 아래라 1인칭 총기와 일부 겹친다.
- (4단계) 진짜 민간인이 대피로로 가는 중에 계속 겨누면 2단계 규칙대로 손을 들고 멈춘다(위장 민간인도 같음) — 대피를 시켰으면 총구를 돌려야 한다.
- (4단계) 도주한 위장 적이 숨는 동안 플레이어가 계속 보고 있으면 숨는 시간이 줄지 않아 오래 웅크려 있을 수 있다.
- (4단계) 실내 판정은 진입 가능 건물만 — 진입 불가 건물·폐허 안은 실외로 친다(실내 문답은 진입 가능 건물에서만).
