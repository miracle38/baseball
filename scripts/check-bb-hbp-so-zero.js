// check-bb-hbp-so-zero.js — 각 엔트리에서 BB/HBP/SO 가 모든 선수 0 인지 검사
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const startRe = /const\s+ALL_DATA\s*=\s*\[/;
const sm = HTML.match(startRe);
const startIdx = sm.index + sm[0].length - 1;
let depth = 0, i = startIdx, inStr = false, strCh = '', prev = '';
for (; i < HTML.length; i++) {
  const c = HTML[i];
  if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
  else { if (c === '\'' || c === '"' || c === '`') { inStr = true; strCh = c; }
    else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } } }
  prev = c;
}
const ALL_DATA = vm.runInNewContext('(' + HTML.slice(startIdx, i) + ')');

console.log('엔트리별 타자 BB/HBP/SO 총합 (0=누락 가능성):');
console.log('id, source, #players, sumBB, sumHBP, sumSO, sumPA');
for (const e of ALL_DATA) {
  const players = Object.values(e.players||{});
  if (players.length === 0) { console.log(`${e.id}\t${e.source}\t0\t-`); continue; }
  let bb=0,hbp=0,so=0,pa=0;
  for (const p of players) { bb+=p.BB||0; hbp+=p.HBP||0; so+=p.SO||0; pa+=p.PA||0; }
  const flag = (bb+hbp+so === 0 && pa > 20) ? ' ***MISSING***' : '';
  console.log(`${e.id}\t${e.source}\t${players.length}\t${bb}\t${hbp}\t${so}\t${pa}${flag}`);
}
