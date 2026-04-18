/**
 * 특정 엔트리의 games{} 내부 개수 및 기본 정보 추출
 */
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(INDEX_FILE, 'utf-8');

function findEntrySpan(text, entryId) {
  // Both "id:'X'" and "id: 'X'" formats
  const re = new RegExp(`id\\s*:\\s*['"]${entryId}['"]`);
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index;
  while (i > 0 && text[i] !== '{') i--;
  let depth = 1, j = i + 1;
  let inStr = false, strCh = '', esc = false;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (esc) { esc = false; j++; continue; }
    if (c === '\\' && inStr) { esc = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    j++;
  }
  return { start: i, end: j };
}

function findBalancedBlockAfter(text, startIdx) {
  // text[startIdx] must be { or [
  const openChar = text[startIdx];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 1, j = startIdx + 1;
  let inStr = false, strCh = '', esc = false;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (esc) { esc = false; j++; continue; }
    if (c === '\\' && inStr) { esc = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) depth--;
    j++;
  }
  return { start: startIdx, end: j };
}

function extractGamesInfo(entryId) {
  const span = findEntrySpan(html, entryId);
  if (!span) {
    console.log(`${entryId}: NOT FOUND`);
    return;
  }
  const entryText = html.substring(span.start, span.end);
  console.log(`\n=== ${entryId} ===`);
  console.log(`  Entry span: ${span.start} .. ${span.end} (${span.end - span.start} chars)`);

  // header fields
  const headerMatch = /record:\s*['"]([^'"]*)['"]\s*,\s*W:\s*(\d+)\s*,\s*L:\s*(\d+)\s*,\s*D:\s*(\d+)\s*,\s*G:\s*(\d+)/.exec(entryText);
  if (headerMatch) {
    console.log(`  header: record='${headerMatch[1]}', W=${headerMatch[2]}, L=${headerMatch[3]}, D=${headerMatch[4]}, G=${headerMatch[5]}`);
  }

  // Find games:{...}
  const gRe = /games\s*:\s*\{/;
  const gm = gRe.exec(entryText);
  if (!gm) {
    console.log(`  games: not found`);
    return;
  }
  const braceStart = gm.index + gm[0].length - 1;
  const gSpan = findBalancedBlockAfter(entryText, braceStart);
  const gamesText = entryText.substring(gSpan.start, gSpan.end);

  // Parse g1, g2, ... entries
  const games = [];
  // Find top-level gN:{...}
  let i = 1; // skip opening {
  while (i < gamesText.length - 1) {
    // skip whitespace / commas
    while (i < gamesText.length - 1 && /[\s,]/.test(gamesText[i])) i++;
    if (i >= gamesText.length - 1) break;
    // expect gN:
    const kMatch = /^g\d+\s*:\s*\{/.exec(gamesText.substring(i));
    if (!kMatch) {
      console.log(`  [warn] unexpected at pos ${i}: "${gamesText.substring(i, i + 30)}"`);
      break;
    }
    const keyName = /^g\d+/.exec(kMatch[0])[0];
    const objStart = i + kMatch[0].length - 1;
    const objSpan = findBalancedBlockAfter(gamesText, objStart);
    const objText = gamesText.substring(objStart, objSpan.end);

    // Extract date, opponent, result, seq, boxScore presence
    const dateM = /date:'([^']*)'/.exec(objText);
    const oppM = /opponent:'([^']*)'/.exec(objText);
    const osM = /ourScore:(-?\d+)/.exec(objText);
    const tsM = /theirScore:(-?\d+)/.exec(objText);
    const rsM = /result:'([^']*)'/.exec(objText);
    const urlM = /boxScoreUrl:'([^']*)'/.exec(objText);
    const hasBox = /boxScore\s*:\s*\{/.test(objText);

    games.push({
      key: keyName,
      date: dateM ? dateM[1] : '',
      opponent: oppM ? oppM[1] : '',
      ourScore: osM ? parseInt(osM[1]) : null,
      theirScore: tsM ? parseInt(tsM[1]) : null,
      result: rsM ? rsM[1] : '',
      boxScoreUrl: urlM ? urlM[1] : '',
      hasBox: hasBox
    });

    i = objSpan.end;
  }

  console.log(`  games count: ${games.length}`);
  games.forEach(g => {
    const seq = g.boxScoreUrl.match(/gameScheduleSeq=(\d+)/);
    console.log(`    ${g.key}: ${g.date} vs ${g.opponent} ${g.ourScore}-${g.theirScore} ${g.result}${g.hasBox ? ' [BS]' : ''} seq=${seq ? seq[1] : '-'}`);
  });

  // Save as JSON
  const outDir = path.join(__dirname, '..', 'tmp_entry_games');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${entryId}.json`), JSON.stringify(games, null, 2), 'utf-8');
}

const targets = process.argv.slice(2);
if (targets.length === 0) {
  ['2024_daedeok', '2023_sejong', '2023_daedeok'].forEach(extractGamesInfo);
} else {
  targets.forEach(extractGamesInfo);
}
