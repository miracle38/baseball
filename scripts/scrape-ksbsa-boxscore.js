/**
 * ksbsa.or.kr 박스스코어 전체 스크래퍼
 * - 각 경기 상세 페이지에서 라인스코어, 하이라이트, 양팀 타자/투수 기록 수집
 * - index.html 게임 데이터에 boxScore 프로퍼티 추가
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const GAMES_FILE = path.join(__dirname, '..', 'scrape_debug', 'ksbsa', 'final_games.json');

async function scrapeBoxScore(page, seq, leagueCat) {
  const url = `https://www.ksbsa.or.kr/schedule/getGameRecord.hs?gameScheduleSeq=${seq}&leagueCategory=${leagueCat}`;
  await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    if (tables.length < 5) return null;

    const result = {};

    // === TABLE 0: Line Score ===
    const lsTable = tables[0];
    const lsRows = Array.from(lsTable.querySelectorAll('tr')).filter(r => r.querySelector('td'));
    // Skip header row: first cell is "팀명" or contains non-team text
    const dataRows = lsRows.filter(tr => {
      const first = tr.children[0]?.textContent.trim();
      return first && first !== '팀명' && !/^[0-9]+회$/.test(first);
    });
    if (dataRows.length >= 2) {
      const parseRow = (tr) => {
        const cells = Array.from(tr.children).map(c => c.textContent.trim());
        const teamName = cells[0];
        // Last 4: R, H, E, B
        const R = parseInt(cells[cells.length - 4]) || 0;
        const H = parseInt(cells[cells.length - 3]) || 0;
        const E = parseInt(cells[cells.length - 2]) || 0;
        const B = parseInt(cells[cells.length - 1]) || 0;
        // Innings: cells[1] to cells[length-5]
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
        if (category === '팀명') return; // skip header
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
      // Skip header row
      for (let i = 1; i < rows.length; i++) {
        const tr = rows[i];
        const ths = Array.from(tr.querySelectorAll('th'));
        const tds = Array.from(tr.querySelectorAll('td'));

        if (ths.length >= 3 && tds.length >= 7) {
          // Player row: 3 TH (order, name, pos) + TDs (innings + stats)
          const order = parseInt(ths[0].textContent.trim()) || 0;
          const nameRaw = ths[1].textContent.trim();
          const pos = ths[2].textContent.trim();
          // Parse name and number: "선수명 (번호)"
          const nameMatch = nameRaw.match(/^(.+?)\s*\((\d+)\)$/);
          const name = nameMatch ? nameMatch[1].trim() : nameRaw;
          const number = nameMatch ? parseInt(nameMatch[2]) : 0;

          // TDs: innings data + last 7 cols are stats (타석,타수,안타,타점,득점,도루,타율)
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
          // Total row
          const allTds = tds.map(td => td.textContent.trim());
          // Total: last 7 are stats
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
          // Pitcher row: 2 TH (순번, 선수명) + 13 TDs
          const nameRaw = ths[1].textContent.trim();
          const nameMatch = nameRaw.match(/^(.+?)\s*\((\d+)\)$/);
          const name = nameMatch ? nameMatch[1].trim() : nameRaw;
          const number = nameMatch ? parseInt(nameMatch[2]) : 0;
          const tdVals = tds.map(td => td.textContent.trim());

          pitchers.push({
            name, number,
            role: tdVals[0],        // 선발/구원
            decision: tdVals[1],    // 승/패/무/-
            IP: tdVals[2],          // 이닝
            BF: parseInt(tdVals[3]) || 0,  // 타자
            NP: parseInt(tdVals[4]) || 0,  // 투구수
            AB: parseInt(tdVals[5]) || 0,  // 타수
            H: parseInt(tdVals[6]) || 0,   // 피안타
            HR: parseInt(tdVals[7]) || 0,  // 홈런
            BB: parseInt(tdVals[8]) || 0,  // 4사구
            SO: parseInt(tdVals[9]) || 0,  // 삼진
            R: parseInt(tdVals[10]) || 0,  // 실점
            ER: parseInt(tdVals[11]) || 0, // 자책
            ERA: tdVals[12] || '0.00'      // 평균자책점
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

    // === TABLE 3: Away Batting ===
    result.awayBatting = parseBattingTable(tables[3]);

    // === TABLE 4: Home Batting ===
    result.homeBatting = parseBattingTable(tables[4]);

    // === TABLE 5: Away Pitching ===
    result.awayPitching = parsePitchingTable(tables[5]);

    // === TABLE 6: Home Pitching ===
    result.homePitching = parsePitchingTable(tables[6]);

    // Get team labels from section titles
    const labels = Array.from(document.querySelectorAll('.section-title, h4, h3, [class*="title"]'));
    const teamLabels = labels
      .map(el => el.textContent.trim())
      .filter(t => /타자성적|투수성적/.test(t));
    result.sectionTitles = teamLabels;

    return result;
  });
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

function buildBoxScoreJs(bs, game) {
  // Determine which team is 와인드업
  const awayName = bs.lineScore?.away?.teamName || '';
  const homeName = bs.lineScore?.home?.teamName || '';
  const isHome = /와인드업/.test(homeName);

  const ourLS = isHome ? bs.lineScore.home : bs.lineScore.away;
  const theirLS = isHome ? bs.lineScore.away : bs.lineScore.home;

  // innings array: [our, their] per inning
  const maxInnings = Math.max(ourLS.innings.length, theirLS.innings.length);
  const innings = [];
  for (let i = 0; i < maxInnings; i++) {
    innings.push([
      ourLS.innings[i] != null ? ourLS.innings[i] : null,
      theirLS.innings[i] != null ? theirLS.innings[i] : null
    ]);
  }

  const esc = (s) => (s || '').replace(/'/g, "\\'").replace(/\\/g, "\\\\");

  // Build batters arrays
  const buildBatters = (battingData) => {
    if (!battingData || !battingData.batters) return '[]';
    return '[' + battingData.batters.map(b => {
      const ir = JSON.stringify(b.inningResults || []);
      return `{order:${b.order},name:'${esc(b.name)}',number:${b.number},pos:'${esc(b.pos)}',inningResults:${ir},PA:${b.PA},AB:${b.AB},H:${b.H},RBI:${b.RBI},R:${b.R},SB:${b.SB},AVG:'${b.AVG}'}`;
    }).join(',') + ']';
  };

  // Build pitchers arrays
  const buildPitchers = (pitchingData) => {
    if (!pitchingData || !pitchingData.pitchers) return '[]';
    return '[' + pitchingData.pitchers.map(p => {
      return `{name:'${esc(p.name)}',number:${p.number},role:'${esc(p.role)}',decision:'${esc(p.decision)}',IP:'${esc(p.IP)}',BF:${p.BF},NP:${p.NP},AB:${p.AB},H:${p.H},HR:${p.HR},BB:${p.BB},SO:${p.SO},R:${p.R},ER:${p.ER},ERA:'${p.ERA}'}`;
    }).join(',') + ']';
  };

  // Build highlights
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

async function main() {
  console.log('=== ksbsa 박스스코어 스크래퍼 ===\n');

  const gamesData = JSON.parse(fs.readFileSync(GAMES_FILE, 'utf-8'));
  const games = gamesData.allGames.filter(g => g.gameScheduleSeq);

  console.log(`${games.length}경기 박스스코어 수집 시작\n`);

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const debugDir = path.join(__dirname, '..', 'scrape_debug', 'ksbsa', 'boxscores');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  let successCount = 0;

  for (const game of games) {
    const seq = game.gameScheduleSeq;
    const cat = /시장기/.test(game.league) || /협회장기/.test(game.league) ? 'NORMAL' : 'NORMAL';
    console.log(`[${seq}] ${game.date} vs ${game.opponent}...`);

    const bs = await scrapeBoxScore(page, seq, cat);
    if (!bs) {
      console.log('  ❌ 데이터 없음');
      continue;
    }

    // Save debug
    fs.writeFileSync(path.join(debugDir, `${seq}.json`), JSON.stringify(bs, null, 2), 'utf-8');

    const awayName = bs.lineScore?.away?.teamName || '?';
    const homeName = bs.lineScore?.home?.teamName || '?';
    const awayR = bs.lineScore?.away?.R || 0;
    const homeR = bs.lineScore?.home?.R || 0;
    console.log(`  ${awayName} ${awayR} - ${homeR} ${homeName}`);
    console.log(`  타자: away ${bs.awayBatting?.batters?.length || 0}명, home ${bs.homeBatting?.batters?.length || 0}명`);
    console.log(`  투수: away ${bs.awayPitching?.pitchers?.length || 0}명, home ${bs.homePitching?.pitchers?.length || 0}명`);

    // Find the game in index.html and add boxScore
    const entryId = game.entryId;
    const span = findEntrySpan(html, entryId);
    if (!span) { console.log(`  ❌ 엔트리 ${entryId} 못 찾음`); continue; }

    // Find the specific game by date
    const gameDate = game.date;
    const gameDatePattern = new RegExp(`date:'${gameDate}'`);
    const entryText = html.substring(span.start, span.end);
    const dateIdx = entryText.search(gameDatePattern);
    if (dateIdx < 0) { console.log(`  ❌ 날짜 ${gameDate} 매칭 실패`); continue; }

    // Find the closing brace of this game object
    let braceStart = dateIdx;
    while (braceStart > 0 && entryText[braceStart] !== '{') braceStart--;

    let depth = 1, braceEnd = braceStart + 1;
    let inStr = false, strCh = '', esc = false;
    while (braceEnd < entryText.length && depth > 0) {
      const c = entryText[braceEnd];
      if (esc) { esc = false; braceEnd++; continue; }
      if (c === '\\' && inStr) { esc = true; braceEnd++; continue; }
      if (inStr) { if (c === strCh) inStr = false; braceEnd++; continue; }
      if (c === "'" || c === '"') { inStr = true; strCh = c; braceEnd++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      braceEnd++;
    }

    const gameObjText = entryText.substring(braceStart, braceEnd);

    // Build boxScore JS
    const bsJs = buildBoxScoreJs(bs, game);

    // Replace existing boxScore or insert new one
    let newGameObj;
    if (/boxScore\s*:/.test(gameObjText)) {
      // Replace existing: find boxScore field and replace its value
      const bsStart = gameObjText.search(/boxScore\s*:/);
      const afterColon = gameObjText.indexOf(':', bsStart) + 1;
      // Find the end of the boxScore object
      let d = 0, k = afterColon;
      while (k < gameObjText.length) {
        if (gameObjText[k] === '{') d++;
        else if (gameObjText[k] === '}') { d--; if (d === 0) { k++; break; } }
        k++;
      }
      newGameObj = gameObjText.substring(0, bsStart) + 'boxScore:' + bsJs + gameObjText.substring(k);
    } else {
      newGameObj = gameObjText.slice(0, -1) + ',boxScore:' + bsJs + '}';
    }

    const newEntryText = entryText.substring(0, braceStart) + newGameObj + entryText.substring(braceEnd);
    html = html.substring(0, span.start) + newEntryText + html.substring(span.end);

    console.log('  ✅ boxScore 추가');
    successCount++;
  }

  await browser.close();

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log(`\n=== 완료: ${successCount}/${games.length}경기 박스스코어 추가 ===`);
}

main().catch(err => { console.error(err); process.exit(1); });
