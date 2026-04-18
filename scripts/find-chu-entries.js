const fs = require('fs');
const vm = require('vm');
const path = require('path');

const HTML_FILE = path.join(__dirname, '..', 'index.html');

function findBounds(html) {
  const m = html.match(/const ALL_DATA\s*=\s*\[/);
  const arrayStart = m.index + m[0].length - 1;
  let i = arrayStart + 1, depth = 1, inStr = false, strCh = '';
  while (i < html.length && depth > 0) {
    const c = html[i], prev = html[i - 1];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else {
      if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; }
      else if (c === '[') depth++;
      else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
    }
    i++;
  }
  return { arrayStart, arrayEnd: i };
}

const html = fs.readFileSync(HTML_FILE, 'utf-8');
const b = findBounds(html);
const ctx = {};
vm.createContext(ctx);
vm.runInContext('var ALL_DATA = ' + html.substring(b.arrayStart, b.arrayEnd) + ';', ctx);
const d = ctx.ALL_DATA;

const chuEntries = [];
d.forEach(e => {
  const bh = Object.values(e.players || {}).find(p => p.name === '추혜승');
  const ph = Object.values(e.pitchers || {}).find(p => p.name === '추혜승');
  if (bh || ph) chuEntries.push({ id: e.id, year: e.year, league: e.league, asBatter: !!bh, asPitcher: !!ph });
});

console.log('Chu appears in', chuEntries.length, 'entries');
chuEntries.sort((a, b) => a.year - b.year).forEach(e =>
  console.log(' ', e.id, '|', e.year, '|', e.league, '| B:', e.asBatter, 'P:', e.asPitcher));

// Count distinct years
const years = [...new Set(chuEntries.map(e => e.year))].sort();
console.log('Distinct years:', years.length, '-', years.join(', '));
