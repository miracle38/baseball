# Changelog

이 프로젝트의 모든 주요 변경사항을 이 파일에 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따르며,
[유의적 버전(SemVer)](https://semver.org/lang/ko/)을 사용합니다.

- **MAJOR**: 기존 사용자 데이터/사용 흐름과 호환되지 않는 변경
- **MINOR**: 하위 호환되는 기능 추가
- **PATCH**: 하위 호환되는 버그 수정

자동 데이터 업데이트(스크레이퍼)는 별도로 기록하지 않으며, 이 문서에는 코드/기능 변경만 누적합니다.

## [Unreleased]

## [1.3.3] - 2026-06-30

### Changed
- 하단 푸터 UI를 다른 프로젝트와 동일한 **미니멀 2줄 스타일**로 통일 — 빨강 강조·그라데이션·볼드 제거, 회색 12px, `앱명 · v버전` / `© 2026 KHS (miracle38)`. 푸터의 데이터 출처 표기는 제거

## [1.3.2] - 2026-06-30

### Fixed
- **홈런 뱃지 복구** — 경기 목록 재구성(캘린더 스크랩) 시 `boxScore` 상세가 누락돼 2026 등 현재 시즌 홈런 경기에 뱃지가 안 뜨던 문제. boxScore 상세 재수집(`scrape-ksbsa-boxscore`) + `scrape-all`이 boxScore를 보존하도록 수정(`gameToJs` 직렬화 + 기존값 carry)

## [1.3.1] - 2026-06-30

### Changed
- 팀 순위표 표시 컬럼에서 **선공·후공 제외** (데이터는 유지) — 안타·실책·사사구·최근 10경기·연속까지 14컬럼 표시

## [1.3.0] - 2026-06-30

### Added
- 팀 순위표를 소스(KSBSA 기본기록)와 동일한 **16컬럼**으로 확장 — 기존 9개(순위·팀명·승점·경기·승·패·무·득점·실점)에 **안타·실책·사사구·최근 10경기·연속·선공·후공** 추가
- `rankings`/`seasonSummary`에 `H·E·BBHBP·recent10·streak·away·home` 필드 저장, 순위 스크래퍼(`scrape-rankings-ksbsa-dbsa.js`)가 16컬럼 전체 파싱
- gameone 등 해당 필드가 없는 엔트리는 `-`로 표시(그레이스풀 폴백)

## [1.2.0] - 2026-06-29

### Fixed
- **경기 기록이 팀순위와 불일치하던 문제** — `getMain`(최근 경기만)·`getGameRecord`(박스스코어 등록분만)가 놓치던 경기(예: 박스스코어 미등록 3월 경기)를 **월별 일정 캘린더(`getGameSchedule`)** 에서 점수·구장·결과까지 수집하도록 보강. 2026 세종 7승2패(9경기)·동구 5승2패(7경기)로 공식 순위표와 일치
- **완료 경기 보존** — 재스크랩이 특정 경기를 일시적으로 못 가져와도 기존 완료 경기를 삭제하지 않도록 병합(`extractExistingGames`)
- 캘린더 스크랩의 날짜별 예외/네비게이션 race를 개별 처리해 한 경기 실패가 전체 수집을 막지 않도록 견고화

## [1.1.2] - 2026-06-29

### Fixed
- 예정 경기 구장 보강이 `ksbsa`(세종) 소스만 처리하고 `donggu.dbsa.kr`(동구) 예정 경기는 건너뛰던 문제 — 소스별 `base`/`teamSeq` 매핑으로 일반화해 동일 플랫폼(ksbsa·dbsa) 경기를 모두 채우도록 수정

## [1.1.1] - 2026-06-29

### Fixed
- 예정 경기 구장(location) 정보가 제때 반영되지 않던 문제 — 당일 빠른 갱신(토 30분 주기)이 `scrape-all` 재스크랩 시 예정 경기 구장을 빈값으로 덮어쓰던 것을, 날짜+상대팀 기준 기존 구장 보존 로직으로 차단
- 예정 경기 구장 보강(`fill-ksbsa-scheduled-locations`)을 빠른 갱신 워크플로우(`update-live.yml`)에도 추가 — 기존엔 하루 2회 전체 갱신에만 있어 구장 발표 후 반영이 느렸음
- 푸터 버전 라벨이 `1.0.13`에 고정돼 실제 버전과 어긋나던 표기 수정

## [1.1.0] - 2026-05-26

### Added
- 역대 기록 표에 순위 컬럼 — `entry.seasonSummary.rank` 기반, 상위 3위에 🏆/🥈/🥉 아이콘 표시
- 메인 역대 기록 표에 # 넘버링 + 모든 컬럼 헤더 클릭 정렬 (연도/리그/성적/승률/순위/경기/출처). 같은 컬럼 재클릭 시 방향 토글
- 시즌 펼침을 별도 패널 대신 클릭한 행 바로 아래에 인라인 렌더링
- 펼친 상세(타자/투수) 표에 # 넘버링 + 컬럼 헤더 클릭 정렬 — 시즌/탭 전환해도 정렬 상태 유지
- 펼친 상세 thead sticky — 데스크탑/모바일 모두 페이지 헤더 바로 아래에 고정되어 스크롤 시 컬럼 타이틀 유지
- 모바일에서 메인 역대 기록 표·펼친 상세 표 각각 독립적으로 가로 스크롤 지원

### Changed
- 시즌 행 옆의 ▶ 화살표 제거 — 클릭 액션을 인라인 펼침으로 명확히 보이게 변경
- `.history-container` `overflow:hidden` → `visible` (sticky 컨테이너 충돌 회피)
- `.history-table` 에 `min-width:0` — 전역 `table { min-width:1100px }` 오버라이드, 모바일에서 viewport 폭 준수

### Fixed
- 시즌 펼침 시 상세 영역이 표 전체 하단에 렌더링되어 사용자가 발견하지 못하던 문제

## [1.0.13] - 2026-04-29

### Added
- 화면 폭 1300px 미만에서 타자/투수 표의 부수 지표 컬럼을 자동 숨김 — 핵심 지표(타자 12개·투수 10개)만 남겨 가로 스크롤 없이 가독성 확보. 1300px 이상에서는 다시 모든 컬럼 표시
  - 타자 숨김: 등번호/2루타/3루타/도루/볼넷/사구/삼진/출루율/장타율
  - 투수 숨김: 등번호/세/홀드/피안타/피홈런/고4/사구/실점/자책/승률/타자/투구수

## [1.0.12] - 2026-04-29

### Fixed
- 타자 21개·투수 22개 컬럼이 컬럼당 약 50px로 너무 좁게 압축돼 가독성이 떨어지던 문제 — 표 min-width를 1500px / 1600px로 설정해 컬럼당 약 70px 이상 확보. 좁은 뷰포트에서는 wrapper 내부 가로 스크롤로 처리

## [1.0.11] - 2026-04-29

### Fixed
- 가로 스크롤 차단에 폴백 추가 — `overflow-x:clip` 미지원 브라우저용으로 `overflow-x:hidden` + `max-width:100%`

## [1.0.10] - 2026-04-29

### Fixed
- 페이지 레벨 가로 스크롤 제거 — html/body에 `overflow-x:clip`
- `.pp-table-wrap`에 `overflow-x:auto`로 선수 프로필 테이블이 좁은 뷰포트에서 자체 스크롤

## [1.0.9] - 2026-04-29

### Changed
- 타자 기록 컬럼 라벨을 한글화 — `2B / 3B / HR` → `2루타 / 3루타 / 홈런`

## [1.0.8] - 2026-04-28

### Changed
- 선수 비교 표 폭을 인원 수에 따라 유동적으로 조정 — 기존엔 항상 100% 폭이라 2명일 때 모바일에서 컬럼 간격이 너무 떨어져 보이던 문제 해결. 셀 min-width 명시(데스크톱 80px / 모바일 68px)

## [1.0.7] - 2026-04-28

### Changed
- 선수 비교 모달의 모바일 대응 — 모달 폭/패딩 조정, 표 셀 폰트 축소, 첫 컬럼(지표명) sticky z-index/그림자 강화, 레이더 차트 라벨/legend 폰트 축소

## [1.0.6] - 2026-04-28

### Changed
- 선수 비교 모달의 `시즌` 컬럼 — 고유 연도 기준으로 변경 (선수 프로필 모달과 동일). 같은 해에 두 리그를 뛴 경우 1시즌으로 카운트

## [1.0.5] - 2026-04-28

### Fixed
- 선수 비교 기능에서 `Cannot access 'compareSelection' before initialization` TDZ 에러로 표/그래프가 비어 보이던 문제 — 변수 선언을 `renderPlayers` 정의 전으로 이동

## [1.0.4] - 2026-04-28

### Added
- **선수 비교 기능** — 타자/투수 표에서 체크박스로 2~5명 선택하면 우측 하단 `📊 선수 비교` 버튼이 등장. 클릭 시 모달에서 다년도 통산 표(1위 강조) + 레이더 차트로 시각화
- 레이더 차트(Chart.js) — 비교 그룹 내 상대값(max=100%) 기준
  - 타자: 타율/OPS/홈런/타점/득점/도루/안타/볼넷
  - 투수: 승/삼진/세이브/홀드/이닝

## [1.0.3] - 2026-04-28

### Changed
- 타자기록 / 투수기록 표의 순위 컬럼 — 정렬 키 값이 같으면 동점 처리(공동 순위, standard competition ranking). 부동소수점은 epsilon 0.0001로 비교

## [1.0.2] - 2026-04-28

### Added
- 타자기록 / 투수기록 / 경기기록 표 첫 컬럼에 순위(`#`) 추가 — 현재 정렬 기준에 따라 자동 갱신 (예: ERA 정렬 → ERA 순위)

## [1.0.1] - 2026-04-28

### Added
- 타자기록 / 투수기록 / 경기기록 탭의 표 컬럼 헤더(thead)를 스크롤 시 상단 고정 — 표 영역 내부 스크롤 방식, 모바일 가로 스크롤도 그대로 동작

## [1.0.0] - 2026-04-28

버전 관리를 시작하는 기준점. 이후 모든 변경은 이 문서에 누적 기록한다.

### 주요 기능
- Windup Baseball Club 시즌별/선수별 통계 시각화
- 선수 프로필 모달 — 다년도 타격/투구 기록 통합 (확장형 리그별 분해 + 통산)
- 경기 박스스코어 모달
- KSBSA / GameOne 자동 데이터 수집 (GitHub Actions 일일 업데이트)
- 잔여 경기 일정 (시간/구장 정보 포함)
- 팀 순위표 (시즌별)

[Unreleased]: https://github.com/miracle38/baseball/compare/v1.0.13...HEAD
[1.0.13]: https://github.com/miracle38/baseball/compare/v1.0.12...v1.0.13
[1.0.12]: https://github.com/miracle38/baseball/compare/v1.0.11...v1.0.12
[1.0.11]: https://github.com/miracle38/baseball/compare/v1.0.10...v1.0.11
[1.0.10]: https://github.com/miracle38/baseball/compare/v1.0.9...v1.0.10
[1.0.9]: https://github.com/miracle38/baseball/compare/v1.0.8...v1.0.9
[1.0.8]: https://github.com/miracle38/baseball/compare/v1.0.7...v1.0.8
[1.0.7]: https://github.com/miracle38/baseball/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/miracle38/baseball/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/miracle38/baseball/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/miracle38/baseball/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/miracle38/baseball/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/miracle38/baseball/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/miracle38/baseball/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/miracle38/baseball/releases/tag/v1.0.0
