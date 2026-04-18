/**
 * Phase 4 — ALL_DATA 각 엔트리의 header record/W/L/D/G 를 games 집계로 재계산.
 *
 * 규칙:
 *   W = result==='승' 개수
 *   L = result==='패' 개수
 *   D = result==='무' 개수
 *   G = W + L + D  (result==='예정' 제외)
 *   record = `${W}승 ${L}패${D>0? ' ' + D + '무' : ''}`
 *
 * 치환 대상:
 *   - `record:'...'`
 *   - `W:숫자`, `L:숫자`, `D:숫자`, `G:숫자`  (엔트리 헤더에서만)
 *
 * index.html 에서 각 엔트리 id 출현 이후 seasonSummary / players 등장 이전까지의
 * 헤더 부분만 치환 (seasonSummary 의 W/L/D/G 는 별도).
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

function loadAllData() {
  const HTML = fs.readFileSync(INDEX_FILE, 'utf8');
  const sr = /const\s+ALL_DATA\s*=\s*\[/;
  const sm = HTML.match(sr);
  const startIdx = sm.index + sm[0].length - 1;
  let depth = 0, i = startIdx, inStr = false, strCh = '', prev = '';
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else { if (c === '\'' || c === '"' || c === '`') { inStr = true; strCh = c; }
      else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } } }
    prev = c;
  }
  return { HTML, DATA: vm.runInNewContext('(' + HTML.slice(startIdx, i) + ')') };
}

function findEntrySpan(text, entryId) {
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

function findHeaderEnd(entryText) {
  // 헤더 영역: entry 시작 '{' 부터 'players:' 또는 'seasonSummary:' 전까지
  const m = /\b(players|pitchers|games|seasonSummary|rankings)\s*:/.exec(entryText);
  return m ? m.index : entryText.length;
}

function aggregateGames(entry) {
  let W = 0, L = 0, D = 0;
  for (const g of Object.values(entry.games || {})) {
    if (g.result === '승') W++;
    else if (g.result === '패') L++;
    else if (g.result === '무') D++;
  }
  const G = W + L + D;
  const record = `${W}승 ${L}패${D > 0 ? ' ' + D + '무' : ''}`;
  return { W, L, D, G, record };
}

function replaceHeaderField(entryText, headerEnd, fieldName, newValueStr) {
  // fieldName:  [WLDG]  (숫자) 또는  record  (문자열)
  const headerOnly = entryText.substring(0, headerEnd);
  if (fieldName === 'record') {
    const re = /record\s*:\s*'([^']*)'/;
    const m = re.exec(headerOnly);
    if (!m) return { text: entryText, changed: false, old: null };
    const old = m[1];
    if (old === newValueStr) return { text: entryText, changed: false, old };
    const newHeader = headerOnly.substring(0, m.index) + `record:'${newValueStr}'` + headerOnly.substring(m.index + m[0].length);
    return { text: newHeader + entryText.substring(headerEnd), changed: true, old };
  } else {
    // Word boundary + field name, not preceded by alphanum/_
    const re = new RegExp(`(^|[,{\\s])${fieldName}\\s*:\\s*(-?\\d+)`);
    const m = re.exec(headerOnly);
    if (!m) return { text: entryText, changed: false, old: null };
    const old = parseInt(m[2]);
    if (old === newValueStr) return { text: entryText, changed: false, old };
    const prefix = m[1];
    const matchStart = m.index + prefix.length;
    const matchEnd = m.index + m[0].length;
    const newHeader = headerOnly.substring(0, matchStart) + `${fieldName}:${newValueStr}` + headerOnly.substring(matchEnd);
    return { text: newHeader + entryText.substring(headerEnd), changed: true, old };
  }
}

function main() {
  const { DATA } = loadAllData();
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  const diffs = [];
  let totalChanges = 0;

  for (const entry of DATA) {
    const agg = aggregateGames(entry);
    // 현재 header 값과 비교
    const cur = { W: entry.W, L: entry.L, D: entry.D, G: entry.G, record: entry.record };
    if (cur.W === agg.W && cur.L === agg.L && cur.D === agg.D && cur.G === agg.G && cur.record === agg.record) continue;

    // 치환
    const span = findEntrySpan(html, entry.id);
    if (!span) { console.log(`[${entry.id}] span 찾지 못함 — 스킵`); continue; }
    let entryText = html.substring(span.start, span.end);
    const headerEnd = findHeaderEnd(entryText);

    const changes = [];
    for (const field of ['W', 'L', 'D', 'G']) {
      const r = replaceHeaderField(entryText, headerEnd, field, agg[field]);
      if (r.changed) { entryText = r.text; changes.push(`${field}:${r.old}→${agg[field]}`); }
    }
    const r = replaceHeaderField(entryText, findHeaderEnd(entryText), 'record', agg.record);
    if (r.changed) { entryText = r.text; changes.push(`record:'${r.old}'→'${agg.record}'`); }

    if (changes.length > 0) {
      html = html.substring(0, span.start) + entryText + html.substring(span.end);
      diffs.push({ id: entry.id, before: cur, after: { W: agg.W, L: agg.L, D: agg.D, G: agg.G, record: agg.record }, changes });
      totalChanges += changes.length;
    }
  }

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');

  console.log('\n=== Phase 4 결과 ===');
  for (const d of diffs) {
    console.log(`[${d.id}]`);
    console.log(`  이전: ${d.before.record} (G=${d.before.G}, W=${d.before.W}, L=${d.before.L}, D=${d.before.D})`);
    console.log(`  이후: ${d.after.record} (G=${d.after.G}, W=${d.after.W}, L=${d.after.L}, D=${d.after.D})`);
    console.log(`  변경: ${d.changes.join(', ')}`);
  }
  console.log(`\n총 엔트리 수정: ${diffs.length}, 필드 변경 수: ${totalChanges}`);
}

main();
