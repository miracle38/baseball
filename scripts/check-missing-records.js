/**
 * 전체 데이터 누락 체크
 * - rankings null
 * - seasonSummary 없음
 * - 과거 날짜인데 result=예정
 * - 완료 경기인데 boxScoreUrl 없음
 * - players 비어있음
 * - header W/L/D/G vs games 집계 불일치
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf-8');
const m = html.match(/const ALL_DATA\s*=\s*\[/);
const start = m.index + m[0].length - 1;
let i = start + 1, depth = 1, inStr = false, strCh = null;
while (i < html.length && depth > 0) {
  const c = html[i];
  if (inStr) {
    if (c === '\\') { i += 2; continue; }
    if (c === strCh) inStr = false;
    i++; continue;
  }
  if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; i++; continue; }
  if (c === '[') depth++;
  else if (c === ']') depth--;
  i++;
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext('var ALL_DATA = ' + html.substring(start, i) + ';', ctx);
const data = ctx.ALL_DATA;

const today = new Date('2026-05-24');

console.log(`=== 총 엔트리: ${data.length}개 ===\n`);

console.log('=== 1. rankings 없음 (null/undefined) ===');
const noRank = data.filter(e => !e.rankings);
if (noRank.length === 0) console.log('  ✓ 모두 있음');
else noRank.forEach(e => console.log(`  - ${e.id} | ${e.league} | source=${e.source}`));

console.log('\n=== 2. seasonSummary 없음 ===');
const noSS = data.filter(e => !e.seasonSummary);
if (noSS.length === 0) console.log('  ✓ 모두 있음');
else noSS.forEach(e => console.log(`  - ${e.id} | ${e.league}`));

console.log('\n=== 3. 과거 날짜인데 result=예정 ===');
let pastSchedCount = 0;
data.forEach(e => {
  Object.entries(e.games || {}).forEach(([gk, g]) => {
    if (g.result === '예정' && g.date) {
      const gd = new Date(g.date);
      if (gd < today) {
        const daysAgo = Math.floor((today - gd) / 86400000);
        console.log(`  - ${e.id} ${gk} ${g.date} vs ${g.opponent} (${daysAgo}일 경과)`);
        pastSchedCount++;
      }
    }
  });
});
if (pastSchedCount === 0) console.log('  ✓ 없음');

console.log('\n=== 4. 완료 경기인데 boxScoreUrl 없음 (2024+) ===');
let missBox = 0;
data.forEach(e => {
  if (e.year < 2024) return;
  Object.entries(e.games || {}).forEach(([gk, g]) => {
    if (g.result && g.result !== '예정' && !g.boxScoreUrl) {
      console.log(`  - ${e.id} ${gk} ${g.date} vs ${g.opponent} (${g.ourScore}-${g.theirScore})`);
      missBox++;
    }
  });
});
if (missBox === 0) console.log('  ✓ 없음');

console.log('\n=== 5. players 비어있음 ===');
const emptyP = data.filter(e => !e.players || Object.keys(e.players).length === 0);
if (emptyP.length === 0) console.log('  ✓ 없음');
else emptyP.forEach(e => console.log(`  - ${e.id} | ${e.league}`));

console.log('\n=== 6. pitchers 비어있음 ===');
const emptyPt = data.filter(e => !e.pitchers || Object.keys(e.pitchers).length === 0);
if (emptyPt.length === 0) console.log('  ✓ 없음');
else emptyPt.forEach(e => console.log(`  - ${e.id} | ${e.league}`));

console.log('\n=== 7. games 비어있음 ===');
const emptyG = data.filter(e => !e.games || Object.keys(e.games).length === 0);
if (emptyG.length === 0) console.log('  ✓ 없음');
else emptyG.forEach(e => console.log(`  - ${e.id} | ${e.league}`));

console.log('\n=== 8. header(W-L-D/G) vs games 집계 불일치 ===');
let mismatchCount = 0;
data.forEach(e => {
  const games = Object.values(e.games || {});
  const completed = games.filter(g => g.result && g.result !== '예정');
  const aggW = completed.filter(g => g.result === '승').length;
  const aggL = completed.filter(g => g.result === '패').length;
  const aggD = completed.filter(g => g.result === '무').length;
  const aggG = completed.length;
  if (e.G !== aggG || e.W !== aggW || e.L !== aggL || e.D !== aggD) {
    console.log(`  - ${e.id}: header=${e.W}-${e.L}-${e.D}/${e.G} vs games=${aggW}-${aggL}-${aggD}/${aggG}`);
    mismatchCount++;
  }
});
if (mismatchCount === 0) console.log('  ✓ 없음');

console.log('\n=== 9. 플레이어/투수 통계 전부 0인 엔트리 (스크랩 실패 의심) ===');
data.forEach(e => {
  const players = Object.values(e.players || {});
  if (players.length === 0) return;
  const totalH = players.reduce((s, p) => s + (p.H || 0), 0);
  const totalAB = players.reduce((s, p) => s + (p.AB || 0), 0);
  if (totalAB === 0 && totalH === 0) {
    console.log(`  - ${e.id}: 모든 선수 stats=0 (players=${players.length})`);
  }
});
