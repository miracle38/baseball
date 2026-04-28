# Changelog

이 프로젝트의 모든 주요 변경사항을 이 파일에 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따르며,
[유의적 버전(SemVer)](https://semver.org/lang/ko/)을 사용합니다.

- **MAJOR**: 기존 사용자 데이터/사용 흐름과 호환되지 않는 변경
- **MINOR**: 하위 호환되는 기능 추가
- **PATCH**: 하위 호환되는 버그 수정

자동 데이터 업데이트(스크레이퍼)는 별도로 기록하지 않으며, 이 문서에는 코드/기능 변경만 누적합니다.

## [Unreleased]

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

[Unreleased]: https://github.com/miracle38/baseball/compare/v1.0.6...HEAD
[1.0.6]: https://github.com/miracle38/baseball/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/miracle38/baseball/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/miracle38/baseball/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/miracle38/baseball/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/miracle38/baseball/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/miracle38/baseball/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/miracle38/baseball/releases/tag/v1.0.0
