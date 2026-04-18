/**
 * ksbsa.or.kr / donggu.dbsa.kr 경기 및 박스스코어 스크래퍼
 * Phase 1: 2023, 2024, 2026 경기 일정 수집 (gameScheduleSeq 포함)
 * Phase 2: 박스스코어 수집
 * Phase 3: index.html 업데이트
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'ksbsa', 'boxscores');

if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

// ==================== League matching ====================

function matchLeagueKsbsa(leagueText, year) {
  const t = leagueText || '';
  if (year === 2023) {
    if (/인터리그/.test(t)) return '2023_sejong_inter';
    if (/플레이오프|PO/.test(t)) return '2023_sejong_po';
    if (/토요리그|토요\d부/.test(t)) return '2023_sejong';
    // fallback: if it's a regular league game
    return '2023_sejong';
  }
  if (year === 2024) {
    if (/토요리그|토요\d부/.test(t)) return '2024_sejong';
    return '2024_sejong';
  }
  if (year === 2026) {
    if (/토요리그|토요\d부/.test(t)) return '2026_sejong';
    return '2026_sejong';
  }
  return null;
}

// ==================== Calendar navigation (ksbsa) ====================

async function navigateToMonth(page, year, month, teamSeq = 93) {
  const baseUrl = teamSeq === 93
    ? 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93'
    : `https://donggu.dbsa.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=${teamSeq}`;

  await page.evaluate(({yr, mo, url}) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = url.includes('?') ? url.split('?')[0] + '?' + url.split('?')[1] : url;
    // Actually use relative path
    const pathPart = new URL(url).pathname + '?' + new URL(url).search.slice(1);
    form.action = url;
    [['thisYear', yr], ['thisMonth', String(mo).padStart(2, '0')], ['thisDay', '01']].forEach(([n, v]) => {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = n; input.value = v;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }, {yr: String(year), mo: month, url: baseUrl});
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function getGameDatesFromCalendar(page) {
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
  await page.evaluate(({day}) => {
    const calCells = document.querySelectorAll('td a.el-cal-item');
    for (const a of calCells) {
      const dateP = a.querySelector('.date');
      if (dateP && parseInt(dateP.textContent.trim()) === day) {
        a.click();
        return;
      }
    }
  }, {day});
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const games = [];
    const matchWrap = document.querySelector('.match-list-wrap');
    if (!matchWrap) return games;

    // Try to find all match-list items
    const matchLists = matchWrap.querySelectorAll('.match-list');
    if (matchLists.length > 0) {
      matchLists.forEach(ml => {
        const teamMatch = ml.querySelector('.team-match');
        if (!teamMatch) return;
        const fullText = ml.textContent.replace(/\s+/g, ' ').trim();

        // Date/time
        const dateMatch = fullText.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2}:\d{2})/);
        const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
        const time = dateMatch ? dateMatch[4] : '';

        // Teams and scores
        const lTeam = teamMatch.querySelector('.l-team');
        const rTeam = teamMatch.querySelector('.r-team');
        let lTeamName = '', lScore = 0, rTeamName = '', rScore = 0;

        if (lTeam) {
          const info = lTeam.querySelector('.team-info');
          lTeamName = info ? info.textContent.trim().replace(/\d+$/, '').trim() : lTeam.textContent.replace(/\d+/g, '').trim();
          const scoreEl = lTeam.querySelector('.team-score, .score');
          if (scoreEl) {
            lScore = parseInt(scoreEl.textContent.trim()) || 0;
          } else {
            const nums = lTeam.textContent.match(/(\d+)\s*$/);
            lScore = nums ? parseInt(nums[1]) : 0;
          }
        }
        if (rTeam) {
          const info = rTeam.querySelector('.team-info');
          rTeamName = info ? info.textContent.trim().replace(/\d+$/, '').trim() : rTeam.textContent.replace(/\d+/g, '').trim();
          const scoreEl = rTeam.querySelector('.team-score, .score');
          if (scoreEl) {
            rScore = parseInt(scoreEl.textContent.trim()) || 0;
          } else {
            const nums = rTeam.textContent.match(/(\d+)\s*$/);
            rScore = nums ? parseInt(nums[1]) : 0;
          }
        }

        // League
        let league = '';
        const leagueEl = ml.querySelector('.league-name, .match-league');
        if (leagueEl) {
          league = leagueEl.textContent.trim();
        } else {
          const leagueMatch = fullText.match(/(토요리그\s*-\s*[^\s,]+|인터리그\s*-\s*[^\s,]+|시장기\s*-\s*[^\s,]+|협회장기\s*-\s*[^\s,]+)/);
          if (leagueMatch) league = leagueMatch[1];
        }

        // Location
        let location = '';
        const locMatch = fullText.match(/([\w\s가-힣()]+(?:야구장|공원|운동장|그라운드|경기장|구장|고$))/);
        if (locMatch) location = locMatch[1].trim();

        // gameScheduleSeq
        let gameScheduleSeq = null;
        const detailLink = ml.querySelector('a[href*="gameScheduleSeq"]');
        if (detailLink) {
          const seqMatch = detailLink.href.match(/gameScheduleSeq=(\d+)/);
          if (seqMatch) gameScheduleSeq = seqMatch[1];
        }

        games.push({
          date, time, location, league,
          lTeamName, lScore, rTeamName, rScore,
          gameScheduleSeq,
          rawText: fullText.slice(0, 300)
        });
      });
    }

    // Fallback: try .team-match directly
    if (games.length === 0) {
      const matches = matchWrap.querySelectorAll('.team-match');
      matches.forEach(match => {
        const fullText = matchWrap.textContent.replace(/\s+/g, ' ').trim();
        const dateMatch = fullText.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2}:\d{2})/);
        const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';

        const lTeam = match.querySelector('.l-team');
        const rTeam = match.querySelector('.r-team');
        let lTeamName = '', lScore = 0, rTeamName = '', rScore = 0;
        if (lTeam) {
          lTeamName = lTeam.textContent.replace(/\d+/g, '').trim();
          const nums = lTeam.textContent.match(/(\d+)/);
          lScore = nums ? parseInt(nums[1]) : 0;
        }
        if (rTeam) {
          rTeamName = rTeam.textContent.replace(/\d+/g, '').trim();
          const nums = rTeam.textContent.match(/(\d+)/);
          rScore = nums ? parseInt(nums[1]) : 0;
        }

        const link = matchWrap.querySelector('a[href*="gameScheduleSeq"]');
        let gameScheduleSeq = link ? link.href.match(/gameScheduleSeq=(\d+)/)?.[1] : null;

        games.push({
          date, lTeamName, lScore, rTeamName, rScore, gameScheduleSeq,
          rawText: fullText.slice(0, 300)
        });
      });
    }

    return games;
  });
}

// ==================== Box score scraping ====================

async function scrapeBoxScore(page, seq, baseUrl) {
  const host = baseUrl || 'https://www.ksbsa.or.kr';
  const url = `${host}/schedule/getGameRecord.hs?gameScheduleSeq=${seq}&leagueCategory=NORMAL`;
  console.log(`  Fetching: ${url}`);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length < 5) return null;

    const result = {};

    // === TABLE 0: Line Score ===
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
      const away = parseRow(dataRows[0]);
      const home = parseRow(dataRows[1]);
      result.lineScore = { away, home };
    }

    // === TABLE 1: Game Info ===
    const infoTable = tables[1];
    const infoRow = infoTable.querySelector('tr td') ? Array.from(infoTable.querySelectorAll('tr')).filter(r => r.querySelector('td'))[0] : null;
    if (infoRow) {
      const cells = Array.from(infoRow.children).map(c => c.textContent.trim());
      result.gameInfo = {
        date: cells[0] || '',
        time: cells[1] || '',
        location: cells[2] || '',
        matchup: cells[3] || '',
        status: cells[4] || ''
      };
    }

    // === TABLE 2: Highlights ===
    const hlTable = tables[2];
    const hlRows = Array.from(hlTable.querySelectorAll('tr')).filter(r => r.querySelector('td'));
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

    // === Helper: parse batting table ===
    function parseBattingTable(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const batters = [];
      let totalRow = null;
      for (let i = 1; i < rows.length; i++) {
        const tr = rows[i];
        const ths = Array.from(tr.querySelectorAll('th'));
        const tds = Array.from(tr.querySelectorAll('td'));

        if (ths.length >= 3 && tds.length >= 7) {
          const order = parseInt(ths[0].textContent.trim()) || 0;
          const nameRaw = ths[1].textContent.trim();
          const pos = ths[2].textContent.trim();
          const nameMatch = nameRaw.match(/^(.+?)\s*\((\d+)\)$/);
          const name = nameMatch ? nameMatch[1].trim() : nameRaw;
          const number = nameMatch ? parseInt(nameMatch[2]) : 0;

          const allTds = tds.map(td => td.textContent.trim());
          const statsCount = 7;
          const inningResults = allTds.slice(0, allTds.length - statsCount)
            .map(s => s.replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim());
          const stats = allTds.slice(allTds.length - statsCount);

          batters.push({
            order, name, number, pos,
            inningResults,
            PA: parseInt(stats[0]) || 0,
            AB: parseInt(stats[1]) || 0,
            H: parseInt(stats[2]) || 0,
            RBI: parseInt(stats[3]) || 0,
            R: parseInt(stats[4]) || 0,
            SB: parseInt(stats[5]) || 0,
            AVG: stats[6] || '0.000'
          });
        } else if (tds.length >= 7 && ths.length === 0) {
          const allTds = tds.map(td => td.textContent.trim());
          const stats = allTds.slice(allTds.length - 7);
          totalRow = {
            PA: parseInt(stats[0]) || 0,
            AB: parseInt(stats[1]) || 0,
            H: parseInt(stats[2]) || 0,
            RBI: parseInt(stats[3]) || 0,
            R: parseInt(stats[4]) || 0,
            SB: parseInt(stats[5]) || 0,
            AVG: stats[6] || '0.000'
          };
        }
      }
      return { batters, total: totalRow };
    }

    // === Helper: parse pitching table ===
    function parsePitchingTable(table) {
      const rows = Array.from(table.querySelectorAll('tr'));
      const pitchers = [];
      let totalRow = null;
      for (let i = 1; i < rows.length; i++) {
        const tr = rows[i];
        const ths = Array.from(tr.querySelectorAll('th'));
        const tds = Array.from(tr.querySelectorAll('td'));

        if (ths.length >= 2 && tds.length >= 13) {
          const nameRaw = ths[1].textContent.trim();
          const nameMatch = nameRaw.match(/^(.+?)\s*\((\d+)\)$/);
          const name = nameMatch ? nameMatch[1].trim() : nameRaw;
          const number = nameMatch ? parseInt(nameMatch[2]) : 0;
          const tdVals = tds.map(td => td.textContent.trim());

          pitchers.push({
            name, number,
            role: tdVals[0],
            decision: tdVals[1],
            IP: tdVals[2],
            BF: parseInt(tdVals[3]) || 0,
            NP: parseInt(tdVals[4]) || 0,
            AB: parseInt(tdVals[5]) || 0,
            H: parseInt(tdVals[6]) || 0,
            HR: parseInt(tdVals[7]) || 0,
            BB: parseInt(tdVals[8]) || 0,
            SO: parseInt(tdVals[9]) || 0,
            R: parseInt(tdVals[10]) || 0,
            ER: parseInt(tdVals[11]) || 0,
            ERA: tdVals[12] || '0.00'
          });
        } else if (tds.length >= 13 && ths.length === 0) {
          const tdVals = tds.map(td => td.textContent.trim());
          const s = tdVals.slice(tdVals.length - 13);
          totalRow = {
            IP: s[0], BF: parseInt(s[1])||0, NP: parseInt(s[2])||0,
            AB: parseInt(s[3])||0, H: parseInt(s[4])||0, HR: parseInt(s[5])||0,
            BB: parseInt(s[6])||0, SO: parseInt(s[7])||0, R: parseInt(s[8])||0,
            ER: parseInt(s[9])||0, ERA: s[10]||'0.00'
          };
        }
      }
      return { pitchers, total: totalRow };
    }

    result.awayBatting = parseBattingTable(tables[3]);
    result.homeBatting = parseBattingTable(tables[4]);
    result.awayPitching = parsePitchingTable(tables[5]);
    result.homePitching = parsePitchingTable(tables[6]);

    return result;
  });
}

// ==================== HTML manipulation ====================

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

function replaceField(text, fieldRe, newValue) {
  const m = fieldRe.exec(text);
  if (!m) return null;
  const afterMatch = m.index + m[0].length;
  // Check what comes after the colon
  let startIdx = afterMatch - 1;
  const openChar = text[startIdx];
  if (openChar !== '{' && openChar !== '[') {
    // Simple value, find next comma or closing brace
    let k = afterMatch;
    while (k < text.length && !/[,}]/.test(text[k])) k++;
    return text.substring(0, m.index) + newValue + text.substring(k);
  }
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 1, k = startIdx + 1;
  let inStr = false, strCh = '', esc = false;
  while (k < text.length && depth > 0) {
    const c = text[k];
    if (esc) { esc = false; k++; continue; }
    if (c === '\\' && inStr) { esc = true; k++; continue; }
    if (inStr) { if (c === strCh) inStr = false; k++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; k++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) depth--;
    k++;
  }
  return text.substring(0, m.index) + newValue + text.substring(k);
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
    innings.push([
      ourLS.innings[i] != null ? ourLS.innings[i] : null,
      theirLS.innings[i] != null ? theirLS.innings[i] : null
    ]);
  }

  const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/\\/g, "\\\\");

  const buildBatters = (battingData) => {
    if (!battingData || !battingData.batters) return '[]';
    return '[' + battingData.batters.map(b => {
      const ir = JSON.stringify(b.inningResults || []);
      return `{order:${b.order},name:'${esc(b.name)}',number:${b.number},pos:'${esc(b.pos)}',inningResults:${ir},PA:${b.PA},AB:${b.AB},H:${b.H},RBI:${b.RBI},R:${b.R},SB:${b.SB},AVG:'${b.AVG}'}`;
    }).join(',') + ']';
  };

  const buildPitchers = (pitchingData) => {
    if (!pitchingData || !pitchingData.pitchers) return '[]';
    return '[' + pitchingData.pitchers.map(p => {
      return `{name:'${esc(p.name)}',number:${p.number},role:'${esc(p.role)}',decision:'${esc(p.decision)}',IP:'${esc(p.IP)}',BF:${p.BF},NP:${p.NP},AB:${p.AB},H:${p.H},HR:${p.HR},BB:${p.BB},SO:${p.SO},R:${p.R},ER:${p.ER},ERA:'${p.ERA}'}`;
    }).join(',') + ']';
  };

  const buildHighlights = (hl) => {
    if (!hl || hl.length === 0) return '[]';
    return '[' + hl.map(h => {
      if (h.text) return `{category:'info',text:'${esc(h.text)}'}`;
      return `{category:'${esc(h.category)}',away:'${esc(h.away)}',home:'${esc(h.home)}'}`;
    }).join(',') + ']';
  };

  const awayBatting = isHome ? bs.awayBatting : bs.homeBatting;
  const homeBatting = isHome ? bs.homeBatting : bs.awayBatting;
  const awayPitching = isHome ? bs.awayPitching : bs.homePitching;
  const homePitching = isHome ? bs.homePitching : bs.awayPitching;

  return `{` +
    `innings:${JSON.stringify(innings)},` +
    `totals:{ourH:${ourLS.H},ourE:${ourLS.E},ourB:${ourLS.B},theirH:${theirLS.H},theirE:${theirLS.E},theirB:${theirLS.B}},` +
    `isHome:${isHome},` +
    `awayTeam:'${esc(isHome ? theirLS.teamName : ourLS.teamName)}',` +
    `homeTeam:'${esc(isHome ? ourLS.teamName : theirLS.teamName)}',` +
    `highlights:${buildHighlights(bs.highlights)},` +
    `awayBatters:${buildBatters(awayBatting)},` +
    `homeBatters:${buildBatters(homeBatting)},` +
    `awayPitchers:${buildPitchers(awayPitching)},` +
    `homePitchers:${buildPitchers(homePitching)}` +
    `}`;
}

function gamesToJs(games) {
  if (!games || !games.length) return '{}';
  return '{' + games.map((g, i) => {
    const opp = (g.opponent || '').replace(/'/g, "\\'");
    const loc = (g.location || '').replace(/'/g, "\\'");
    const bsStr = g.boxScoreJs ? `,boxScore:${g.boxScoreJs}` : '';
    return `g${i+1}:{date:'${g.date}',opponent:'${opp}',ourScore:${g.ourScore},theirScore:${g.theirScore},result:'${g.result}',location:'${loc}'${bsStr}}`;
  }).join(',\n') + '}';
}

// ==================== Main ====================

async function main() {
  console.log('=== ksbsa/donggu 2023/2024/2026 경기 + 박스스코어 스크래퍼 ===\n');

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // ==================== Phase 1: Collect games from calendar ====================
  console.log('\n===== Phase 1: Calendar navigation =====\n');

  const allCollectedGames = [];

  // --- ksbsa (2023, 2024, 2026) ---
  const ksbsaYears = [
    { year: 2023, months: [3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { year: 2024, months: [3, 4, 5, 6, 7, 8, 9, 10, 11] },
    { year: 2026, months: [3, 4] }  // Only months that might have games so far
  ];

  // Initial page load
  await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93', {
    waitUntil: 'networkidle', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(1000);

  for (const {year, months} of ksbsaYears) {
    console.log(`\n--- ${year}년 (ksbsa) ---`);

    for (const month of months) {
      console.log(`\n=== ${year}년 ${month}월 ===`);
      await navigateToMonth(page, year, month, 93);

      const gameDates = await getGameDatesFromCalendar(page);
      if (gameDates.length === 0) {
        console.log('  경기 없음');
        continue;
      }
      console.log(`  경기 날짜: ${gameDates.join(', ')}일`);

      for (const day of gameDates) {
        await navigateToMonth(page, year, month, 93);
        await page.waitForTimeout(500);

        const games = await clickDateAndGetGames(page, day);
        console.log(`  ${month}/${day}: ${games.length}경기`);

        for (const g of games) {
          const isWindupLeft = /와인드업/.test(g.lTeamName);
          const isWindupRight = /와인드업/.test(g.rTeamName);

          if (!isWindupLeft && !isWindupRight) {
            console.log(`    [SKIP] 와인드업 없음: ${g.rawText?.slice(0, 100)}`);
            continue;
          }

          const opponent = isWindupLeft ? g.rTeamName : g.lTeamName;
          const ourScore = isWindupLeft ? g.lScore : g.rScore;
          const theirScore = isWindupLeft ? g.rScore : g.lScore;

          let result = '무';
          if (ourScore > theirScore) result = '승';
          else if (ourScore < theirScore) result = '패';

          const leagueText = g.league || g.rawText || '';
          const entryId = matchLeagueKsbsa(leagueText, year);

          console.log(`    ${g.date} vs ${opponent}: ${ourScore}-${theirScore} ${result} [${g.league || '?'}] => ${entryId} (seq:${g.gameScheduleSeq})`);

          allCollectedGames.push({
            date: g.date,
            opponent,
            ourScore,
            theirScore,
            result,
            location: g.location || '',
            league: g.league || '',
            entryId,
            gameScheduleSeq: g.gameScheduleSeq,
            source: 'ksbsa'
          });
        }
      }
    }
  }

  // --- donggu.dbsa.kr (2026) ---
  console.log(`\n--- 2026년 (donggu) ---`);
  await page.goto('https://donggu.dbsa.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=70', {
    waitUntil: 'networkidle', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(1000);

  for (const month of [3, 4]) {
    console.log(`\n=== 2026년 ${month}월 (donggu) ===`);
    await navigateToMonth(page, 2026, month, 70);

    const gameDates = await getGameDatesFromCalendar(page);
    if (gameDates.length === 0) {
      console.log('  경기 없음');
      continue;
    }
    console.log(`  경기 날짜: ${gameDates.join(', ')}일`);

    for (const day of gameDates) {
      await navigateToMonth(page, 2026, month, 70);
      await page.waitForTimeout(500);

      const games = await clickDateAndGetGames(page, day);
      console.log(`  ${month}/${day}: ${games.length}경기`);

      for (const g of games) {
        const isWindupLeft = /와인드업/.test(g.lTeamName);
        const isWindupRight = /와인드업/.test(g.rTeamName);

        if (!isWindupLeft && !isWindupRight) {
          console.log(`    [SKIP] 와인드업 없음: ${g.rawText?.slice(0, 100)}`);
          continue;
        }

        const opponent = isWindupLeft ? g.rTeamName : g.lTeamName;
        const ourScore = isWindupLeft ? g.lScore : g.rScore;
        const theirScore = isWindupLeft ? g.rScore : g.lScore;

        let result = '무';
        if (ourScore > theirScore) result = '승';
        else if (ourScore < theirScore) result = '패';

        console.log(`    ${g.date} vs ${opponent}: ${ourScore}-${theirScore} ${result} (seq:${g.gameScheduleSeq})`);

        allCollectedGames.push({
          date: g.date,
          opponent,
          ourScore,
          theirScore,
          result,
          location: g.location || '',
          league: '',
          entryId: '2026_donggu',
          gameScheduleSeq: g.gameScheduleSeq,
          source: 'donggu'
        });
      }
    }
  }

  // --- Also try daedeokgu.dbsa.kr (2023) ---
  console.log(`\n--- 2023년 (daedeokgu) ---`);
  await page.goto('https://daedeokgu.dbsa.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=24', {
    waitUntil: 'networkidle', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(1000);

  for (const month of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    console.log(`\n=== 2023년 ${month}월 (daedeokgu) ===`);

    await page.evaluate(({yr, mo}) => {
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=24';
      [['thisYear', yr], ['thisMonth', String(mo).padStart(2, '0')], ['thisDay', '01']].forEach(([n, v]) => {
        const input = document.createElement('input');
        input.type = 'hidden'; input.name = n; input.value = v;
        form.appendChild(input);
      });
      document.body.appendChild(form);
      form.submit();
    }, {yr: '2023', mo: month});
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const gameDates = await getGameDatesFromCalendar(page);
    if (gameDates.length === 0) {
      console.log('  경기 없음');
      continue;
    }
    console.log(`  경기 날짜: ${gameDates.join(', ')}일`);

    for (const day of gameDates) {
      // Navigate back to month first
      await page.evaluate(({yr, mo}) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=24';
        [['thisYear', yr], ['thisMonth', String(mo).padStart(2, '0')], ['thisDay', '01']].forEach(([n, v]) => {
          const input = document.createElement('input');
          input.type = 'hidden'; input.name = n; input.value = v;
          form.appendChild(input);
        });
        document.body.appendChild(form);
        form.submit();
      }, {yr: '2023', mo: month});
      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
      await page.waitForTimeout(500);

      const games = await clickDateAndGetGames(page, day);
      console.log(`  ${month}/${day}: ${games.length}경기`);

      for (const g of games) {
        const isWindupLeft = /와인드업/.test(g.lTeamName);
        const isWindupRight = /와인드업/.test(g.rTeamName);

        if (!isWindupLeft && !isWindupRight) {
          console.log(`    [SKIP] 와인드업 없음: ${g.rawText?.slice(0, 100)}`);
          continue;
        }

        const opponent = isWindupLeft ? g.rTeamName : g.lTeamName;
        const ourScore = isWindupLeft ? g.lScore : g.rScore;
        const theirScore = isWindupLeft ? g.rScore : g.lScore;

        let result = '무';
        if (ourScore > theirScore) result = '승';
        else if (ourScore < theirScore) result = '패';

        console.log(`    ${g.date} vs ${opponent}: ${ourScore}-${theirScore} ${result} (seq:${g.gameScheduleSeq})`);

        allCollectedGames.push({
          date: g.date,
          opponent,
          ourScore,
          theirScore,
          result,
          location: g.location || '',
          league: '',
          entryId: '2023_daedeok',
          gameScheduleSeq: g.gameScheduleSeq,
          source: 'daedeokgu'
        });
      }
    }
  }

  // Save debug data
  fs.writeFileSync(path.join(DEBUG_DIR, 'collected_games.json'),
    JSON.stringify(allCollectedGames, null, 2), 'utf-8');

  console.log(`\n\n===== Phase 1 완료: 총 ${allCollectedGames.length}경기 수집 =====\n`);

  // Group by entryId for summary
  const byEntry = {};
  allCollectedGames.forEach(g => {
    if (!g.entryId) return;
    if (!byEntry[g.entryId]) byEntry[g.entryId] = [];
    byEntry[g.entryId].push(g);
  });
  for (const [id, games] of Object.entries(byEntry)) {
    console.log(`  ${id}: ${games.length}경기 (with seq: ${games.filter(g => g.gameScheduleSeq).length}개)`);
  }

  // ==================== Phase 2: Scrape box scores ====================
  console.log('\n\n===== Phase 2: Box score scraping =====\n');

  // Read current index.html to check which 2026 games already have boxScores
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  for (const game of allCollectedGames) {
    if (!game.gameScheduleSeq) {
      console.log(`  [SKIP] No seq: ${game.date} vs ${game.opponent}`);
      continue;
    }

    // For 2026 games, check if boxScore already exists
    if (game.entryId === '2026_sejong' || game.entryId === '2026_donggu') {
      const span = findEntrySpan(html, game.entryId);
      if (span) {
        const entryText = html.substring(span.start, span.end);
        const datePattern = `date:'${game.date}'`;
        if (entryText.includes(datePattern)) {
          // Check if it already has a boxScore
          const dateIdx = entryText.indexOf(datePattern);
          // Find the game object around this date
          let bStart = dateIdx;
          while (bStart > 0 && entryText[bStart] !== '{') bStart--;
          let depth = 1, bEnd = bStart + 1;
          let inStr = false, strCh = '', esc = false;
          while (bEnd < entryText.length && depth > 0) {
            const c = entryText[bEnd];
            if (esc) { esc = false; bEnd++; continue; }
            if (c === '\\' && inStr) { esc = true; bEnd++; continue; }
            if (inStr) { if (c === strCh) inStr = false; bEnd++; continue; }
            if (c === "'" || c === '"') { inStr = true; strCh = c; bEnd++; continue; }
            if (c === '{') depth++;
            else if (c === '}') depth--;
            bEnd++;
          }
          const gameObj = entryText.substring(bStart, bEnd);
          if (/boxScore\s*:/.test(gameObj)) {
            console.log(`  [SKIP] Already has boxScore: ${game.date} vs ${game.opponent}`);
            continue;
          }
        }
      }
    }

    const baseUrl = game.source === 'donggu' ? 'https://donggu.dbsa.kr'
                  : game.source === 'daedeokgu' ? 'https://daedeokgu.dbsa.kr'
                  : 'https://www.ksbsa.or.kr';

    console.log(`[${game.gameScheduleSeq}] ${game.date} vs ${game.opponent} (${game.entryId})`);

    const bs = await scrapeBoxScore(page, game.gameScheduleSeq, baseUrl);
    if (!bs || !bs.lineScore) {
      console.log('  !! No data');
      continue;
    }

    // Save debug
    fs.writeFileSync(path.join(DEBUG_DIR, `${game.source}_${game.gameScheduleSeq}.json`),
      JSON.stringify(bs, null, 2), 'utf-8');

    const awayR = bs.lineScore?.away?.R || 0;
    const homeR = bs.lineScore?.home?.R || 0;
    console.log(`  ${bs.lineScore.away.teamName} ${awayR} - ${homeR} ${bs.lineScore.home.teamName}`);
    console.log(`  Batters: away ${bs.awayBatting?.batters?.length || 0}, home ${bs.homeBatting?.batters?.length || 0}`);
    console.log(`  Pitchers: away ${bs.awayPitching?.pitchers?.length || 0}, home ${bs.homePitching?.pitchers?.length || 0}`);

    game.boxScoreData = bs;
    game.boxScoreJs = buildBoxScoreJs(bs);

    // Also update location from box score data if missing
    if (!game.location && bs.gameInfo?.location) {
      game.location = bs.gameInfo.location;
    }
  }

  await browser.close();

  // ==================== Phase 3: Update index.html ====================
  console.log('\n\n===== Phase 3: Update index.html =====\n');

  html = fs.readFileSync(INDEX_FILE, 'utf-8');

  // Group games by entryId
  const gamesByEntry = {};
  allCollectedGames.forEach(g => {
    if (!g.entryId) return;
    if (!gamesByEntry[g.entryId]) gamesByEntry[g.entryId] = [];
    gamesByEntry[g.entryId].push(g);
  });

  // For entries with games:{} (empty), replace the whole games field
  const emptyGameEntries = ['2023_sejong', '2023_sejong_po', '2023_sejong_inter', '2023_daedeok', '2024_sejong'];

  for (const entryId of emptyGameEntries) {
    const games = gamesByEntry[entryId];
    if (!games || games.length === 0) {
      console.log(`${entryId}: No games found`);
      continue;
    }

    // Sort by date (chronological)
    games.sort((a, b) => a.date.localeCompare(b.date));

    console.log(`\n${entryId}: ${games.length}경기`);
    games.forEach(g => console.log(`  ${g.date} vs ${g.opponent}: ${g.ourScore}-${g.theirScore} ${g.result} (seq:${g.gameScheduleSeq || 'none'}) ${g.boxScoreJs ? '[BS]' : ''}`));

    const span = findEntrySpan(html, entryId);
    if (!span) { console.log(`  !! Entry not found`); continue; }
    let entryText = html.substring(span.start, span.end);

    const gjs = gamesToJs(games);
    const r = replaceField(entryText, /games\s*:\s*(\{|null|\[)/, `games:${gjs}`);
    if (r) {
      entryText = r;
      html = html.substring(0, span.start) + entryText + html.substring(span.end);
      console.log(`  Updated games for ${entryId}`);
    } else {
      console.log(`  !! games field replacement failed for ${entryId}`);
    }
  }

  // For 2026 entries that already have games, add boxScore to games that don't have it
  const existingGameEntries = ['2026_sejong', '2026_donggu'];

  for (const entryId of existingGameEntries) {
    const newGames = gamesByEntry[entryId];
    if (!newGames) continue;

    console.log(`\n${entryId}: Checking for missing boxScores...`);

    // Re-read span (html may have changed)
    const span = findEntrySpan(html, entryId);
    if (!span) { console.log(`  !! Entry not found`); continue; }

    for (const game of newGames) {
      if (!game.boxScoreJs) continue;

      const entryText = html.substring(span.start, span.end);
      const datePattern = `date:'${game.date}'`;
      const dateIdx = entryText.indexOf(datePattern);
      if (dateIdx < 0) {
        console.log(`  !! Date ${game.date} not found in ${entryId}`);
        continue;
      }

      // Find the game object
      let bStart = dateIdx;
      while (bStart > 0 && entryText[bStart] !== '{') bStart--;
      let depth = 1, bEnd = bStart + 1;
      let inStr = false, strCh = '', esc = false;
      while (bEnd < entryText.length && depth > 0) {
        const c = entryText[bEnd];
        if (esc) { esc = false; bEnd++; continue; }
        if (c === '\\' && inStr) { esc = true; bEnd++; continue; }
        if (inStr) { if (c === strCh) inStr = false; bEnd++; continue; }
        if (c === "'" || c === '"') { inStr = true; strCh = c; bEnd++; continue; }
        if (c === '{') depth++;
        else if (c === '}') depth--;
        bEnd++;
      }
      const gameObjText = entryText.substring(bStart, bEnd);

      if (/boxScore\s*:/.test(gameObjText)) {
        console.log(`  [SKIP] ${game.date} already has boxScore`);
        continue;
      }

      // Insert boxScore
      const newGameObj = gameObjText.slice(0, -1) + ',boxScore:' + game.boxScoreJs + '}';
      const newEntryText = entryText.substring(0, bStart) + newGameObj + entryText.substring(bEnd);
      html = html.substring(0, span.start) + newEntryText + html.substring(span.end);

      console.log(`  Added boxScore for ${game.date} vs ${game.opponent}`);
    }
  }

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log('\n\n===== All done! =====');

  // Summary
  const totalBoxScores = allCollectedGames.filter(g => g.boxScoreJs).length;
  const totalGames = allCollectedGames.length;
  console.log(`Total games collected: ${totalGames}`);
  console.log(`Total box scores: ${totalBoxScores}`);
}

main().catch(err => { console.error(err); process.exit(1); });
