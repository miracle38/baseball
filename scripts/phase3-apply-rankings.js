/**
 * Phase 3 - 변경 있는 엔트리에 대해 index.html 의 rankings 필드 교체
 * - scrape_debug/rankings/<id>.json 을 읽어 해당 엔트리 rankings 교체
 * - diff 가 있는 엔트리만 처리 (phase2-rankings-diff 결과)
 * - 다른 필드는 절대 건드리지 않음
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'rankings');

// 원본 scrape-rankings.js 의 helper 들 그대로 재사용
function rankArrayToJs(rankings) {
  return '[' + rankings.map(r => {
    const team = String(r.team).replace(/'/g, "\\'");
    return `{rank:${r.rank},team:'${team}',pts:${r.pts},G:${r.G},W:${r.W},L:${r.L},D:${r.D},RS:${r.RS||0},RA:${r.RA||0}}`;
  }).join(',') + ']';
}

function rankingsToJs(rankings) {
  if (!rankings) return 'null';
  if (Array.isArray(rankings)) {
    if (!rankings.length) return 'null';
    return rankArrayToJs(rankings);
  }
  const keys = Object.keys(rankings);
  if (keys.length === 0) return 'null';
  return '{' + keys.map(k => {
    const safeKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`;
    return `${safeKey}:${rankArrayToJs(rankings[k])}`;
  }).join(',') + '}';
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

function updateEntryRankings(html, entryId, rankings) {
  const span = findEntrySpan(html, entryId);
  if (!span) { console.warn(`  [${entryId}] 엔트리 못 찾음`); return { html, ok: false }; }
  let entryText = html.substring(span.start, span.end);
  const repl = rankingsToJs(rankings);

  const re = /rankings\s*:\s*(null|\[|\{)/;
  const m = re.exec(entryText);
  if (!m) {
    // rankings 필드가 없으면 추가
    const lastCurly = entryText.lastIndexOf('}');
    entryText = entryText.substring(0, lastCurly).replace(/,?\s*$/, '') + `, rankings:${repl} }`;
  } else {
    const startIdx = m.index;
    if (m[1] === 'null') {
      entryText = entryText.replace(/rankings\s*:\s*null/, `rankings:${repl}`);
    } else {
      const openChar = m[1];
      const closeChar = openChar === '[' ? ']' : '}';
      const openPos = startIdx + m[0].length - 1;
      let depth = 1, k = openPos + 1;
      let inStr = false, strCh = '', esc = false;
      while (k < entryText.length && depth > 0) {
        const c = entryText[k];
        if (esc) { esc = false; k++; continue; }
        if (c === '\\' && inStr) { esc = true; k++; continue; }
        if (inStr) { if (c === strCh) inStr = false; k++; continue; }
        if (c === "'" || c === '"') { inStr = true; strCh = c; k++; continue; }
        if (c === openChar) depth++;
        else if (c === closeChar) depth--;
        k++;
      }
      entryText = entryText.substring(0, startIdx) + `rankings:${repl}` + entryText.substring(k);
    }
  }
  return { html: html.substring(0, span.start) + entryText + html.substring(span.end), ok: true };
}

// 대상 엔트리(변경 있는): Phase 2 결과 기반 하드코딩
const TARGETS = [
  '2026_sejong',
  '2026_donggu',
  '2025_sejong_cup1',
  '2025_sejong_cup2',
  '2024_daedeok',
  '2023_sejong',
  '2023_sejong_po',
  '2023_daedeok',
];

function loadAllData(html) {
  const m = html.match(/const\s+ALL_DATA\s*=\s*\[/);
  let i = m.index + m[0].length - 1, depth = 0, inStr = false, strCh = '', prev = '';
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else { if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; } else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } } }
    prev = c;
  }
  return vm.runInNewContext('(' + html.slice(m.index + m[0].length - 1, i) + ')');
}

async function main() {
  let html = fs.readFileSync(INDEX_FILE, 'utf8');
  const originalHtml = html;
  const ALL_DATA = loadAllData(html);

  const summary = [];
  for (const id of TARGETS) {
    const entry = ALL_DATA.find(e => e.id === id);
    if (!entry) {
      console.warn(`[${id}] ALL_DATA 에 없음 - skip`);
      continue;
    }
    const debugFile = path.join(DEBUG_DIR, `${id}.json`);
    if (!fs.existsSync(debugFile)) {
      console.warn(`[${id}] debug 파일 없음 - skip`);
      continue;
    }
    const newRankings = JSON.parse(fs.readFileSync(debugFile, 'utf8'));
    const oldR = entry.rankings;
    const oldStr = JSON.stringify(oldR);
    const newStr = JSON.stringify(newRankings);
    if (oldStr === newStr) {
      console.log(`[${id}] 변경 없음 - skip`);
      continue;
    }
    const res = updateEntryRankings(html, id, newRankings);
    if (res.ok) {
      html = res.html;
      const oldType = Array.isArray(oldR) ? `array(${oldR.length})` : (oldR ? `object(${Object.keys(oldR).length})` : 'null');
      const newType = Array.isArray(newRankings) ? `array(${newRankings.length})` : `object(${Object.keys(newRankings).length})`;
      const action = !oldR ? 'added' : (oldType !== newType && oldR ? 'restructured' : 'updated');
      console.log(`[${id}] ${action}: ${oldType} → ${newType}`);
      summary.push({ id, action, oldType, newType });
    } else {
      console.warn(`[${id}] 적용 실패`);
      summary.push({ id, action: 'failed' });
    }
  }

  if (html !== originalHtml) {
    fs.writeFileSync(INDEX_FILE, html, 'utf8');
    console.log(`\n✅ index.html 업데이트 (${summary.length}개 엔트리)`);
  } else {
    console.log('\n⚠️ 변경 없음');
  }

  console.log('\n=== 요약 ===');
  summary.forEach(s => console.log(' ', JSON.stringify(s)));
}

main().catch(err => { console.error(err); process.exit(1); });
