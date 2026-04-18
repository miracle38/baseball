/**
 * Phase 2: (lig_idx, season, group_code) → 기존 ALL_DATA id 매핑
 * 매핑 안 되는 조합 → Phase 4 신규 엔트리 대상
 */
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'tmp_entry_mapping.json');

// 수동 매핑 테이블
// key = `${lig_idx}_${season}_${group_code}`
// value = existing ALL_DATA entry id | null
// Existing IDs (from inventory):
// 2010_geumgang 2011_geumgang 2012_kukmin_chugye 2012_daejeon 2013_kukmin_chugye 2013_myeongpum
// 2014_kukmin_chugye 2014_myeongpum 2015_donggu_taebaek 2015_daejeon_geumgang 2016_daedeok 2016_daejeon_geumgang
// 2017_kukmin_nanum 2017_kukmin_eoul 2017_daejeon 2018_donggu 2018_daejeon 2019_daejeon 2019_sejong
// 2020_daejeon 2020_sejong 2021_daedeok 2021_sejong_1 2021_sejong_weekday 2021_sejong_2 2022_daedeok ...

// lig 코드:
//  45 = 대전 동구, 63 = 대덕구, 108 = 국민생활체육 대전, 113 = 대전협회, 199 = 대전 구, 432 = 대전명품, 495 = 세종

const MAPPING = {
  // 2010 — 45_2010_13 (동구 토요리그) : 기존 entry = 2010_geumgang (전체). 매핑
  '45_2010_13': '2010_geumgang',
  // 2011 — 113_2011_13 (협회 토요리그)
  '113_2011_13': '2011_geumgang',
  // 2012 — 113_2012_17 (협회 토요-금강) → 2012_daejeon (대전 토요리그)
  '113_2012_17': '2012_daejeon',
  // 2013 — 432_2013_13 (명품 토요3부) → 2013_myeongpum
  '432_2013_13': '2013_myeongpum',
  // 2014 — 432_2014_31 (명품 토요3부) → 2014_myeongpum
  '432_2014_31': '2014_myeongpum',
  // 2015 — 45_2015_39 (동구 태백기) → 2015_donggu_taebaek
  '45_2015_39': '2015_donggu_taebaek',
  // 2016 — 113_2016_41 (협회 토요금강3부) → 2016_daejeon_geumgang
  '113_2016_41': '2016_daejeon_geumgang',
  // 2016 — 63_2016_50 (대덕구 토요3부B조) → 2016_daedeok
  '63_2016_50': '2016_daedeok',
  // 2017 — 108_2017_61 (토요 나눔) → 2017_kukmin_nanum
  '108_2017_61': '2017_kukmin_nanum',
  // 2017 — 108_2017_62 (토요 어울림) → 2017_kukmin_eoul
  '108_2017_62': '2017_kukmin_eoul',
  // 2018 — 45_2018_51 (동구 토요) → 2018_donggu
  '45_2018_51': '2018_donggu',
  // 2018 — 113_2018_50 (협회 토요3부) → 2018_daejeon
  '113_2018_50': '2018_daejeon',
  // 2020 — 113_2020_58 (협회 토요3부) → 2020_daejeon
  '113_2020_58': '2020_daejeon',
  // 2021 — 495_2021_44 (세종 토요 4부) → 2021_sejong_1
  '495_2021_44': '2021_sejong_1',
  // 2021 — 495_2021_53 (평일 4부 후반기) → 2021_sejong_weekday (기존 entry 매핑)
  '495_2021_53': '2021_sejong_weekday',
  // 2021 — 63_2021_78 (대덕구 토요4부) → 2021_daedeok
  '63_2021_78': '2021_daedeok',
};

function main() {
  const windup = require(path.join(__dirname, '..', 'tmp_windup_all_leagues.json'));
  const inventory = require(path.join(__dirname, '..', 'tmp_all_data_inventory.json'));
  const existingIds = new Set(inventory.inventory.map(e => e.id));

  const combos = Object.keys(windup.data).sort();
  const mapped = {}, unmapped = [];
  combos.forEach(k => {
    if (MAPPING[k] !== undefined) {
      if (!existingIds.has(MAPPING[k])) {
        unmapped.push({ combo: k, reason: `Mapping target ${MAPPING[k]} doesn't exist in ALL_DATA` });
      } else {
        mapped[k] = MAPPING[k];
      }
    } else {
      unmapped.push({ combo: k, reason: 'no mapping', data: { B: windup.data[k].batters.length, P: windup.data[k].pitchers.length, groupName: windup.data[k].groupName } });
    }
  });

  console.log('=== Mapped combos → existing entry ===');
  Object.keys(mapped).sort().forEach(k => {
    const d = windup.data[k];
    console.log(`  ${k} (${d.groupName})  →  ${mapped[k]}  [B:${d.batters.length} P:${d.pitchers.length}]`);
  });
  console.log('\n=== Unmapped combos (candidates for new entries) ===');
  unmapped.forEach(u => console.log(`  ${u.combo}  —  ${u.reason}`));

  fs.writeFileSync(OUT, JSON.stringify({ mapped, unmapped, mappingTable: MAPPING }, null, 2), 'utf-8');
  console.log(`\nSaved: ${OUT}`);
}

main();
