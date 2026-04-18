/**
 * gameone.kr 박스스코어 전체 재수집 (타자/투수 기록 포함)
 * - 기존 스크래퍼의 querySelector('.record') 버그 수정 (div.record)
 * - gameone 엔트리의 gameIdx가 있는 모든 경기 대상
 * - 기존 JSON 캐시에서 라인스코어/하이라이트 로드 + 신규 타자/투수 스크래핑
 * - index.html에 boxScore 프로퍼티 추가/업데이트
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'gameone', 'boxscores');

function escStr(s) {
  return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

// ========== Scrape batter/pitcher data only ==========

async function scrapeBatterPitcher(page, gameIdx) {
  const url = `https://www.gameone.kr/club/info/schedule/boxscore?club_idx=7734&game_idx=${gameIdx}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  } catch (e) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e2) {
      return null;
    }
  }
  await page.waitForTimeout(2000);

  return await page.evaluate(() => {
    const recordDiv = document.querySelector('div.record');
    if (!recordDiv) return null;

    const allTables = Array.from(recordDiv.querySelectorAll('table.record_table'));
    if (allTables.length === 0) return null;

    const sections = [];
    allTables.forEach(table => {
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
        const nameStrong = nameSpan.querySelector('strong');
        const nameRaw = nameSpan.textContent.trim();
        const name = nameStrong ? nameStrong.textContent.trim() : nameRaw.replace(/\(\d+\)/, '').trim();
        const numMatch = nameRaw.match(/\((\d+)\)/);
        const number = numMatch ? parseInt(numMatch[1]) : 0;
        const tds = Array.from(tr.querySelectorAll('td'));
        const roundCells = tds.filter(td => td.classList.contains('round') && !td.classList.contains('hide'));
        const nonRoundCells = tds.filter(td => !td.classList.contains('round'));
        const inningResults = roundCells.map(td => td.textContent.trim());
        const AB = nonRoundCells[0] ? parseInt(nonRoundCells[0].textContent.trim()) || 0 : 0;
        const H = nonRoundCells[1] ? parseInt(nonRoundCells[1].textContent.trim()) || 0 : 0;
        const RBI = nonRoundCells[2] ? parseInt(nonRoundCells[2].textContent.trim()) || 0 : 0;
        const R = nonRoundCells[3] ? parseInt(nonRoundCells[3].textContent.trim()) || 0 : 0;
        const SB = nonRoundCells[4] ? parseInt(nonRoundCells[4].textContent.trim()) || 0 : 0;
        const AVG = nonRoundCells[5] ? nonRoundCells[5].textContent.trim().replace(/[^\d.]/g, '') : '0.000';
        batters.push({ order, name, number, pos, inningResults, AB, H, RBI, R, SB, AVG });
      });
      return batters;
    }

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
        if (tds.length < 16) return;
        const vals = tds.map(td => td.textContent.trim());
        pitchers.push({
          name, number,
          decision: vals[0] || '-', IP: vals[1] || '0', BF: parseInt(vals[2]) || 0,
          AB: parseInt(vals[3]) || 0, H: parseInt(vals[4]) || 0, HR: parseInt(vals[5]) || 0,
          BB: parseInt(vals[8]) || 0, HBP: parseInt(vals[9]) || 0, SO: parseInt(vals[10]) || 0,
          R: parseInt(vals[13]) || 0, ER: parseInt(vals[14]) || 0,
          NP: parseInt(vals[15]) || 0,
          ERA: vals[16] ? vals[16].replace(/[^\d.]/g, '') : '0.00'
        });
      });
      return pitchers;
    }

    const battingSections = sections.filter(s => s.isBatting);
    const pitchingSections = sections.filter(s => s.isPitching);
    const result = {};
    if (battingSections.length >= 1) {
      result.team1Batters = parseBattingTable(battingSections[0].table);
      result.team1Name = battingSections[0].teamName;
    }
    if (battingSections.length >= 2) {
      result.team2Batters = parseBattingTable(battingSections[1].table);
      result.team2Name = battingSections[1].teamName;
    }
    if (pitchingSections.length >= 1) result.team1Pitchers = parsePitchingTable(pitchingSections[0].table);
    if (pitchingSections.length >= 2) result.team2Pitchers = parsePitchingTable(pitchingSections[1].table);
    return result;
  });
}

// ========== Build JS strings ==========

function buildBattersJs(batters) {
  if (!batters || batters.length === 0) return '[]';
  return '[' + batters.map(b => {
    const ir = JSON.stringify(b.inningResults || []);
    return `{order:${b.order},name:'${escStr(b.name)}',number:${b.number},pos:'${escStr(b.pos)}',inningResults:${ir},AB:${b.AB},H:${b.H},RBI:${b.RBI},R:${b.R},SB:${b.SB},AVG:'${b.AVG}'}`;
  }).join(',') + ']';
}

function buildPitchersJs(pitchers) {
  if (!pitchers || pitchers.length === 0) return '[]';
  return '[' + pitchers.map(p => {
    return `{name:'${escStr(p.name)}',number:${p.number},decision:'${escStr(p.decision)}',IP:'${escStr(p.IP)}',BF:${p.BF},NP:${p.NP},AB:${p.AB},H:${p.H},HR:${p.HR},BB:${p.BB},HBP:${p.HBP || 0},SO:${p.SO},R:${p.R},ER:${p.ER},ERA:'${p.ERA}'}`;
  }).join(',') + ']';
}

function buildBoxScoreJs(cached, awayBatters, homeBatters, awayPitchers, homePitchers) {
  const team1IsWindup = /와인드업/.test(cached.team1?.teamName || '');
  const ourLS = team1IsWindup ? cached.team1 : cached.team2;
  const theirLS = team1IsWindup ? cached.team2 : cached.team1;
  const isHome = !team1IsWindup;
  const maxInnings = Math.max((ourLS?.innings || []).length, (theirLS?.innings || []).length);
  const innings = [];
  for (let i = 0; i < maxInnings; i++) {
    innings.push([ourLS?.innings?.[i] ?? null, theirLS?.innings?.[i] ?? null]);
  }
  const awayTeamName = cached.team1?.teamName || '';
  const homeTeamName = cached.team2?.teamName || '';
  const highlights = (cached.highlights || []).map(h => `'${escStr(h)}'`).join(',');

  return `boxScore:{` +
    `innings:${JSON.stringify(innings)},` +
    `totals:{ourH:${ourLS?.H || 0},ourE:${ourLS?.E || 0},ourB:${ourLS?.B || 0},theirH:${theirLS?.H || 0},theirE:${theirLS?.E || 0},theirB:${theirLS?.B || 0}},` +
    `isHome:${isHome},` +
    `awayTeam:'${escStr(awayTeamName)}',` +
    `homeTeam:'${escStr(homeTeamName)}',` +
    `highlights:[${highlights}],` +
    `awayBatters:${buildBattersJs(awayBatters)},` +
    `homeBatters:${buildBattersJs(homeBatters)},` +
    `awayPitchers:${buildPitchersJs(awayPitchers)},` +
    `homePitchers:${buildPitchersJs(homePitchers)}}`;
}

// ========== Main ==========

async function main() {
  console.log('=== gameone.kr 박스스코어 재수집 (라인스코어+타자+투수) ===\n');

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  // Find all games with gameIdx that don't have boxScore
  const gamePattern = /gameIdx:'(\d+)'(?:,boxScore:\{|(?=\}))/g;
  const allGames = [];
  let match;
  while ((match = gamePattern.exec(html)) !== null) {
    const gameIdx = match[1];
    // Check if this game already has boxScore
    const after = html.substring(match.index, match.index + match[0].length + 20);
    const hasBoxScore = /boxScore:\{/.test(after.substring(after.indexOf(gameIdx)));
    if (!hasBoxScore) {
      allGames.push({ gameIdx, position: match.index });
    }
  }

  console.log(`박스스코어 없는 gameone 경기: ${allGames.length}개\n`);

  if (allGames.length === 0) {
    console.log('대상 없음');
    return;
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();

  try {
    await page.goto('https://www.gameone.kr/club/info/schedule/table?club_idx=7734', {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.warn('세션 페이지 실패:', e.message);
  }

  let successCount = 0, failCount = 0, noDataCount = 0;

  for (let i = 0; i < allGames.length; i++) {
    const { gameIdx } = allGames[i];
    process.stdout.write(`[${i + 1}/${allGames.length}] game_idx=${gameIdx}...`);

    // Load cached linescore/highlights from JSON
    const jsonFile = path.join(DEBUG_DIR, `${gameIdx}.json`);
    let cached = null;
    if (fs.existsSync(jsonFile)) {
      try { cached = JSON.parse(fs.readFileSync(jsonFile, 'utf-8')); } catch {}
    }
    if (!cached) {
      console.log(' JSON 캐시 없음, 스킵');
      failCount++;
      continue;
    }

    // Scrape batter/pitcher data from website
    let batterData = null;
    try {
      batterData = await scrapeBatterPitcher(page, gameIdx);
    } catch (e) {
      console.log(` 스크래핑 에러: ${e.message}`);
    }

    // Determine team mapping: table order = team1(away), team2(home)
    let awayBatters = [], homeBatters = [], awayPitchers = [], homePitchers = [];
    if (batterData) {
      awayBatters = batterData.team1Batters || [];
      homeBatters = batterData.team2Batters || [];
      awayPitchers = batterData.team1Pitchers || [];
      homePitchers = batterData.team2Pitchers || [];
    }

    // Build boxScore JS
    const boxScoreJs = buildBoxScoreJs(cached, awayBatters, homeBatters, awayPitchers, homePitchers);

    // Replace in html: gameIdx:'XXXX'} → gameIdx:'XXXX',boxScore:{...}}
    const searchStr = `gameIdx:'${gameIdx}'}`;
    if (html.includes(searchStr)) {
      html = html.replace(searchStr, `gameIdx:'${gameIdx}',${boxScoreJs}}`);
      const bCount = awayBatters.length + homeBatters.length;
      const pCount = awayPitchers.length + homePitchers.length;
      if (bCount > 0) {
        console.log(` 성공 (타자 ${bCount}명, 투수 ${pCount}명)`);
      } else {
        console.log(` 라인스코어만 (타자/투수 데이터 없음)`);
        noDataCount++;
      }
      successCount++;
    } else {
      console.log(' html 매칭 실패');
      failCount++;
    }
  }

  await browser.close();
  fs.writeFileSync(INDEX_FILE, html, 'utf-8');

  console.log(`\n=== 완료 ===`);
  console.log(`성공: ${successCount} (라인스코어+타자/투수)`);
  console.log(`라인스코어만: ${noDataCount}`);
  console.log(`실패: ${failCount}`);
  console.log(`총: ${allGames.length}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
