/**
 * 새로 추가된 3 게임의 박스스코어를 수집해 index.html 에 주입.
 *   - 2024_daedeok: 2024-10-01 파더앤썬 (seq=811, dbsa)
 *   - 2023_daedeok: 2023-12-02 대전블리자드야구단 (seq=436, dbsa)
 *   - 2023_daedeok: 2023-12-09 Wood Island (seq=454, dbsa)
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'fix_remaining');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const NEW_GAMES = [
  { entryId: '2024_daedeok', date: '2024-10-01', opponent: '파더앤썬', seq: '811', host: 'https://daedeokgu.dbsa.kr' },
  { entryId: '2023_daedeok', date: '2023-12-02', opponent: '대전블리자드야구단', seq: '436', host: 'https://daedeokgu.dbsa.kr' },
  { entryId: '2023_daedeok', date: '2023-12-09', opponent: 'Wood Island', seq: '454', host: 'https://daedeokgu.dbsa.kr' },
];

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function findEntrySpan(text, entryId) {
  const re = new RegExp(`id\\s*:\\s*['"]${entryId}['"]`);
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index;
  while (i > 0 && text[i] !== '{') i--;
  let depth = 1, j = i + 1;
  let inStr = false, strCh = '', esc2 = false;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (esc2) { esc2 = false; j++; continue; }
    if (c === '\\' && inStr) { esc2 = true; j++; continue; }
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
  let inStr = false, strCh = '', esc2 = false;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (esc2) { esc2 = false; j++; continue; }
    if (c === '\\' && inStr) { esc2 = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) depth--;
    j++;
  }
  return { start: startIdx, end: j };
}

async function scrapeBoxScore(page, host, seq) {
  const url = `${host}/schedule/getGameRecord.hs?gameScheduleSeq=${seq}&leagueCategory=NORMAL`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length < 5) return null;
    const result = {};
    const lsTable = tables[0];
    const lsRows = Array.from(lsTable.querySelectorAll('tr')).filter(r => r.querySelector('td'));
    const dataRows = lsRows.filter(tr => {
      const first = tr.children[0]?.textContent.trim();
      return first && first !== '팀명' && !/^[0-9]+회$/.test(first);
    });
    if (dataRows.length >= 2) {
      const parseRow = (tr) => {
        const cells = Array.from(tr.children).map(c => c.textContent.trim());
        const teamName = cells[0];
        const R = parseInt(cells[cells.length - 4]) || 0;
        const H = parseInt(cells[cells.length - 3]) || 0;
        const E = parseInt(cells[cells.length - 2]) || 0;
        const B = parseInt(cells[cells.length - 1]) || 0;
        const innings = cells.slice(1, cells.length - 4).map(c => c === '-' ? null : (parseInt(c) || 0));
        return { teamName, innings, R, H, E, B };
      };
      result.lineScore = { away: parseRow(dataRows[0]), home: parseRow(dataRows[1]) };
    }
    const hlRows = Array.from(tables[2].querySelectorAll('tr')).filter(r => r.querySelector('td'));
    const highlights = [];
    const cleanWs = (s) => s.replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    hlRows.forEach(tr => {
      const cells = Array.from(tr.children);
      if (cells.length === 3) {
        const awayVal = cleanWs(cells[0].textContent);
        const category = cleanWs(cells[1].textContent);
        const homeVal = cleanWs(cells[2].textContent);
        if (category === '팀명') return;
        highlights.push({ category, away: awayVal, home: homeVal });
      } else if (cells.length === 1) {
        const text = cleanWs(cells[0].textContent);
        if (text) highlights.push({ category: 'info', text });
      }
    });
    result.highlights = highlights;
    function parseBatting(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const batters = [];
      for (let i = 1; i < rows.length; i++) {
        const tr = rows[i];
        const ths = Array.from(tr.querySelectorAll('th'));
        const tds = Array.from(tr.querySelectorAll('td'));
        if (ths.length >= 3 && tds.length >= 7) {
          const order = parseInt(ths[0].textContent.trim()) || 0;
          const nameRaw = ths[1].textContent.trim();
          const pos = ths[2].textContent.trim();
          const nm = nameRaw.match(/^(.+?)\s*\((\d+)\)$/);
          const name = nm ? nm[1].trim() : nameRaw;
          const number = nm ? parseInt(nm[2]) : 0;
          const allTds = tds.map(td => td.textContent.trim());
          const stats = allTds.slice(allTds.length - 7);
          const inningResults = allTds.slice(0, allTds.length - 7).map(s => s.replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim());
          batters.push({ order, name, number, pos, inningResults,
            PA: parseInt(stats[0]) || 0, AB: parseInt(stats[1]) || 0, H: parseInt(stats[2]) || 0,
            RBI: parseInt(stats[3]) || 0, R: parseInt(stats[4]) || 0, SB: parseInt(stats[5]) || 0,
            AVG: stats[6] || '0.000' });
        }
      }
      return batters;
    }
    function parsePitching(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const pitchers = [];
      for (let i = 1; i < rows.length; i++) {
        const tr = rows[i];
        const ths = Array.from(tr.querySelectorAll('th'));
        const tds = Array.from(tr.querySelectorAll('td'));
        if (ths.length >= 2 && tds.length >= 13) {
          const nameRaw = ths[1].textContent.trim();
          const nm = nameRaw.match(/^(.+?)\s*\((\d+)\)$/);
          const name = nm ? nm[1].trim() : nameRaw;
          const number = nm ? parseInt(nm[2]) : 0;
          const tdVals = tds.map(td => td.textContent.trim());
          pitchers.push({ name, number,
            role: tdVals[0], decision: tdVals[1], IP: tdVals[2],
            BF: parseInt(tdVals[3]) || 0, NP: parseInt(tdVals[4]) || 0,
            AB: parseInt(tdVals[5]) || 0, H: parseInt(tdVals[6]) || 0, HR: parseInt(tdVals[7]) || 0,
            BB: parseInt(tdVals[8]) || 0, SO: parseInt(tdVals[9]) || 0,
            R: parseInt(tdVals[10]) || 0, ER: parseInt(tdVals[11]) || 0, ERA: tdVals[12] || '0.00' });
        }
      }
      return pitchers;
    }
    result.awayBatters = parseBatting(tables[3]);
    result.homeBatters = parseBatting(tables[4]);
    result.awayPitchers = parsePitching(tables[5]);
    result.homePitchers = parsePitching(tables[6]);
    return result;
  });
}

function buildBoxScoreJs(bs) {
  const awayName = bs.lineScore?.away?.teamName || '';
  const homeName = bs.lineScore?.home?.teamName || '';
  const isHome = /와인드업/.test(homeName);
  const ourLS = isHome ? bs.lineScore.home : bs.lineScore.away;
  const theirLS = isHome ? bs.lineScore.away : bs.lineScore.home;
  const maxInnings = Math.max(ourLS.innings.length, theirLS.innings.length);
  const innings = [];
  for (let i = 0; i < maxInnings; i++) {
    innings.push([ourLS.innings[i] ?? null, theirLS.innings[i] ?? null]);
  }
  const buildBatters = (arr) => '[' + (arr||[]).map(b => {
    const ir = JSON.stringify(b.inningResults || []);
    return `{order:${b.order},name:'${esc(b.name)}',number:${b.number},pos:'${esc(b.pos)}',inningResults:${ir},PA:${b.PA},AB:${b.AB},H:${b.H},RBI:${b.RBI},R:${b.R},SB:${b.SB},AVG:'${b.AVG}'}`;
  }).join(',') + ']';
  const buildPitchers = (arr) => '[' + (arr||[]).map(p => {
    return `{name:'${esc(p.name)}',number:${p.number},role:'${esc(p.role)}',decision:'${esc(p.decision)}',IP:'${esc(p.IP)}',BF:${p.BF},NP:${p.NP},AB:${p.AB},H:${p.H},HR:${p.HR},BB:${p.BB},SO:${p.SO},R:${p.R},ER:${p.ER},ERA:'${p.ERA}'}`;
  }).join(',') + ']';
  const buildHighlights = (hl) => {
    if (!hl || hl.length === 0) return '[]';
    return '[' + hl.map(h => {
      if (h.text) return `{category:'info',text:'${esc(h.text)}'}`;
      return `{category:'${esc(h.category)}',away:'${esc(h.away)}',home:'${esc(h.home)}'}`;
    }).join(',') + ']';
  };
  return `{innings:${JSON.stringify(innings)},` +
    `totals:{ourH:${ourLS.H},ourE:${ourLS.E},ourB:${ourLS.B},theirH:${theirLS.H},theirE:${theirLS.E},theirB:${theirLS.B}},` +
    `isHome:${isHome},` +
    `awayTeam:'${esc(isHome ? theirLS.teamName : ourLS.teamName)}',` +
    `homeTeam:'${esc(isHome ? ourLS.teamName : theirLS.teamName)}',` +
    `highlights:${buildHighlights(bs.highlights)},` +
    `awayBatters:${buildBatters(isHome ? bs.awayBatters : bs.homeBatters)},` +
    `homeBatters:${buildBatters(isHome ? bs.homeBatters : bs.awayBatters)},` +
    `awayPitchers:${buildPitchers(isHome ? bs.awayPitchers : bs.homePitchers)},` +
    `homePitchers:${buildPitchers(isHome ? bs.homePitchers : bs.awayPitchers)}` +
    `}`;
}

function insertBoxScoreForGame(html, entryId, targetDate, targetOpponent, boxScoreJs) {
  const span = findEntrySpan(html, entryId);
  if (!span) return { html, ok: false, reason: 'entry not found' };
  const entryText = html.substring(span.start, span.end);
  const gRe = /games\s*:\s*\{/;
  const gm = gRe.exec(entryText);
  if (!gm) return { html, ok: false, reason: 'games not found' };
  const braceStart = gm.index + gm[0].length - 1;
  const gSpan = findBalancedBlockAfter(entryText, braceStart);
  const gamesText = entryText.substring(gSpan.start, gSpan.end);

  // find game object by date+opponent
  let i = 1;
  while (i < gamesText.length - 1) {
    while (i < gamesText.length - 1 && /[\s,]/.test(gamesText[i])) i++;
    if (i >= gamesText.length - 1) break;
    const kMatch = /^g\d+\s*:\s*\{/.exec(gamesText.substring(i));
    if (!kMatch) break;
    const objStart = i + kMatch[0].length - 1;
    const objSpan = findBalancedBlockAfter(gamesText, objStart);
    const objText = gamesText.substring(objStart, objSpan.end);

    const dateM = /date:'([^']*)'/.exec(objText);
    const oppM = /opponent:'([^']*)'/.exec(objText);
    const date = dateM ? dateM[1] : '';
    const opp = oppM ? oppM[1] : '';
    if (date === targetDate && opp.replace(/\s+/g,'') === targetOpponent.replace(/\s+/g,'')) {
      // already has boxScore?
      if (/boxScore\s*:\s*\{/.test(objText)) {
        return { html, ok: false, reason: 'already has boxScore' };
      }
      // Insert ,boxScore:... before closing }
      const newObj = objText.slice(0, -1) + ',boxScore:' + boxScoreJs + '}';
      const newGamesText = gamesText.substring(0, objStart) + newObj + gamesText.substring(objSpan.end);
      const newEntryText = entryText.substring(0, gSpan.start) + newGamesText + entryText.substring(gSpan.end);
      return { html: html.substring(0, span.start) + newEntryText + html.substring(span.end), ok: true };
    }
    i = objSpan.end;
  }
  return { html, ok: false, reason: 'game not found' };
}

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  for (const g of NEW_GAMES) {
    console.log(`\n=== ${g.entryId} / ${g.date} vs ${g.opponent} (seq=${g.seq}) ===`);
    try {
      const bs = await scrapeBoxScore(page, g.host, g.seq);
      if (!bs || !bs.lineScore) { console.log(`  박스스코어 없음`); continue; }
      fs.writeFileSync(path.join(DEBUG_DIR, `bs_${g.entryId}_${g.seq}.json`), JSON.stringify(bs, null, 2), 'utf-8');
      console.log(`  batters: away ${bs.awayBatters?.length||0}, home ${bs.homeBatters?.length||0}`);
      const boxJs = buildBoxScoreJs(bs);
      const r = insertBoxScoreForGame(html, g.entryId, g.date, g.opponent, boxJs);
      if (r.ok) { html = r.html; console.log(`  -> 삽입 완료`); }
      else { console.log(`  !! 삽입 실패: ${r.reason}`); }
    } catch (e) {
      console.log(`  에러: ${e.message}`);
    }
  }

  await browser.close();
  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log('\n완료');
}

main().catch(e => { console.error(e); process.exit(1); });
