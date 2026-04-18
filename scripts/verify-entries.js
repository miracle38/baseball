const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sr = /const\s+ALL_DATA\s*=\s*\[/;
const sm = HTML.match(sr);
const startIdx = sm.index + sm[0].length - 1;
let depth = 0, i = startIdx, inStr = false, strCh = '', prev = '';
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
const DATA = vm.runInNewContext('(' + HTML.slice(startIdx, i) + ')');
console.log('entries:', DATA.length);
for (const id of ['2024_daedeok', '2023_daedeok', '2023_sejong', '2023_sejong_po', '2023_sejong_inter']) {
  const e = DATA.find(d => d.id === id);
  if (!e) { console.log(id, 'NOT FOUND'); continue; }
  const g = Object.values(e.games || {});
  const hasBox = g.filter(x => x.boxScore).length;
  console.log(`${id}: record='${e.record}' G=${e.G} W=${e.W} L=${e.L} D=${e.D} games=${g.length} [bs=${hasBox}]`);
  g.forEach(x => console.log(`  ${x.date} vs ${x.opponent} ${x.ourScore}-${x.theirScore} ${x.result}${x.boxScore ? ' [BS]' : ''} ${x.boxScoreUrl ? '[URL]' : ''} loc='${x.location}'`));
}
