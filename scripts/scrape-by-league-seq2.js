/**
 * v2: 실제 UI 상호작용으로 searchLeagueSeq 선택 후 검색
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'tmp_games');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const TARGETS = [
  { entryId: '2024_daedeok', host: 'https://daedeokgu.dbsa.kr', teamSeq: 24, year: 2024, leagueText: '토요부 / 토요A (2024)', label: '토요부/토요A' },
  { entryId: '2023_daedeok', host: 'https://daedeokgu.dbsa.kr', teamSeq: 24, year: 2023, leagueText: '대덕구협회장배 / 토요A조 (2023)', label: '대덕구협회장배/토요A조' },
  { entryId: '2023_sejong',  host: 'https://www.ksbsa.or.kr',    teamSeq: 93, year: 2023, leagueText: '토요4부 / 토요4부-A조 (2023)', label: '토요4부/토요4부-A조' },
];

async function scrape(page, t) {
  console.log(`\n===== ${t.entryId} (${t.leagueText}) =====`);
  const url = `${t.host}/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=${t.teamSeq}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Debug: screenshot page to see what's there
  const debugShot = path.join(OUT_DIR, `dbg_${t.entryId}_initial.png`);
  await page.screenshot({ path: debugShot, fullPage: true }).catch(() => {});

  // Check if a select or list of leagues exists
  const selectInfo = await page.evaluate(() => {
    const sel = document.querySelector('select[name="searchLeagueSeq"]');
    if (!sel) return { selFound: false, bodyText: document.body.textContent.slice(0, 500) };
    const opts = Array.from(sel.querySelectorAll('option')).map(o => ({ v: o.value, t: o.textContent.trim() }));
    return { selFound: true, opts };
  });
  console.log('  select options:', JSON.stringify(selectInfo).slice(0, 500));

  if (!selectInfo.selFound) {
    console.log('  select not found — abort');
    return [];
  }

  // Find the matching option
  const match = selectInfo.opts.find(o => o.t.replace(/\s+/g,'').includes(t.leagueText.replace(/\s+/g,'')));
  if (!match) {
    console.log(`  league not found for "${t.leagueText}" — options:`, selectInfo.opts.map(o => o.t).join(' | '));
    return [];
  }
  console.log(`  matched option: ${match.v} = ${match.t}`);

  // Set value, set date range, rowSize, then submit
  await page.evaluate(({ sv, year }) => {
    const sel = document.querySelector('select[name="searchLeagueSeq"]');
    sel.value = sv;
    const rowSize = document.querySelector('select[name="rowSize"]');
    if (rowSize) rowSize.value = '300';
    const startDate = document.querySelector('input[name="searchStartGameDate"]');
    if (startDate) startDate.value = `${year}-01-01`;
    const endDate = document.querySelector('input[name="searchEndGameDate"]');
    if (endDate) endDate.value = `${year}-12-31`;
  }, { sv: match.v, year: t.year });

  // Find search button
  const submitted = await page.evaluate(() => {
    // Try button with text 검색 or button.btn-search
    const btns = Array.from(document.querySelectorAll('button, input[type=submit], a.btn, a'));
    for (const b of btns) {
      const txt = b.textContent.trim();
      if (/^검색$/.test(txt) || /검색하기/.test(txt)) {
        b.click(); return true;
      }
    }
    // Fallback: submit form containing searchLeagueSeq
    const sel = document.querySelector('select[name="searchLeagueSeq"]');
    if (sel && sel.form) { sel.form.submit(); return true; }
    return false;
  });
  if (!submitted) { console.log('  search button 없음'); return []; }

  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  // Screenshot after search
  await page.screenshot({ path: path.join(OUT_DIR, `dbg_${t.entryId}_after.png`), fullPage: true }).catch(() => {});

  // Extract rows
  const info = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    let target = null;
    for (const t of tables) {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      const headerText = ths.join('|');
      if (/경기일시/.test(headerText) && /리그/.test(headerText) && /장소/.test(headerText)) { target = t; break; }
    }
    if (!target) {
      return { found: false, tablesCount: tables.length, tablesTh: tables.map(t => Array.from(t.querySelectorAll('th')).map(x => x.textContent.trim()).join('|').slice(0,300)) };
    }
    const rows = Array.from((target.querySelector('tbody') || target).querySelectorAll('tr'));
    const games = [];
    for (const tr of rows) {
      const cells = Array.from(tr.children).map(c => c.textContent.replace(/\s+/g,' ').trim());
      if (!cells.length) continue;
      const a = tr.querySelector('a[href*="gameScheduleSeq"]');
      if (!a && !/\d{4}[-./]\d{2}[-./]\d{2}/.test(cells.join(' '))) continue;
      let seq = null, leagueCategory = null;
      if (a) {
        const sm = a.href.match(/gameScheduleSeq=(\d+)/);
        if (sm) seq = sm[1];
        const lc = a.href.match(/leagueCategory=([A-Z_]+)/);
        if (lc) leagueCategory = lc[1];
      }
      games.push({ cells, gameScheduleSeq: seq, leagueCategory, href: a?.href || null });
    }
    return { found: true, games, rowCount: rows.length };
  });
  console.log(`  table found: ${info.found}, rows: ${info.rowCount || 0}, games: ${info.games?.length || 0}`);
  if (!info.found) {
    console.log('  tables th list:', JSON.stringify(info.tablesTh).slice(0, 500));
    return [];
  }
  return info.games;
}

function parseGames(rawGames, host) {
  const out = [];
  for (const r of rawGames) {
    const cells = r.cells;
    let dateStr = '', time = '';
    for (const c of cells) {
      const m = c.match(/(\d{4})[-./](\d{2})[-./](\d{2})\s*(\d{2}:\d{2})?/);
      if (m) { dateStr = `${m[1]}-${m[2]}-${m[3]}`; time = m[4] || ''; break; }
    }
    if (!dateStr) continue;

    let lName = '', lScore = 0, rName = '', rScore = 0;
    let matchCell = '';
    for (const c of cells) {
      if (/와인드업/.test(c) && /\d+/.test(c)) { matchCell = c; break; }
    }
    if (matchCell) {
      // strip trailing annotations like "콜드승", "몰수승"
      let txt = matchCell.replace(/\s+(콜드승|콜드패|몰수승|몰수패|기권승|기권패|추첨승|추첨패)\s*$/, '').trim();
      // Pattern: "TeamA N VS M TeamB"
      let m = txt.match(/^(.+?)\s+(\d+)\s+VS\s+(\d+)\s+(.+?)$/);
      if (!m) m = txt.match(/^(.+?)\s+(\d+)\s*(?:vs|:|-)\s*(\d+)\s+(.+?)$/i);
      if (m) {
        lName = m[1].trim(); lScore = parseInt(m[2]); rScore = parseInt(m[3]); rName = m[4].trim();
      } else {
        const parts = txt.split(/\s+/);
        const numsIdx = parts.map((p, i) => /^\d+$/.test(p) ? i : -1).filter(i => i >= 0);
        if (numsIdx.length >= 2) {
          lScore = parseInt(parts[numsIdx[0]]);
          rScore = parseInt(parts[numsIdx[numsIdx.length - 1]]);
          lName = parts.slice(0, numsIdx[0]).join(' ');
          rName = parts.slice(numsIdx[0] + 1, numsIdx[numsIdx.length - 1]).filter(x => x !== 'VS' && x !== 'vs').join(' ');
        }
      }
    }

    const isWindupL = /와인드업/.test(lName);
    const isWindupR = /와인드업/.test(rName);
    if (!isWindupL && !isWindupR) continue;

    const opponent = isWindupL ? rName : lName;
    const ourScore = isWindupL ? lScore : rScore;
    const theirScore = isWindupL ? rScore : lScore;
    let result = '무';
    if (ourScore > theirScore) result = '승';
    else if (ourScore < theirScore) result = '패';

    let location = '';
    for (const c of cells) {
      if (/(?:야구장|공원|운동장|그라운드|경기장|구장)/.test(c) && c.length < 50) { location = c.trim(); break; }
    }
    const leagueCat = r.leagueCategory || 'NORMAL';
    const boxScoreUrl = r.gameScheduleSeq
      ? `${host}/schedule/getGameRecord.hs?gameScheduleSeq=${r.gameScheduleSeq}&leagueCategory=${leagueCat}`
      : '';
    out.push({ date: dateStr, time, opponent, ourScore, theirScore, result, location, gameScheduleSeq: r.gameScheduleSeq, leagueCategory: leagueCat, boxScoreUrl, rawCells: cells });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  for (const t of TARGETS) {
    try {
      const raw = await scrape(page, t);
      fs.writeFileSync(path.join(OUT_DIR, `raw_${t.entryId}.json`), JSON.stringify(raw, null, 2), 'utf-8');
      const parsed = parseGames(raw, t.host);
      parsed.sort((a, b) => a.date.localeCompare(b.date));
      fs.writeFileSync(path.join(OUT_DIR, `tmp_games_${t.entryId}.json`), JSON.stringify(parsed, null, 2), 'utf-8');
      console.log(`\n[${t.entryId}] 파싱 결과: ${parsed.length}경기`);
      parsed.forEach(p => console.log(`  ${p.date} vs ${p.opponent} ${p.ourScore}-${p.theirScore} ${p.result} seq=${p.gameScheduleSeq}`));
    } catch (e) {
      console.error(`[${t.entryId}] error:`, e.message);
    }
  }

  await browser.close();
})();
