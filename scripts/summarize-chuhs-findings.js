/**
 * tmp_chuhs_progress.json / tmp_chuhs_all_leagues.json 의 발견 결과를
 * 중복 제거하고 stat 파싱하여 사람이 읽기 좋은 요약 생성
 */
const fs = require('fs');
const path = require('path');

const progress = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tmp_chuhs_progress.json'), 'utf-8'));

// 중복 제거 (동일 year/lig/group/type)
const uniq = new Map();
progress.found.forEach(f => {
  const key = `${f.year}_${f.lig_idx}_${f.group_code}_${f.type}`;
  // 더 많은 셀을 가진 row(=stats 포함)를 채택
  if (!uniq.has(key) || f.cells.length > uniq.get(key).cells.length) {
    uniq.set(key, f);
  }
});

const findings = [...uniq.values()];

// 타자 헤더 예: 랭킹, 이름, 팀명, 타율, 타석, 타수, 총안타, 2루타, 3루타, 홈런, 타점, 득점, 도루, 볼넷, 사구, 삼진, 병살타, 희타, 희비, 실책, 출루율, 장타율, OPS, 게임수
// 투수 헤더 예: 랭킹, 이름, 팀명, 방어율, 타자수, 타수, 피안타, 피홈런, 루타, 볼넷, 사구, 삼진, 폭투, 보크, 실점, 자책점, 승, 패, 세, 홀드, 완투, 게임수, 이닝, 투구수

function parseHitterStats(h, cells) {
  const out = {};
  ['이름','팀명','타율','타석','타수','총안타','2루타','3루타','홈런','타점','득점','도루','볼넷','사구','삼진','출루율','장타율','OPS','게임수','경기','경기수','타수'].forEach(col => {
    const i = h.indexOf(col);
    if (i >= 0) out[col] = cells[i];
  });
  return out;
}

function parsePitcherStats(h, cells) {
  const out = {};
  ['이름','팀명','방어율','ERA','승','패','세','홀드','게임수','경기','경기수','이닝','타자','타자수','투구수','피안타','피홈런','볼넷','사구','탈삼진','삼진','실점','자책점'].forEach(col => {
    const i = h.indexOf(col);
    if (i >= 0) out[col] = cells[i];
  });
  return out;
}

console.log('=== 추혜승 발견 기록 (중복 제거, 총 ' + findings.length + '건) ===\n');

findings.sort((a, b) => a.year - b.year || a.lig_idx - b.lig_idx || a.type.localeCompare(b.type));

findings.forEach(f => {
  const parsed = f.type === 'batter' ? parseHitterStats(f.headers, f.cells) : parsePitcherStats(f.headers, f.cells);
  console.log(`[${f.year}] ${f.ligName} / ${f.groupName}`);
  console.log(`  팀: ${f.team} | 타입: ${f.type} | 이름: ${f.name}`);
  console.log(`  stats: ${JSON.stringify(parsed)}`);
  console.log(`  headers: [${f.headers.join(', ')}]`);
  console.log('');
});

// 최종 JSON 저장
const out = {
  total: findings.length,
  findings: findings.map(f => ({
    year: f.year,
    lig_idx: f.lig_idx,
    ligName: f.ligName,
    group_code: f.group_code,
    groupName: f.groupName,
    type: f.type,
    name: f.name,
    team: f.team,
    stats: f.type === 'batter' ? parseHitterStats(f.headers, f.cells) : parsePitcherStats(f.headers, f.cells),
    headers: f.headers,
    cells: f.cells
  }))
};

fs.writeFileSync(path.join(__dirname, '..', 'tmp_chuhs_all_leagues.json'), JSON.stringify(out, null, 2), 'utf-8');
console.log('→ tmp_chuhs_all_leagues.json 저장 완료');

// 연도×팀 매트릭스
console.log('\n=== 연도별 요약 ===');
const byYear = {};
findings.forEach(f => {
  if (!byYear[f.year]) byYear[f.year] = [];
  byYear[f.year].push(f);
});
Object.keys(byYear).sort().forEach(y => {
  const teams = [...new Set(byYear[y].map(x => x.team))].join(', ');
  const types = [...new Set(byYear[y].map(x => x.type))].join('+');
  const leagues = byYear[y].map(x => `${x.ligName.slice(0,10)}/${x.groupName.slice(0,15)}`).join(' | ');
  console.log(`  ${y}: 팀=[${teams}] (${types}) ${byYear[y].length}건 - ${leagues}`);
});
