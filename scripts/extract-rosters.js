const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML_FILE = path.join(__dirname, '..', 'index.html');
const OUT = path.join(__dirname, '..', 'tmp_all_data_rosters.json');

function findAllDataBounds(html) {
  const m = html.match(/const ALL_DATA\s*=\s*\[/);
  if (!m) return null;
  const arrayStart = m.index + m[0].length - 1;
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
  return { arrayStart, arrayEnd: i };
}

function main() {
  const html = fs.readFileSync(HTML_FILE, 'utf-8');
  const bounds = findAllDataBounds(html);
  const arrSrc = html.substring(bounds.arrayStart, bounds.arrayEnd);
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext('var ALL_DATA = ' + arrSrc + ';', ctx);
  const data = ctx.ALL_DATA;

  const map = {};
  data.forEach(e => {
    const players = e.players || {};
    const pitchers = e.pitchers || {};
    map[e.id] = {
      year: e.year,
      league: e.league,
      sourceUrl: e.sourceUrl,
      players: Object.keys(players).map(k => ({ key: k, ...players[k] })),
      pitchers: Object.keys(pitchers).map(k => ({ key: k, ...pitchers[k] })),
      firstPlayerKeys: Object.keys(Object.values(players)[0] || {}),
      firstPitcherKeys: Object.keys(Object.values(pitchers)[0] || {})
    };
  });

  fs.writeFileSync(OUT, JSON.stringify(map, null, 2), 'utf-8');
  console.log('Saved:', OUT);
}

main();
