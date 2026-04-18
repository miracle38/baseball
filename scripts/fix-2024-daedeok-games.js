/**
 * Phase 2 보정 스크립트 — 2024_daedeok 의 games 를 daedeokgu.dbsa.kr 에서 재수집
 *
 * 기존 scrape-ksbsa-2023-2024-2026.js 의 daedeokgu 경로를 차용해 2024년 대상으로만 실행.
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'daedeok2024');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const ENTRY_ID = '2024_daedeok';
const BASE_URL = 'https://daedeokgu.dbsa.kr';
const TEAM_SEQ = 24;
const YEAR = 2024;

async function navigateToMonth(page, year, month) {
  await page.evaluate(({ yr, mo }) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=24`;
    [['thisYear', yr], ['thisMonth', String(mo).padStart(2, '0')], ['thisDay', '01']].forEach(([n, v]) => {
      const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i);
    });
    document.body.appendChild(form);
    form.submit();
  }, { yr: String(year), mo: month });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function getGameDates(page) {
  return await page.evaluate(() => {
    const dates = [];
    document.querySelectorAll('td a.el-cal-item').forEach(a => {
      const dateP = a.querySelector('.date');
      const matchP = a.querySelector('.match');
      if (dateP && matchP && /\+\d/.test(matchP.textContent)) {
        dates.push(parseInt(dateP.textContent.trim()));
      }
    });
    return dates;
  });
}

async function clickDateAndGetGames(page, day) {
  await page.evaluate(({ day }) => {
    const calCells = document.querySelectorAll('td a.el-cal-item');
    for (const a of calCells) {
      const d = a.querySelector('.date');
      if (d && parseInt(d.textContent.trim()) === day) { a.click(); return; }
    }
  }, { day });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);
  return await page.evaluate(() => {
    const games = [];
    const matchWrap = document.querySelector('.match-list-wrap');
    if (!matchWrap) return games;
    const matchLists = matchWrap.querySelectorAll('.match-list');
    matchLists.forEach(ml => {
      const teamMatch = ml.querySelector('.team-match');
      if (!teamMatch) return;
      const fullText = ml.textContent.replace(/\s+/g, ' ').trim();
      const dateMatch = fullText.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2}:\d{2})/);
      const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
      const time = dateMatch ? dateMatch[4] : '';
      const lTeam = teamMatch.querySelector('.l-team');
      const rTeam = teamMatch.querySelector('.r-team');
      const getTeam = (el) => {
        if (!el) return { name: '', score: 0 };
        const info = el.querySelector('.team-info');
        const name = info ? info.textContent.trim().replace(/\d+$/, '').trim() : el.textContent.replace(/\d+/g, '').trim();
        const scoreEl = el.querySelector('.team-score, .score');
        let score = 0;
        if (scoreEl) score = parseInt(scoreEl.textContent.trim()) || 0;
        else { const nums = el.textContent.match(/(\d+)\s*$/); score = nums ? parseInt(nums[1]) : 0; }
        return { name, score };
      };
      const L = getTeam(lTeam), R = getTeam(rTeam);
      let league = '';
      const leagueEl = ml.querySelector('.league-name, .match-league');
      if (leagueEl) league = leagueEl.textContent.trim();
      let location = '';
      const locMatch = fullText.match(/([\w\s가-힣()]+(?:야구장|공원|운동장|그라운드|경기장|구장))/);
      if (locMatch) location = locMatch[1].trim();
      let gameScheduleSeq = null;
      const detailLink = ml.querySelector('a[href*="gameScheduleSeq"]');
      if (detailLink) {
        const sm = detailLink.href.match(/gameScheduleSeq=(\d+)/);
        if (sm) gameScheduleSeq = sm[1];
      }
      games.push({ date, time, location, league, lName: L.name, lScore: L.score, rName: R.name, rScore: R.score, gameScheduleSeq, rawText: fullText.slice(0, 250) });
    });
    return games;
  });
}

async function scrapeBoxScore(page, seq) {
  const url = `${BASE_URL}/schedule/getGameRecord.hs?gameScheduleSeq=${seq}&leagueCategory=NORMAL`;
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

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

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

function gamesToJs(games) {
  if (!games || !games.length) return '{}';
  return '{' + games.map((g, i) => {
    const opp = esc(g.opponent);
    const loc = esc(g.location);
    const url = esc(g.boxScoreUrl || '');
    const bsStr = g.boxScoreJs ? `,boxScore:${g.boxScoreJs}` : '';
    const urlStr = url ? `,boxScoreUrl:'${url}'` : '';
    return `g${i+1}:{date:'${g.date}',opponent:'${opp}',ourScore:${g.ourScore},theirScore:${g.theirScore},result:'${g.result}',location:'${loc}'${urlStr}${bsStr}}`;
  }).join(',') + '}';
}

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

function replaceGamesBlock(html, entryId, newGamesJs) {
  const span = findEntrySpan(html, entryId);
  if (!span) return { html, ok: false };
  const entryText = html.substring(span.start, span.end);
  const re = /games\s*:\s*\{/;
  const m = re.exec(entryText);
  if (!m) return { html, ok: false };
  let depth = 1, j = m.index + m[0].length;
  let inStr = false, strCh = '', esc2 = false;
  while (j < entryText.length && depth > 0) {
    const c = entryText[j];
    if (esc2) { esc2 = false; j++; continue; }
    if (c === '\\' && inStr) { esc2 = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    j++;
  }
  const newEntryText = entryText.substring(0, m.index) + 'games:' + newGamesJs + entryText.substring(j);
  return { html: html.substring(0, span.start) + newEntryText + html.substring(span.end), ok: true };
}

async function main() {
  console.log('=== Phase 2: 2024_daedeok games 재수집 ===\n');
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // Initial load
  await page.goto(`${BASE_URL}/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=${TEAM_SEQ}`, {
    waitUntil: 'networkidle', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(1000);

  const collected = [];
  for (const month of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    console.log(`--- 2024년 ${month}월 ---`);
    await navigateToMonth(page, YEAR, month);
    const days = await getGameDates(page);
    if (days.length === 0) { console.log('  경기 없음'); continue; }
    console.log(`  날짜: ${days.join(', ')}`);
    for (const day of days) {
      await navigateToMonth(page, YEAR, month);
      await page.waitForTimeout(400);
      const games = await clickDateAndGetGames(page, day);
      for (const g of games) {
        const isWindupL = /와인드업/.test(g.lName);
        const isWindupR = /와인드업/.test(g.rName);
        if (!isWindupL && !isWindupR) { console.log(`    [SKIP] non-windup: ${g.rawText?.slice(0,80)}`); continue; }
        const opponent = isWindupL ? g.rName : g.lName;
        const ourScore = isWindupL ? g.lScore : g.rScore;
        const theirScore = isWindupL ? g.rScore : g.lScore;
        let result = '무';
        if (ourScore > theirScore) result = '승';
        else if (ourScore < theirScore) result = '패';
        console.log(`    ${g.date} vs ${opponent} ${ourScore}-${theirScore} ${result} seq=${g.gameScheduleSeq}`);
        collected.push({
          date: g.date, opponent, ourScore, theirScore, result,
          location: g.location || '',
          gameScheduleSeq: g.gameScheduleSeq,
          boxScoreUrl: g.gameScheduleSeq ? `${BASE_URL}/schedule/getGameRecord.hs?gameScheduleSeq=${g.gameScheduleSeq}&leagueCategory=NORMAL` : ''
        });
      }
    }
  }

  console.log(`\n총 ${collected.length} 경기 수집\n`);
  fs.writeFileSync(path.join(DEBUG_DIR, 'collected.json'), JSON.stringify(collected, null, 2), 'utf-8');

  // Sort by date
  collected.sort((a, b) => a.date.localeCompare(b.date));

  // Scrape box scores
  console.log('--- 박스스코어 수집 ---');
  for (const g of collected) {
    if (!g.gameScheduleSeq) { console.log(`  [SKIP] ${g.date} no seq`); continue; }
    try {
      const bs = await scrapeBoxScore(page, g.gameScheduleSeq);
      if (!bs || !bs.lineScore) { console.log(`  ${g.date} bs 없음`); continue; }
      fs.writeFileSync(path.join(DEBUG_DIR, `bs_${g.gameScheduleSeq}.json`), JSON.stringify(bs, null, 2), 'utf-8');
      g.boxScoreJs = buildBoxScoreJs(bs);
      console.log(`  ${g.date} bs ok (away ${bs.awayBatters?.length||0}, home ${bs.homeBatters?.length||0} 타자)`);
    } catch (e) { console.log(`  ${g.date} bs 에러: ${e.message}`); }
  }

  await browser.close();

  // Update html
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const gjs = gamesToJs(collected);
  const r = replaceGamesBlock(html, ENTRY_ID, gjs);
  if (r.ok) {
    fs.writeFileSync(INDEX_FILE, r.html, 'utf-8');
    console.log(`\n[OK] ${ENTRY_ID}: ${collected.length}경기 games 블록 치환 완료`);
  } else {
    console.log(`\n[FAIL] ${ENTRY_ID}: games 블록 찾지 못함`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
