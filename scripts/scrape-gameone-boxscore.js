/**
 * gameone.kr 박스스코어 전체 스크래퍼
 * - 연도별 schedule/table 페이지에서 game_idx 수집 (기존 debug 데이터 재활용)
 * - 각 경기 boxscore 페이지에서 라인스코어, 타자/투수 기록 수집
 * - index.html 게임 데이터에 boxScore 프로퍼티 추가
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const CLUB_IDX = 7734;
const GAMES_DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'games');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'gameone', 'boxscores');

// ========== Schedule scraping (fallback if debug data missing) ==========

async function scrapeSeasonSchedule(page, year) {
  const allGames = [];
  let maxPage = 1;
  for (let p = 1; p <= maxPage; p++) {
    const url = `https://www.gameone.kr/club/info/schedule/table?season=${year}&club_idx=${CLUB_IDX}&game_type=0&lig_idx=0&group=0&month=0&page=${p}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(2000);

    if (p === 1) {
      maxPage = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a'));
        const pageNums = links
          .map(a => { const m = a.href.match(/[?&]page=(\d+)/); return m ? parseInt(m[1]) : 0; })
          .filter(n => n > 0);
        return pageNums.length > 0 ? Math.max(...pageNums) : 1;
      });
    }

    const pageGames = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const children = Array.from(tr.children);
        const cells = children.map(c => c.textContent.trim().replace(/\s+/g, ' '));
        if (cells.length < 4 || cells[0] === '일시' || cells[1] === '분류') return;
        const dateTime = cells[0];
        const game = cells[3];
        const dm = dateTime.match(/(\d{1,2})월\s*(\d{1,2})일/);
        if (!dm) return;
        const month = dm[1].padStart(2, '0');
        const day = dm[2].padStart(2, '0');
        // Extract game_idx from boxscore link
        const boxLink = children[4] ? children[4].querySelector('a[href*="boxscore"]') : null;
        let gameIdx = null;
        if (boxLink) {
          const m2 = boxLink.href.match(/game_idx=(\d+)/);
          if (m2) gameIdx = m2[1];
        }
        // Parse team names and scores
        const windupIdx = game.indexOf('와인드업');
        if (windupIdx < 0) return;
        const tokens = game.split(/\s+/);
        let windupTokenIdx = -1;
        tokens.forEach((t, i) => { if (t === '와인드업') windupTokenIdx = i; });
        if (windupTokenIdx < 0) return;

        out.push({ month, day, game, gameIdx });
      });
      return out;
    });
    allGames.push(...pageGames);
  }
  return allGames;
}

// ========== Box score scraping ==========

async function scrapeBoxScore(page, gameIdx) {
  const url = `https://www.gameone.kr/club/info/schedule/boxscore?club_idx=${CLUB_IDX}&game_idx=${gameIdx}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    // retry with domcontentloaded
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e2) {
      return null;
    }
  }
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const result = {};

    // === LINE SCORE ===
    const scoreTable = document.querySelector('table.score_teble');
    if (!scoreTable) return null;

    const caption = scoreTable.querySelector('caption');
    result.caption = caption ? caption.textContent.trim() : '';

    const scoreRows = Array.from(scoreTable.querySelectorAll('tbody tr'));
    if (scoreRows.length < 2) return null;

    function parseScoreRow(tr) {
      const th = tr.querySelector('th');
      const teamName = th ? th.textContent.trim() : '';
      const tds = Array.from(tr.querySelectorAll('td'));
      // Round cells have class "round", R/H/E/B are after rounds
      const roundCells = tds.filter(td => td.classList.contains('round') && !td.classList.contains('hide'));
      const nonRoundCells = tds.filter(td => !td.classList.contains('round'));
      const innings = roundCells.map(td => {
        const v = td.textContent.trim();
        return v === '' ? null : (parseInt(v) || 0);
      });
      // R, H, E, B from non-round cells (or last 4 cells)
      // Actually let's just get all non-round, non-hide cells
      const statCells = tds.filter(td => !td.classList.contains('round'));
      const R = statCells[0] ? parseInt(statCells[0].textContent.trim()) || 0 : 0;
      const H = statCells[1] ? parseInt(statCells[1].textContent.trim()) || 0 : 0;
      const E = statCells[2] ? parseInt(statCells[2].textContent.trim()) || 0 : 0;
      const B = statCells[3] ? parseInt(statCells[3].textContent.trim()) || 0 : 0;
      return { teamName, innings, R, H, E, B };
    }

    result.team1 = parseScoreRow(scoreRows[0]);
    result.team2 = parseScoreRow(scoreRows[1]);

    // === HIGHLIGHTS (game summary) ===
    const highlights = [];
    const gameSumUl = document.querySelector('ul.game_sum');
    if (gameSumUl) {
      gameSumUl.querySelectorAll('li').forEach(li => {
        highlights.push(li.textContent.trim());
      });
    }
    result.highlights = highlights;

    // Umpire/recorder info
    const grayP = document.querySelector('.summary p.gray');
    if (grayP) {
      result.gameInfo = grayP.textContent.trim().replace(/\s+/g, ' ');
    }

    // === BATTING & PITCHING TABLES ===
    // Tables are in div.record blocks, each preceded by h3 with team name
    const recordDiv = document.querySelector('.record');
    if (!recordDiv) return result;

    const allH3s = Array.from(recordDiv.querySelectorAll('h3'));
    const allTables = Array.from(recordDiv.querySelectorAll('table.record_table'));

    // Pair each table with its preceding h3 (team name)
    const sections = [];
    allTables.forEach(table => {
      // Find the closest h3 before this table
      let h3 = null;
      let el = table.previousElementSibling;
      while (el) {
        if (el.tagName === 'H3') { h3 = el; break; }
        el = el.previousElementSibling;
      }
      const teamName = h3 ? h3.textContent.trim() : '';
      const isBatting = table.getAttribute('summary') === '타자기록';
      const isPitching = table.getAttribute('summary') === '투수기록';
      sections.push({ teamName, isBatting, isPitching, table });
    });

    // Parse batting table
    function parseBattingTable(table) {
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const batters = [];
      rows.forEach(tr => {
        const th = tr.querySelector('th');
        if (!th) return;
        const numSpan = th.querySelector('span.num');
        const posSpan = th.querySelector('span.position');
        const nameSpan = th.querySelector('span.name');
        if (!nameSpan) return;

        const order = numSpan ? parseInt(numSpan.textContent.trim()) || 0 : 0;
        const pos = posSpan ? posSpan.textContent.trim() : '';
        const nameRaw = nameSpan.textContent.trim();
        // name is like "선수명(번호)" - strong tag wraps name
        const nameStrong = nameSpan.querySelector('strong');
        const name = nameStrong ? nameStrong.textContent.trim() : nameRaw.replace(/\(\d+\)/, '').trim();
        const numMatch = nameRaw.match(/\((\d+)\)/);
        const number = numMatch ? parseInt(numMatch[1]) : 0;

        const tds = Array.from(tr.querySelectorAll('td'));
        const roundCells = tds.filter(td => td.classList.contains('round') && !td.classList.contains('hide'));
        const nonRoundCells = tds.filter(td => !td.classList.contains('round'));

        const inningResults = roundCells.map(td => td.textContent.trim());

        // Stats: 타수, 안타, 타점, 득점, 도루, 타율, 시즌
        const AB = nonRoundCells[0] ? parseInt(nonRoundCells[0].textContent.trim()) || 0 : 0;
        const H = nonRoundCells[1] ? parseInt(nonRoundCells[1].textContent.trim()) || 0 : 0;
        const RBI = nonRoundCells[2] ? parseInt(nonRoundCells[2].textContent.trim()) || 0 : 0;
        const R = nonRoundCells[3] ? parseInt(nonRoundCells[3].textContent.trim()) || 0 : 0;
        const SB = nonRoundCells[4] ? parseInt(nonRoundCells[4].textContent.trim()) || 0 : 0;
        const AVG = nonRoundCells[5] ? nonRoundCells[5].textContent.trim().replace(/[^\d.]/g, '') : '0.000';

        batters.push({ order, name, number, pos, inningResults, AB, H, RBI, R, SB, AVG });
      });

      // Totals from tfoot
      let total = null;
      const tfoot = table.querySelector('tfoot tr');
      if (tfoot) {
        const ftds = Array.from(tfoot.querySelectorAll('td'));
        if (ftds.length >= 6) {
          total = {
            AB: parseInt(ftds[0].textContent.trim()) || 0,
            H: parseInt(ftds[1].textContent.trim()) || 0,
            RBI: parseInt(ftds[2].textContent.trim()) || 0,
            R: parseInt(ftds[3].textContent.trim()) || 0,
            SB: parseInt(ftds[4].textContent.trim()) || 0,
            AVG: ftds[5].textContent.trim().replace(/[^\d.]/g, '')
          };
        }
      }

      return { batters, total };
    }

    // Parse pitching table
    function parsePitchingTable(table) {
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const pitchers = [];
      rows.forEach(tr => {
        const th = tr.querySelector('th');
        if (!th) return;
        const nameRaw = th.textContent.trim();
        const nameStrong = th.querySelector('strong');
        const name = nameStrong ? nameStrong.textContent.trim() : nameRaw.replace(/\(\d+\)/, '').trim();
        const numMatch = nameRaw.match(/\((\d+)\)/);
        const number = numMatch ? parseInt(numMatch[1]) : 0;

        const tds = Array.from(tr.querySelectorAll('td'));
        // Columns: 결과, 이닝, 타자, 타수, 피안타, 피홈런, 희타, 희비, 볼넷, 사구, 삼진, 폭투, 보크, 실점, 자책점, 투구수, 방어율, 시즌
        if (tds.length < 16) return;
        const vals = tds.map(td => td.textContent.trim());

        pitchers.push({
          name, number,
          decision: vals[0] || '-',    // 결과 (승/패/무/-)
          IP: vals[1] || '0',          // 이닝
          BF: parseInt(vals[2]) || 0,  // 타자
          AB: parseInt(vals[3]) || 0,  // 타수
          H: parseInt(vals[4]) || 0,   // 피안타
          HR: parseInt(vals[5]) || 0,  // 피홈런
          SH: parseInt(vals[6]) || 0,  // 희타
          SF: parseInt(vals[7]) || 0,  // 희비
          BB: parseInt(vals[8]) || 0,  // 볼넷
          HBP: parseInt(vals[9]) || 0, // 사구
          SO: parseInt(vals[10]) || 0, // 삼진
          WP: parseInt(vals[11]) || 0, // 폭투
          BK: parseInt(vals[12]) || 0, // 보크
          R: parseInt(vals[13]) || 0,  // 실점
          ER: parseInt(vals[14]) || 0, // 자책점
          NP: parseInt(vals[15]) || 0, // 투구수
          ERA: vals[16] ? vals[16].replace(/[^\d.]/g, '') : '0.00'
        });
      });
      return { pitchers };
    }

    // Assign tables to teams
    const battingSections = sections.filter(s => s.isBatting);
    const pitchingSections = sections.filter(s => s.isPitching);

    if (battingSections.length >= 2) {
      result.team1Batting = parseBattingTable(battingSections[0].table);
      result.team1Batting.teamName = battingSections[0].teamName;
      result.team2Batting = parseBattingTable(battingSections[1].table);
      result.team2Batting.teamName = battingSections[1].teamName;
    }

    if (pitchingSections.length >= 2) {
      result.team1Pitching = parsePitchingTable(pitchingSections[0].table);
      result.team1Pitching.teamName = pitchingSections[0].teamName;
      result.team2Pitching = parsePitchingTable(pitchingSections[1].table);
      result.team2Pitching.teamName = pitchingSections[1].teamName;
    }

    return result;
  });
}

// ========== index.html manipulation ==========

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

function findGameSpan(text, dateStr) {
  // Find a game object by date within entry text
  const datePattern = new RegExp(`date:'${dateStr}'`);
  const m = datePattern.exec(text);
  if (!m) return null;
  let braceStart = m.index;
  while (braceStart > 0 && text[braceStart] !== '{') braceStart--;
  let depth = 1, braceEnd = braceStart + 1;
  let inStr = false, strCh = '', esc = false;
  while (braceEnd < text.length && depth > 0) {
    const c = text[braceEnd];
    if (esc) { esc = false; braceEnd++; continue; }
    if (c === '\\' && inStr) { esc = true; braceEnd++; continue; }
    if (inStr) { if (c === strCh) inStr = false; braceEnd++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; braceEnd++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    braceEnd++;
  }
  return { start: braceStart, end: braceEnd };
}

function escStr(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function buildBoxScoreJs(bs) {
  // Determine which team is 와인드업
  const team1Name = bs.team1?.teamName || '';
  const team2Name = bs.team2?.teamName || '';
  const team1IsWindup = /와인드업/.test(team1Name);

  const ourLS = team1IsWindup ? bs.team1 : bs.team2;
  const theirLS = team1IsWindup ? bs.team2 : bs.team1;

  // In gameone.kr linescore, first row = team listed first in the table
  // We need to figure out home/away. In the score table, the order is:
  // Row 1 = team1 (often the "left" team in the header)
  // Row 2 = team2 (the "right" team in the header)
  // gameone.kr doesn't consistently mark away/home, so we'll use the table order
  // First team in the table = "team1", second = "team2"
  // The isHome flag indicates if 와인드업 is the home team (second row)
  const isHome = !team1IsWindup; // If 와인드업 is team2 (second row), they're home

  // Build innings array: [our, their] per inning
  const maxInnings = Math.max(
    (ourLS?.innings || []).length,
    (theirLS?.innings || []).length
  );
  const innings = [];
  for (let i = 0; i < maxInnings; i++) {
    innings.push([
      ourLS?.innings?.[i] != null ? ourLS.innings[i] : null,
      theirLS?.innings?.[i] != null ? theirLS.innings[i] : null
    ]);
  }

  const awayTeamName = team1Name;
  const homeTeamName = team2Name;

  // Build highlights
  const highlights = (bs.highlights || []).map(h => `'${escStr(h)}'`).join(',');

  // Map batting/pitching sections: team1 = away (first in table), team2 = home
  const awayBatting = bs.team1Batting;
  const homeBatting = bs.team2Batting;
  const awayPitching = bs.team1Pitching;
  const homePitching = bs.team2Pitching;

  // Build batters
  const buildBatters = (battingData) => {
    if (!battingData || !battingData.batters || battingData.batters.length === 0) return '[]';
    return '[' + battingData.batters.map(b => {
      const ir = JSON.stringify(b.inningResults || []);
      return `{order:${b.order},name:'${escStr(b.name)}',number:${b.number},pos:'${escStr(b.pos)}',inningResults:${ir},AB:${b.AB},H:${b.H},RBI:${b.RBI},R:${b.R},SB:${b.SB},AVG:'${b.AVG}'}`;
    }).join(',') + ']';
  };

  // Build pitchers
  const buildPitchers = (pitchingData) => {
    if (!pitchingData || !pitchingData.pitchers || pitchingData.pitchers.length === 0) return '[]';
    return '[' + pitchingData.pitchers.map(p => {
      return `{name:'${escStr(p.name)}',number:${p.number},decision:'${escStr(p.decision)}',IP:'${escStr(p.IP)}',BF:${p.BF},NP:${p.NP},AB:${p.AB},H:${p.H},HR:${p.HR},BB:${p.BB},HBP:${p.HBP},SO:${p.SO},R:${p.R},ER:${p.ER},ERA:'${p.ERA}'}`;
    }).join(',') + ']';
  };

  return `{` +
    `innings:${JSON.stringify(innings)},` +
    `totals:{ourH:${ourLS?.H || 0},ourE:${ourLS?.E || 0},ourB:${ourLS?.B || 0},theirH:${theirLS?.H || 0},theirE:${theirLS?.E || 0},theirB:${theirLS?.B || 0}},` +
    `isHome:${isHome},` +
    `awayTeam:'${escStr(awayTeamName)}',` +
    `homeTeam:'${escStr(homeTeamName)}',` +
    `highlights:[${highlights}],` +
    `awayBatters:${buildBatters(awayBatting)},` +
    `homeBatters:${buildBatters(homeBatting)},` +
    `awayPitchers:${buildPitchers(awayPitching)},` +
    `homePitchers:${buildPitchers(homePitching)}` +
    `}`;
}

// ========== Main ==========

async function main() {
  console.log('=== gameone.kr 박스스코어 스크래퍼 ===\n');

  if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const m = html.match(/const ALL_DATA = (\[[\s\S]*?\n\]);/);
  if (!m) { console.error('ALL_DATA 못 찾음'); process.exit(1); }
  let DATA; eval('DATA = ' + m[1]);

  // gameone.kr 소스 엔트리만 대상
  const targets = DATA.filter(e => e.source === 'gameone.kr');
  const years = [...new Set(targets.map(e => e.year))].sort();
  console.log(`대상 연도: ${years.join(', ')}`);
  console.log(`대상 엔트리: ${targets.length}개\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  let totalSuccess = 0;
  let totalFail = 0;
  let totalSkipped = 0;
  const summary = [];

  for (const year of years) {
    console.log(`\n========== ${year} ==========`);
    const yearEntries = targets.filter(e => e.year === year);

    // Load debug game data (has gameIdx values)
    const debugFile = path.join(GAMES_DEBUG_DIR, `${year}.json`);
    let debugData = null;
    if (fs.existsSync(debugFile)) {
      try {
        debugData = JSON.parse(fs.readFileSync(debugFile, 'utf-8'));
        console.log(`  기존 debug 데이터 로드: ${debugFile}`);
      } catch (e) {
        console.warn(`  debug 데이터 파싱 실패: ${e.message}`);
      }
    }

    // Create a page for this year (fresh context)
    const page = await browser.newPage();

    // First visit the schedule page to set session/cookies
    try {
      await page.goto(`https://www.gameone.kr/club/info/schedule/table?season=${year}&club_idx=${CLUB_IDX}&game_type=0&lig_idx=0&group=0&month=0&page=1`, {
        waitUntil: 'networkidle', timeout: 30000
      });
      await page.waitForTimeout(2000);
    } catch (e) {
      console.warn(`  ${year} 스케줄 페이지 접속 실패: ${e.message}`);
      await page.close();
      continue;
    }

    // If no debug data, scrape schedule to get game_idx values
    if (!debugData) {
      console.log(`  스케줄 스크래핑으로 game_idx 수집...`);
      const schedGames = await scrapeSeasonSchedule(page, year);
      debugData = {};
      for (const entry of yearEntries) {
        debugData[entry.id] = schedGames
          .filter(g => g.gameIdx)
          .map(g => ({ ...g, date: `${year}-${g.month}-${g.day}` }));
      }
    }

    for (const entry of yearEntries) {
      console.log(`\n  --- ${entry.id} (${entry.league}) ---`);

      // Get games with gameIdx from debug data
      const debugGames = debugData[entry.id] || [];
      if (debugGames.length === 0) {
        console.log(`    매칭 게임 없음`);
        summary.push(`${entry.id}: 0 games`);
        continue;
      }

      // Get entry text from html for matching
      const entrySpan = findEntrySpan(html, entry.id);
      if (!entrySpan) {
        console.log(`    엔트리 못 찾음`);
        summary.push(`${entry.id}: entry not found`);
        continue;
      }

      let yearSuccess = 0;
      let yearFail = 0;

      for (const game of debugGames) {
        if (!game.gameIdx) {
          console.log(`    ${game.date} - gameIdx 없음, 스킵`);
          totalSkipped++;
          continue;
        }

        // Check if already has boxScore in html
        const currentSpan = findEntrySpan(html, entry.id);
        const currentEntry = html.substring(currentSpan.start, currentSpan.end);
        const gameDatePattern = `date:'${game.date}'`;
        if (currentEntry.indexOf(gameDatePattern) < 0) {
          console.log(`    ${game.date} vs ${game.opponent || '?'} - 날짜 매칭 실패`);
          totalFail++;
          yearFail++;
          continue;
        }

        // Check if boxScore already exists for this game
        const gameSpanInEntry = findGameSpan(currentEntry, game.date);
        if (gameSpanInEntry) {
          const gameText = currentEntry.substring(gameSpanInEntry.start, gameSpanInEntry.end);
          if (/boxScore\s*:\s*\{/.test(gameText)) {
            console.log(`    ${game.date} vs ${game.opponent || '?'} - boxScore 이미 있음, 스킵`);
            totalSkipped++;
            continue;
          }
        }

        console.log(`    ${game.date} vs ${game.opponent || '?'} [${game.gameIdx}]...`);

        // Check if we have cached debug data for this boxscore
        const bsDebugFile = path.join(DEBUG_DIR, `${game.gameIdx}.json`);
        let bs = null;
        if (fs.existsSync(bsDebugFile)) {
          try {
            bs = JSON.parse(fs.readFileSync(bsDebugFile, 'utf-8'));
            console.log(`      캐시된 데이터 사용`);
          } catch (e) { bs = null; }
        }

        if (!bs) {
          try {
            bs = await scrapeBoxScore(page, game.gameIdx);
            if (bs) {
              fs.writeFileSync(bsDebugFile, JSON.stringify(bs, null, 2), 'utf-8');
            }
          } catch (e) {
            console.log(`      스크래핑 실패: ${e.message}`);
            totalFail++;
            yearFail++;
            continue;
          }
        }

        if (!bs || !bs.team1 || !bs.team2) {
          console.log(`      데이터 없음 또는 불완전`);
          totalFail++;
          yearFail++;
          continue;
        }

        // Log scraped data
        console.log(`      ${bs.team1.teamName} ${bs.team1.R} vs ${bs.team2.R} ${bs.team2.teamName}`);
        const bat1 = bs.team1Batting?.batters?.length || 0;
        const bat2 = bs.team2Batting?.batters?.length || 0;
        const pit1 = bs.team1Pitching?.pitchers?.length || 0;
        const pit2 = bs.team2Pitching?.pitchers?.length || 0;
        console.log(`      타자: ${bat1}/${bat2}명, 투수: ${pit1}/${pit2}명`);

        // Build boxScore JS string
        const bsJs = buildBoxScoreJs(bs);

        // Insert into index.html
        const freshSpan = findEntrySpan(html, entry.id);
        const entryText = html.substring(freshSpan.start, freshSpan.end);
        const gameSpan = findGameSpan(entryText, game.date);
        if (!gameSpan) {
          console.log(`      게임 오브젝트 못 찾음`);
          totalFail++;
          yearFail++;
          continue;
        }

        const gameObjText = entryText.substring(gameSpan.start, gameSpan.end);

        // Insert boxScore property before closing brace
        let newGameObj;
        if (/boxScore\s*:/.test(gameObjText)) {
          // Replace existing boxScore
          const bsStart = gameObjText.search(/boxScore\s*:/);
          const afterColon = gameObjText.indexOf(':', bsStart) + 1;
          let d = 0, k = afterColon;
          while (k < gameObjText.length) {
            const c = gameObjText[k];
            if (c === '{') d++;
            else if (c === '}') { d--; if (d === 0) { k++; break; } }
            k++;
          }
          newGameObj = gameObjText.substring(0, bsStart) + 'boxScore:' + bsJs + gameObjText.substring(k);
        } else {
          // Add boxScore before closing brace
          newGameObj = gameObjText.slice(0, -1) + ',boxScore:' + bsJs + '}';
        }

        const newEntryText = entryText.substring(0, gameSpan.start) + newGameObj + entryText.substring(gameSpan.end);
        html = html.substring(0, freshSpan.start) + newEntryText + html.substring(freshSpan.end);

        console.log(`      boxScore 추가 완료`);
        totalSuccess++;
        yearSuccess++;
      }

      summary.push(`${entry.id}: ${yearSuccess} success, ${yearFail} fail`);
    }

    await page.close();

    // Save intermediate results after each year
    fs.writeFileSync(INDEX_FILE, html, 'utf-8');
    console.log(`\n  ${year} 결과 저장 완료`);
  }

  await browser.close();

  // Final save
  fs.writeFileSync(INDEX_FILE, html, 'utf-8');

  console.log(`\n\n========== 최종 결과 ==========`);
  console.log(`성공: ${totalSuccess}`);
  console.log(`실패: ${totalFail}`);
  console.log(`스킵(이미 존재/idx 없음): ${totalSkipped}`);
  console.log('\n--- 엔트리별 ---');
  summary.forEach(s => console.log('  ' + s));
}

main().catch(err => { console.error(err); process.exit(1); });
