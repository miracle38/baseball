// Scan ALL_DATA in index.html and list every game without real boxScore data.
// Rules:
//   - "실제 박스스코어 데이터 없음" 기준:
//       1) game.boxScore 자체가 없음
//       2) 또는 boxScore가 있어도 innings/awayBatters/homeBatters/awayPitchers/homePitchers가 모두 비어 empty
//   - 예정 경기(ourScore/theirScore가 null, result==='예정')는 제외 (애초에 기록 없음이 정상)
const fs = require('fs');
const path = require('path');

const htmlPath = path.resolve(__dirname, '..', 'index.html');
const html = fs.readFileSync(htmlPath, 'utf8');

// Extract ALL_DATA literal (from "const ALL_DATA = [" up to matching "];")
const startIdx = html.indexOf('const ALL_DATA = [');
if (startIdx < 0) { console.error('ALL_DATA not found'); process.exit(1); }
// find the matching end: we stored it as "\n];" right before next const
// but we'll parse via a bracket scanner starting at the "["
const bracketStart = html.indexOf('[', startIdx);
let depth = 0, i = bracketStart, inStr = false, strCh = '', escaped = false;
for (; i < html.length; i++) {
  const c = html[i];
  if (inStr) {
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === strCh) { inStr = false; continue; }
  } else {
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if (c === ']' || c === '}') { depth--; if (depth === 0 && c === ']') { i++; break; } }
  }
}
const literal = html.slice(bracketStart, i);
const ALL_DATA = eval('(' + literal + ')');

console.log(`Loaded ${ALL_DATA.length} entries`);

function boxScoreHasData(bs) {
  if (!bs || typeof bs !== 'object') return false;
  const inn = Array.isArray(bs.innings) && bs.innings.length > 0;
  const ab = Array.isArray(bs.awayBatters) && bs.awayBatters.length > 0;
  const hb = Array.isArray(bs.homeBatters) && bs.homeBatters.length > 0;
  const ap = Array.isArray(bs.awayPitchers) && bs.awayPitchers.length > 0;
  const hp = Array.isArray(bs.homePitchers) && bs.homePitchers.length > 0;
  // 최소한 이닝 스코어가 있거나, 타자/투수 한쪽이라도 있으면 '데이터 있음'
  return inn || ab || hb || ap || hp;
}

function isScheduled(g) {
  return g.result === '예정' || (g.ourScore == null && g.theirScore == null);
}

const missing = []; // {year, league, entryId, gameId, date, opponent, ourScore, theirScore, result, boxScoreUrl, hasBoxScoreKey}
const summary = {}; // year -> {total, scheduled, withBox, missingBox}

for (const entry of ALL_DATA) {
  if (!entry.games) continue;
  const year = entry.year;
  summary[year] = summary[year] || { total: 0, scheduled: 0, withBox: 0, missingBox: 0 };

  for (const [gid, g] of Object.entries(entry.games)) {
    summary[year].total++;
    if (isScheduled(g)) { summary[year].scheduled++; continue; }
    const has = boxScoreHasData(g.boxScore);
    if (has) { summary[year].withBox++; continue; }
    summary[year].missingBox++;
    missing.push({
      year,
      league: entry.league,
      leagueKey: entry.leagueKey,
      entryId: entry.id,
      gameId: gid,
      date: g.date,
      opponent: g.opponent,
      ourScore: g.ourScore,
      theirScore: g.theirScore,
      result: g.result,
      location: g.location || '',
      boxScoreUrl: g.boxScoreUrl || '',
      hasBoxScoreKey: 'boxScore' in g,
      source: entry.source || ''
    });
  }
}

console.log('\n=== 연도별 요약 ===');
console.log('연도 | 전체 | 예정 | 박스있음 | 박스없음(완료경기)');
Object.keys(summary).sort().forEach(y => {
  const s = summary[y];
  console.log(`${y} | ${s.total} | ${s.scheduled} | ${s.withBox} | ${s.missingBox}`);
});

const totalMissing = missing.length;
const totalCompleted = Object.values(summary).reduce((a, s) => a + s.total - s.scheduled, 0);
console.log(`\n완료 경기 ${totalCompleted}건 중 박스스코어 없는 경기: ${totalMissing}건`);

console.log('\n=== 박스스코어 없는 경기 상세 ===');
missing.sort((a, b) => a.date.localeCompare(b.date));
missing.forEach(m => {
  const url = m.boxScoreUrl ? ' → ' + m.boxScoreUrl : ' (URL없음)';
  console.log(`[${m.year}] ${m.date} vs ${m.opponent} (${m.ourScore}:${m.theirScore} ${m.result}) | ${m.league} [${m.entryId}/${m.gameId}]${url}`);
});

// 출력 저장 (후속 작업용)
const outPath = path.resolve(__dirname, 'missing-boxscores.json');
fs.writeFileSync(outPath, JSON.stringify({ summary, missing }, null, 2), 'utf8');
console.log(`\n결과 저장: ${outPath}`);
