// phase0-rankings-inventory.js - ALL_DATA rankings 현재 상태 인벤토리
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const startRe = /const\s+ALL_DATA\s*=\s*\[/;
const sm = HTML.match(startRe);
const sIdx = sm.index + sm[0].length - 1;
let depth = 0, i = sIdx, inStr = false, strCh = '', prev = '';
for (; i < HTML.length; i++) {
  const c = HTML[i];
  if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
  else {
    if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; }
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  prev = c;
}
const arrText = HTML.slice(sIdx, i);
const ALL_DATA = vm.runInNewContext('(' + arrText + ')');

console.log('=== ALL_DATA', ALL_DATA.length, '엔트리 ===');

const rows = [];
let hasCnt = 0, noCnt = 0, nullCnt = 0;
for (const e of ALL_DATA) {
  let type = 'none';
  let size = 0;
  let groups = 0;
  let windupRank = null;
  if (e.rankings === undefined || e.rankings === null) {
    type = e.rankings === undefined ? 'none' : 'null';
    if (type === 'null') nullCnt++; else noCnt++;
  } else if (Array.isArray(e.rankings)) {
    type = 'array';
    size = e.rankings.length;
    const w = e.rankings.find(r => /와인드업/.test(r.team));
    if (w) windupRank = w.rank;
    hasCnt++;
  } else if (typeof e.rankings === 'object') {
    type = 'object';
    const keys = Object.keys(e.rankings);
    groups = keys.length;
    size = keys.reduce((a, k) => a + (e.rankings[k]?.length || 0), 0);
    for (const k of keys) {
      const arr = e.rankings[k];
      if (!Array.isArray(arr)) continue;
      const w = arr.find(r => /와인드업/.test(r.team));
      if (w) { windupRank = `${k}조 ${w.rank}위`; break; }
    }
    hasCnt++;
  }
  rows.push({
    id: e.id,
    year: e.year,
    source: e.source,
    league: e.league,
    group: e.group || '',
    type, size, groups, windupRank
  });
}

console.log('\n엔트리별 rankings 상태:');
console.log('ID'.padEnd(30), 'YEAR', 'SOURCE'.padEnd(18), 'TYPE'.padEnd(8), 'SIZE', 'GROUPS', 'WINDUP');
for (const r of rows) {
  console.log(
    r.id.padEnd(30),
    String(r.year).padEnd(4),
    (r.source||'').padEnd(18),
    r.type.padEnd(8),
    String(r.size).padStart(4),
    String(r.groups).padStart(6),
    r.windupRank || '-'
  );
}
console.log('\n=== 집계 ===');
console.log('rankings 있는 엔트리:', hasCnt);
console.log('rankings=null 엔트리:', nullCnt);
console.log('rankings 필드 자체 없는 엔트리:', noCnt);

// source별 집계
const bySource = {};
for (const r of rows) {
  const s = r.source || '(none)';
  if (!bySource[s]) bySource[s] = { total: 0, has: 0, none: 0 };
  bySource[s].total++;
  if (r.type === 'array' || r.type === 'object') bySource[s].has++;
  else bySource[s].none++;
}
console.log('\n=== 소스별 ===');
for (const [s, v] of Object.entries(bySource)) {
  console.log(`  ${s.padEnd(20)} 총 ${v.total}, rankings 있음 ${v.has}, 없음 ${v.none}`);
}

fs.writeFileSync(path.join(__dirname, '..', 'tmp_rankings_inventory.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log('\ntmp_rankings_inventory.json 작성');
