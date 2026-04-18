/**
 * Phase 0: ALL_DATA 인벤토리
 * index.html 의 ALL_DATA 를 파싱하여 엔트리별 메타데이터 추출
 */
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML_FILE = path.join(__dirname, '..', 'index.html');
const OUT_FILE = path.join(__dirname, '..', 'tmp_all_data_inventory.json');

function findAllDataBounds(html) {
  const m = html.match(/const ALL_DATA\s*=\s*\[/);
  if (!m) return null;
  const arrayStart = m.index + m[0].length - 1; // position of '['
  let i = arrayStart + 1;
  let depth = 1;
  let inStr = false, strCh = null;
  let inLineComment = false, inBlockComment = false;
  while (i < html.length && depth > 0) {
    const c = html[i];
    const n = html[i + 1];
    if (inLineComment) {
      if (c === '\n') inLineComment = false;
      i++; continue;
    }
    if (inBlockComment) {
      if (c === '*' && n === '/') { inBlockComment = false; i += 2; continue; }
      i++; continue;
    }
    if (inStr) {
      if (c === '\\') { i += 2; continue; }
      if (c === strCh) { inStr = false; }
      i++; continue;
    }
    if (c === '/' && n === '/') { inLineComment = true; i += 2; continue; }
    if (c === '/' && n === '*') { inBlockComment = true; i += 2; continue; }
    if (c === '"' || c === "'" || c === '`') { inStr = true; strCh = c; i++; continue; }
    if (c === '[') depth++;
    else if (c === ']') depth--;
    i++;
  }
  return { statementStart: m.index, arrayStart, arrayEnd: i }; // i is just past closing ]
}

function main() {
  const html = fs.readFileSync(HTML_FILE, 'utf-8');
  const bounds = findAllDataBounds(html);
  if (!bounds) { console.error('ALL_DATA not found'); process.exit(1); }
  const arrSrc = html.substring(bounds.arrayStart, bounds.arrayEnd);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext('var ALL_DATA = ' + arrSrc + ';', ctx);
  const data = ctx.ALL_DATA;
  console.log('Total entries:', data.length);

  const inventory = data.map(e => ({
    id: e.id,
    year: e.year,
    league: e.league,
    leagueKey: e.leagueKey,
    source: e.source,
    sourceUrl: e.sourceUrl,
    W: e.W, L: e.L, D: e.D, G: e.G,
    numPlayers: e.players ? Object.keys(e.players).length : 0,
    numPitchers: e.pitchers ? Object.keys(e.pitchers).length : 0,
    numGames: e.games ? Object.keys(e.games).length : 0,
    hasRankings: !!e.rankings,
    firstPlayerKeys: e.players ? Object.keys(Object.values(e.players)[0] || {}) : []
  }));

  // Year matrix
  const byYear = {};
  data.forEach(e => {
    if (!byYear[e.year]) byYear[e.year] = [];
    byYear[e.year].push({ id: e.id, league: e.league, leagueKey: e.leagueKey, n: Object.keys(e.players || {}).length });
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    bounds,
    count: data.length,
    inventory,
    byYear
  }, null, 2), 'utf-8');

  console.log('\n=== By Year ===');
  Object.keys(byYear).sort().forEach(y => {
    console.log(`\n${y}: (${byYear[y].length} entries)`);
    byYear[y].forEach(e => console.log(`  - ${e.id} | ${e.league} | players=${e.n}`));
  });

  console.log('\nsaved:', OUT_FILE);
}

main();
