/**
 * tmp_games/ 에 저장된 수집 결과를 index.html 의 games{} 블록으로 반영.
 *
 * 처리 대상:
 *   - 2024_daedeok (14 게임으로 교체)
 *   - 2023_daedeok (13 게임으로 교체)
 *   - 2023_sejong  (기존 9게임 유지 — 소스 불가능)
 *
 * 기존 games{} 의 boxScore / boxScoreUrl 을 가능한 보존
 *   (key = date + opponent 정규화)
 */
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const TMP_DIR = path.join(__dirname, '..', 'tmp_games');

const TARGETS = ['2024_daedeok', '2023_daedeok', '2023_sejong'];

// ==================== HTML span helpers ====================
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

function findBalancedBlockAfter(text, startIdx) {
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

function extractExistingGames(html, entryId) {
  const span = findEntrySpan(html, entryId);
  if (!span) return { games: [], span: null };
  const entryText = html.substring(span.start, span.end);
  const gRe = /games\s*:\s*\{/;
  const gm = gRe.exec(entryText);
  if (!gm) return { games: [], span };
  const braceStart = gm.index + gm[0].length - 1;
  const gSpan = findBalancedBlockAfter(entryText, braceStart);
  const gamesText = entryText.substring(gSpan.start, gSpan.end);
  const games = [];
  let i = 1;
  while (i < gamesText.length - 1) {
    while (i < gamesText.length - 1 && /[\s,]/.test(gamesText[i])) i++;
    if (i >= gamesText.length - 1) break;
    const kMatch = /^g\d+\s*:\s*\{/.exec(gamesText.substring(i));
    if (!kMatch) break;
    const keyName = /^g\d+/.exec(kMatch[0])[0];
    const objStart = i + kMatch[0].length - 1;
    const objSpan = findBalancedBlockAfter(gamesText, objStart);
    const objText = gamesText.substring(objStart, objSpan.end);

    const dateM = /date:'([^']*)'/.exec(objText);
    const oppM = /opponent:'([^']*)'/.exec(objText);
    const osM = /ourScore:(-?\d+)/.exec(objText);
    const tsM = /theirScore:(-?\d+)/.exec(objText);
    const rsM = /result:'([^']*)'/.exec(objText);
    const locM = /location:'([^']*)'/.exec(objText);
    const urlM = /boxScoreUrl:'([^']*)'/.exec(objText);
    let boxScoreText = null;
    const bsM = /boxScore\s*:\s*\{/.exec(objText);
    if (bsM) {
      const bsBraceStart = bsM.index + bsM[0].length - 1;
      const bsSpan = findBalancedBlockAfter(objText, bsBraceStart);
      boxScoreText = objText.substring(bsSpan.start, bsSpan.end);
    }
    games.push({
      key: keyName,
      date: dateM ? dateM[1] : '',
      opponent: oppM ? oppM[1] : '',
      ourScore: osM ? parseInt(osM[1]) : 0,
      theirScore: tsM ? parseInt(tsM[1]) : 0,
      result: rsM ? rsM[1] : '',
      location: locM ? locM[1] : '',
      boxScoreUrl: urlM ? urlM[1] : '',
      boxScoreText: boxScoreText
    });
    i = objSpan.end;
  }
  return { games, span, entryText };
}

function replaceGamesBlock(html, entryId, newGamesJs) {
  const span = findEntrySpan(html, entryId);
  if (!span) return { html, ok: false };
  const entryText = html.substring(span.start, span.end);
  const re = /games\s*:\s*\{/;
  const m = re.exec(entryText);
  if (!m) return { html, ok: false };
  const braceStart = m.index + m[0].length - 1;
  const gSpan = findBalancedBlockAfter(entryText, braceStart);
  const newEntryText = entryText.substring(0, m.index) + 'games:' + newGamesJs + entryText.substring(gSpan.end);
  return { html: html.substring(0, span.start) + newEntryText + html.substring(span.end), ok: true };
}

function norm(s) { return (s || '').replace(/\s+/g, '').trim(); }

function buildMergedGames(existing, collected) {
  const byKey = {};
  for (const e of existing) byKey[`${e.date}|${norm(e.opponent)}`] = e;
  const merged = [];
  for (const c of collected) {
    const prev = byKey[`${c.date}|${norm(c.opponent)}`];
    merged.push({
      date: c.date,
      opponent: c.opponent,
      ourScore: c.ourScore,
      theirScore: c.theirScore,
      result: c.result,
      location: c.location || (prev ? prev.location : ''),
      boxScoreUrl: c.boxScoreUrl || (prev ? prev.boxScoreUrl : ''),
      boxScoreText: prev ? prev.boxScoreText : null,
      _hadPrev: !!prev
    });
  }
  return merged;
}

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function mergedGamesToJs(merged) {
  if (!merged.length) return '{}';
  return '{' + merged.map((g, i) => {
    const opp = esc(g.opponent);
    const loc = esc(g.location);
    const url = esc(g.boxScoreUrl || '');
    const urlStr = url ? `,boxScoreUrl:'${url}'` : '';
    const bsStr = g.boxScoreText ? `,boxScore:${g.boxScoreText}` : '';
    return `g${i+1}:{date:'${g.date}',opponent:'${opp}',ourScore:${g.ourScore},theirScore:${g.theirScore},result:'${g.result}',location:'${loc}'${urlStr}${bsStr}}`;
  }).join(',') + '}';
}

function main() {
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const summary = [];

  for (const entryId of TARGETS) {
    const collectedPath = path.join(TMP_DIR, `tmp_games_${entryId}.json`);
    if (!fs.existsSync(collectedPath)) {
      console.log(`[${entryId}] tmp_games not found — skip`);
      summary.push({ entryId, status: 'skip', reason: 'no tmp_games' });
      continue;
    }
    const collected = JSON.parse(fs.readFileSync(collectedPath, 'utf-8'));
    const { games: existing } = extractExistingGames(html, entryId);

    // Special case: 2023_sejong — source has incomplete data. Merge strategy:
    //   기존 9게임 중 collected 에 없는 4/8, 4/29 는 그대로 유지.
    //   collected 의 7 게임 + 기존 4/8, 4/29 = 9 게임.
    let mergedGames;
    if (entryId === '2023_sejong') {
      // Preserve existing entries whose key is NOT in collected set
      const collKeys = new Set(collected.map(c => `${c.date}|${norm(c.opponent)}`));
      const extraFromExisting = existing
        .filter(e => !collKeys.has(`${e.date}|${norm(e.opponent)}`))
        .map(e => ({
          date: e.date,
          opponent: e.opponent,
          ourScore: e.ourScore,
          theirScore: e.theirScore,
          result: e.result,
          location: e.location,
          boxScoreUrl: e.boxScoreUrl,
          boxScoreText: e.boxScoreText,
          _hadPrev: true
        }));
      // collected 에 대해선 기존 boxScore 매칭
      const mergedCollected = buildMergedGames(existing, collected);
      mergedGames = [...mergedCollected, ...extraFromExisting].sort((a, b) => a.date.localeCompare(b.date));
    } else {
      mergedGames = buildMergedGames(existing, collected).sort((a, b) => a.date.localeCompare(b.date));
    }

    console.log(`\n[${entryId}] before: ${existing.length}경기, after: ${mergedGames.length}경기`);
    const existingKeys = new Set(existing.map(e => `${e.date}|${norm(e.opponent)}`));
    const newOnes = mergedGames.filter(m => !existingKeys.has(`${m.date}|${norm(m.opponent)}`));
    newOnes.forEach(n => console.log(`   [NEW] ${n.date} vs ${n.opponent} ${n.ourScore}-${n.theirScore} ${n.result}`));
    const newKeys = new Set(mergedGames.map(m => `${m.date}|${norm(m.opponent)}`));
    const removed = existing.filter(e => !newKeys.has(`${e.date}|${norm(e.opponent)}`));
    removed.forEach(r => console.log(`   [REMOVED] ${r.date} vs ${r.opponent} ${r.ourScore}-${r.theirScore} ${r.result}`));

    const gjs = mergedGamesToJs(mergedGames);
    const r = replaceGamesBlock(html, entryId, gjs);
    if (r.ok) {
      html = r.html;
      console.log(`   -> games 블록 치환 완료 (boxScore 보존: ${mergedGames.filter(m => m.boxScoreText).length}개)`);
      summary.push({
        entryId, status: 'ok',
        before: existing.length, after: mergedGames.length,
        newCount: newOnes.length, removedCount: removed.length,
        boxScorePreserved: mergedGames.filter(m => m.boxScoreText).length
      });
    } else {
      console.log(`   !! games 블록 치환 실패`);
      summary.push({ entryId, status: 'fail' });
    }
  }

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log('\n\n===== 요약 =====');
  console.log(JSON.stringify(summary, null, 2));
}

main();
