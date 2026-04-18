/**
 * 특정 리그(searchLeagueSeq)의 모든 경기를 가져온다.
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'tmp_games');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// entryId, host, teamSeq, year, searchLeagueSeq, label
const TARGETS = [
  { entryId: '2024_daedeok', host: 'https://daedeokgu.dbsa.kr', teamSeq: 24, year: 2024, searchLeagueSeq: '27', label: '토요부/토요A' },
  { entryId: '2023_daedeok', host: 'https://daedeokgu.dbsa.kr', teamSeq: 24, year: 2023, searchLeagueSeq: '7',  label: '대덕구협회장배/토요A조' },
  { entryId: '2023_sejong',  host: 'https://www.ksbsa.or.kr',    teamSeq: 93, year: 2023, searchLeagueSeq: '27', label: '토요4부/토요4부-A조' },
];

async function scrapeLeague(page, t) {
  console.log(`\n===== ${t.entryId} (leagueSeq=${t.searchLeagueSeq}, ${t.label}) =====`);

  // Navigate to the team's game record page
  const recordUrl = `${t.host}/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=${t.teamSeq}`;
  await page.goto(recordUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Submit form with searchLeagueSeq, wide date range, rowSize=300
  await page.evaluate(({ host, teamSeq, leagueSeq, year }) => {
    // Remove any existing hidden form
    document.querySelectorAll('form#scraper-form').forEach(f => f.remove());
    const form = document.createElement('form');
    form.id = 'scraper-form';
    form.method = 'GET';
    form.action = `${host}/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=${teamSeq}`;
    const fields = {
      num: '1',
      action: `/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=${teamSeq}`,
      leagueCategory: '',
      searchStartGameDate: `${year}-01-01`,
      searchEndGameDate: `${year}-12-31`,
      searchLeagueSeq: leagueSeq,
      rowSize: '300',
      searchYear: String(year),
      searchTopLeagueSeq: '',
      searchLowerLeagueSeq: ''
    };
    for (const [n, v] of Object.entries(fields)) {
      const i = document.createElement('input');
      i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i);
    }
    document.body.appendChild(form);
    form.submit();
  }, { host: t.host, teamSeq: t.teamSeq, leagueSeq: t.searchLeagueSeq, year: t.year });

  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    // rows in game list — last table or within .game-list
    const allTables = Array.from(document.querySelectorAll('table'));
    let target = null;
    for (const t of allTables) {
      const ths = Array.from(t.querySelectorAll('thead th, th')).map(th => th.textContent.trim()).join('|');
      if (/경기일시/.test(ths) && /리그/.test(ths) && /장소/.test(ths)) { target = t; break; }
    }
    if (!target) {
      // Try to locate by text content — rows containing dates and team names
      const candidates = allTables.filter(t => {
        const tb = t.querySelector('tbody') || t;
        const rows = tb.querySelectorAll('tr');
        return Array.from(rows).some(r => /\d{4}[-./]\d{2}[-./]\d{2}/.test(r.textContent));
      });
      if (candidates.length) target = candidates[candidates.length - 1];
    }
    if (!target) return { found: false, games: [] };
    const rows = Array.from((target.querySelector('tbody') || target).querySelectorAll('tr'));
    const games = [];
    for (const tr of rows) {
      const cells = Array.from(tr.children).map(c => c.textContent.replace(/\s+/g,' ').trim());
      if (!cells.length) continue;
      if (!/\d{4}[-./]\d{2}[-./]\d{2}/.test(cells.join(' '))) continue;
      // Extract link (gameScheduleSeq)
      const a = tr.querySelector('a[href*="gameScheduleSeq"]');
      let seq = null, leagueCategory = null;
      if (a) {
        const sm = a.href.match(/gameScheduleSeq=(\d+)/);
        if (sm) seq = sm[1];
        const lc = a.href.match(/leagueCategory=([A-Z_]+)/);
        if (lc) leagueCategory = lc[1];
      }
      games.push({ cells, gameScheduleSeq: seq, leagueCategory, href: a?.href || null });
    }
    return { found: true, games };
  });

  console.log(`  rows: ${info.games.length}`);
  return info.games;
}

function parseGames(rawGames, host) {
  // rawGames: [{ cells: [...], gameScheduleSeq, leagueCategory, href }]
  // Column layout observed (daedeokgu example earlier): typically
  //   경기일시 | 리그 | 장소 | 경기 (holding score info) | link
  const out = [];
  for (const r of rawGames) {
    const cells = r.cells;
    // Find the date cell
    let dateStr = '', time = '';
    for (const c of cells) {
      const m = c.match(/(\d{4})[-./](\d{2})[-./](\d{2})\s*(\d{2}:\d{2})?/);
      if (m) {
        dateStr = `${m[1]}-${m[2]}-${m[3]}`;
        time = m[4] || '';
        break;
      }
    }
    if (!dateStr) continue;

    // The "경기" cell often contains "팀A 점수 vs 팀B 점수" or similar
    // Try to find text like "와인드업" and parse
    const joined = cells.join(' ');

    // Try various patterns: "A N vs B M" or "A N - B M"
    // Look for "와인드업" position and scores
    let lName = '', lScore = 0, rName = '', rScore = 0;
    let matchCell = '';
    for (const c of cells) {
      if (/와인드업/.test(c)) { matchCell = c; break; }
    }
    if (matchCell) {
      // Patterns like "와인드업 12 vs 2 대전파이터스" or "와인드업 12 - 대전파이터스 2"
      const m1 = matchCell.match(/^(.+?)\s+(\d+)\s*(?:vs|:|-)\s*(\d+)\s+(.+?)$/);
      const m2 = matchCell.match(/^(.+?)\s+(\d+)\s*(?:vs|:|-)\s*(.+?)\s+(\d+)$/);
      if (m1) {
        lName = m1[1].trim(); lScore = parseInt(m1[2]); rScore = parseInt(m1[3]); rName = m1[4].trim();
      } else if (m2) {
        lName = m2[1].trim(); lScore = parseInt(m2[2]); rName = m2[3].trim(); rScore = parseInt(m2[4]);
      } else {
        // Try extracting numbers
        const parts = matchCell.split(/\s+/);
        const numsIdx = parts.map((p, i) => /^\d+$/.test(p) ? i : -1).filter(i => i >= 0);
        if (numsIdx.length >= 2) {
          lScore = parseInt(parts[numsIdx[0]]);
          rScore = parseInt(parts[numsIdx[1]]);
          lName = parts.slice(0, numsIdx[0]).join(' ');
          rName = parts.slice(numsIdx[0] + 1, numsIdx[1]).concat(parts.slice(numsIdx[1] + 1)).join(' ');
        }
      }
    }

    // Determine windup side
    const isWindupL = /와인드업/.test(lName);
    const isWindupR = /와인드업/.test(rName);
    if (!isWindupL && !isWindupR) {
      // Can't determine — skip
      continue;
    }
    const opponent = isWindupL ? rName : lName;
    const ourScore = isWindupL ? lScore : rScore;
    const theirScore = isWindupL ? rScore : lScore;
    let result = '무';
    if (ourScore > theirScore) result = '승';
    else if (ourScore < theirScore) result = '패';

    // Location: typically another cell
    let location = '';
    for (const c of cells) {
      if (/(?:야구장|공원|운동장|그라운드|경기장|구장)$/.test(c)) { location = c.trim(); break; }
      // strip leading whitespace
      const m = c.match(/([\w\s가-힣()]+(?:야구장|공원|운동장|그라운드|경기장|구장))/);
      if (m && m[1].length < 50) { location = m[1].trim(); break; }
    }

    const leagueCat = r.leagueCategory || 'NORMAL';
    const boxScoreUrl = r.gameScheduleSeq
      ? `${host}/schedule/getGameRecord.hs?gameScheduleSeq=${r.gameScheduleSeq}&leagueCategory=${leagueCat}`
      : '';

    out.push({
      date: dateStr, time,
      opponent, ourScore, theirScore, result,
      location,
      gameScheduleSeq: r.gameScheduleSeq,
      leagueCategory: leagueCat,
      boxScoreUrl,
      rawCells: cells
    });
  }
  return out;
}

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const all = {};
  for (const t of TARGETS) {
    const rawGames = await scrapeLeague(page, t);
    // Save raw for debug
    fs.writeFileSync(path.join(OUT_DIR, `raw_${t.entryId}.json`), JSON.stringify(rawGames, null, 2), 'utf-8');

    const parsed = parseGames(rawGames, t.host);
    parsed.sort((a, b) => a.date.localeCompare(b.date));
    fs.writeFileSync(path.join(OUT_DIR, `tmp_games_${t.entryId}.json`), JSON.stringify(parsed, null, 2), 'utf-8');
    all[t.entryId] = parsed;
    console.log(`\n[${t.entryId}] 파싱 결과: ${parsed.length}경기`);
    parsed.forEach(p => console.log(`  ${p.date} vs ${p.opponent} ${p.ourScore}-${p.theirScore} ${p.result} seq=${p.gameScheduleSeq}`));
  }

  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
