# Changelog

이 프로젝트의 모든 주요 변경사항을 이 파일에 기록합니다.

형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/)을 따르며,
[유의적 버전(SemVer)](https://semver.org/lang/ko/)을 사용합니다.

- **MAJOR**: 기존 사용자 데이터/사용 흐름과 호환되지 않는 변경
- **MINOR**: 하위 호환되는 기능 추가
- **PATCH**: 하위 호환되는 버그 수정

자동 데이터 업데이트(스크레이퍼)는 별도로 기록하지 않으며, 이 문서에는 코드/기능 변경만 누적합니다.

## [Unreleased]

## [1.0.0] - 2026-04-28

버전 관리를 시작하는 기준점. 이후 모든 변경은 이 문서에 누적 기록한다.

### 주요 기능
- Windup Baseball Club 시즌별/선수별 통계 시각화
- 선수 프로필 모달 — 다년도 타격/투구 기록 통합 (확장형 리그별 분해 + 통산)
- 경기 박스스코어 모달
- KSBSA / GameOne 자동 데이터 수집 (GitHub Actions 일일 업데이트)
- 잔여 경기 일정 (시간/구장 정보 포함)
- 팀 순위표 (시즌별)

[Unreleased]: https://github.com/miracle38/baseball/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/miracle38/baseball/releases/tag/v1.0.0
