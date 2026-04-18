// 빈 players/pitchers 보유 엔트리
const fs = require('fs'); const path = require('path'); const vm = require('vm');
const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const sm = HTML.match(/const\s+ALL_DATA\s*=\s*\[/);
const startIdx = sm.index + sm[0].length - 1;
let depth = 0, i = startIdx, inStr = false, strCh = '', prev = '';
for (; i < HTML.length; i++) {
  const c = HTML[i];
  if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
  else { if (c === '\'' || c === '"' || c === '`') { inStr = true; strCh = c; }
    else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } } }
  prev = c;
}
const D = vm.runInNewContext('(' + HTML.slice(startIdx, i) + ')');
console.log('엔트리 / players / pitchers / games / headerG');
for (const e of D) {
  const pl = Object.keys(e.players||{}).length;
  const pt = Object.keys(e.pitchers||{}).length;
  const gm = Object.keys(e.games||{}).length;
  const flag = (pl===0 && pt===0) ? ' *** 전혀 없음 ***' : (pl===0 ? ' (타자 0)' : (pt===0 ? ' (투수 0)' : ''));
  console.log(`${e.id}\t${pl}\t${pt}\t${gm}\t${e.G}${flag}`);
}
