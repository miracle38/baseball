/**
 * gameone.kr 2010~2022 전 시즌 랭킹 페이지에서 추혜승(#16) 검색
 * - 타자/투수 랭킹 각각 조회
 * - 발견 시 stats 수집 → tmp_chuhs.json
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const OUT_FILE = path.join(__dirname, '..', 'tmp_chuhs.json');
const CLUB_IDX = 7734;

// 대상 엔트리 목록 + matcher (scrape-player-stats.js에서 차용)
const LEAGUE_MATCHERS = {
  '2022_daedeok':          { pattern: /대덕구.*토요\s*4부/ },
  '2022_sejong_1':         { pattern: /세종.*토요\s*4부\)$/ },
  '2022_sejong_2':         { pattern: /세종.*토요\s*4부\(/ },
  '2021_daedeok':          { pattern: /대덕구.*토요\s*4부/ },
  '2021_sejong_1':         { pattern: /세종.*토요\s*4부/, textMatch: /^(?!.*평일|.*후기)/ },
  '2021_sejong_weekday':   { pattern: /세종.*평일\s*4부/ },
  '2021_sejong_2':         { pattern: /세종.*토요\s*4부/, pickIndex: 'last' },
  '2020_daejeon':          { pattern: /대전.*토요\s*3부/ },
  '2020_sejong':           { pattern: /세종.*토요\s*4부/ },
  '2019_daejeon':          { pattern: /대전.*토요\s*3부/ },
  '2019_sejong':           { pattern: /세종.*토요\s*4부/ },
  '2018_donggu':           { pattern: /동구.*토요|대전.*동구/ },
  '2018_daejeon':          { pattern: /대전.*토요\s*3부/ },
  '2017_kukmin_nanum':     { pattern: /토요\s*나눔/ },
  '2017_kukmin_eoul':      { pattern: /토요\s*어울/ },
  '2017_daejeon':          { pattern: /대전.*토요\s*3부/ },
  '2016_daedeok':          { pattern: /대덕구.*토요\s*3부\s*B|토요\s*3부\s*B/ },
  '2016_daejeon_geumgang': { pattern: /대전.*토요금강|토요금강/ },
  '2015_donggu_taebaek':   { pattern: /태백|동구/ },
  '2015_daejeon_geumgang': { pattern: /토요금강|대전.*금강/ },
  '2014_kukmin_chugye':    { pattern: /추계|금강/ },
  '2014_myeongpum':        { pattern: /명품/ },
  '2013_kukmin_chugye':    { pattern: /추계|금강/ },
  '2013_myeongpum':        { pattern: /명품/ },
  '2012_kukmin_chugye':    { pattern: /추계|토요추계/ },
  '2012_daejeon':          { pattern: /대전.*토요/, textMatch: /^(?!.*추계)/ },
  '2011_geumgang':         { pattern: /금강|대전/ },
  '2010_geumgang':         { pattern: /금강|대전/ }
};

function yearOf(id) { return parseInt(id.slice(0, 4)); }

function matchesName(nameRaw) {
  // 기본: "추혜승", 공백 이형 "추 혜승" 등
  const stripped = nameRaw.replace(/\s+/g, '');
  if (stripped.includes('추혜승')) return true;
  // 부분 일치도 확인 (개명 가능성은 낮지만 안전장치)
  return false;
}

async function getLeagueOpts(page, baseUrl, year) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.selectOption('select[name="season"]', String(year)).catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('.game_tab li a').forEach(a => {
      if (a.textContent.trim() === '리그') a.click();
    });
  });
  await page.waitForTimeout(2000);
  return await page.evaluate(() => {
    const s = document.querySelectorAll('select')[1];
    if (!s) return [];
    return Array.from(s.options).filter(o => o.value !== '{}').map(o => ({ text: o.textContent.trim(), value: o.value }));
  });
}

async function selectYearAndLeague(page, baseUrl, year, leagueValue) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);
  await page.selectOption('select[name="season"]', String(year)).catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('.game_tab li a').forEach(a => {
      if (a.textContent.trim() === '리그') a.click();
    });
  });
  await page.waitForTimeout(1500);
  await page.evaluate((v) => {
    const s = document.querySelectorAll('select')[1];
    if (s) { s.value = v; s.dispatchEvent(new Event('change')); }
  }, leagueValue);
  await page.waitForTimeout(3000);
}

async function scrapeTable(page, tableIndex) {
  return await page.evaluate((ti) => {
    const tbl = document.querySelectorAll('table')[ti];
    if (!tbl) return { headers: [], rows: [] };
    const ths = Array.from(tbl.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const rows = [];
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.children).map(c => c.textContent.trim());
      if (cells.length > 5) rows.push(cells);
    });
    return { headers: ths, rows };
  }, tableIndex);
}

function parseHitter(headers, vals) {
  const gi = (col) => headers.indexOf(col);
  const v = (col) => { const i = gi(col); return i >= 0 ? (parseInt(vals[i]) || 0) : 0; };
  const f = (col) => { const i = gi(col); return i >= 0 ? (parseFloat(vals[i]) || 0) : 0; };
  const nameRaw = vals[gi('이름')] || '';
  const numMatch = nameRaw.match(/\((\d+)\)/);
  const name = nameRaw.replace(/\(\d+\)/, '').trim();
  const number = numMatch ? parseInt(numMatch[1]) : 0;
  return {
    name, number,
    G: v('게임수') || v('경기') || v('경기수'),
    PA: v('타석'), AB: v('타수'), H: v('총안타'),
    '2B': v('2루타'), '3B': v('3루타'), HR: v('홈런'),
    RBI: v('타점'), R: v('득점'), SB: v('도루'),
    BB: v('볼넷'), HBP: v('사구'), SO: v('삼진'),
    kOBP: f('출루율'), kSLG: f('장타율'), kOPS: f('OPS')
  };
}

function parsePitcher(headers, vals) {
  const gi = (col) => headers.indexOf(col);
  const v = (col) => { const i = gi(col); return i >= 0 ? (parseInt(vals[i]) || 0) : 0; };
  const s = (col) => { const i = gi(col); return i >= 0 ? vals[i] : '0'; };
  const nameRaw = vals[gi('이름')] || '';
  const numMatch = nameRaw.match(/\((\d+)\)/);
  const name = nameRaw.replace(/\(\d+\)/, '').trim();
  const number = numMatch ? parseInt(numMatch[1]) : 0;
  return {
    name, number,
    G: v('게임수') || v('경기수') || v('경기'),
    W: v('승'), L: v('패'), SV: v('세'), HD: v('홀드'),
    IP: s('이닝'), BF: v('타자'), NP: v('투구수'),
    pH: v('피안타'), pHR: v('피홈런'),
    K: v('탈삼진'), pBB: v('볼넷'), pIBB: v('고의4구'), pHBP: v('사구'),
    R: v('실점'), ER: v('자책점')
  };
}

async function main() {
  console.log('=== 추혜승 과거 시즌 검색 (gameone.kr 2010~2022) ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();

  // 세션 확보
  try {
    await page.goto(`https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, {
      waitUntil: 'networkidle', timeout: 30000
    });
    await page.waitForTimeout(2000);
  } catch (e) {
    console.warn('세션 페이지 실패:', e.message);
  }

  const entryIds = Object.keys(LEAGUE_MATCHERS);
  const results = {};

  // 연도별로 그룹
  const byYear = {};
  entryIds.forEach(id => {
    const y = yearOf(id);
    if (!byYear[y]) byYear[y] = [];
    byYear[y].push(id);
  });
  const years = Object.keys(byYear).map(Number).sort();

  for (const year of years) {
    console.log(`\n=== ${year} ===`);

    // 1. 해당 year에서 사용 가능한 리그 옵션 목록 수집
    let leagueOpts = [];
    try {
      leagueOpts = await getLeagueOpts(page, `https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, year);
      console.log(`  리그 옵션: ${leagueOpts.map(o => o.text).join(' | ')}`);
    } catch (e) {
      console.log(`  리그 옵션 로드 실패: ${e.message}`);
    }

    for (const entryId of byYear[year]) {
      const matcher = LEAGUE_MATCHERS[entryId];
      const matches = leagueOpts.filter(o =>
        matcher.pattern.test(o.text) &&
        (!matcher.textMatch || matcher.textMatch.test(o.text))
      );
      let opt = matches[0];
      if (matcher.pickIndex === 'last' && matches.length > 1) opt = matches[matches.length - 1];

      if (!opt) {
        console.log(`  [${entryId}] 매칭 리그 없음 (SKIP)`);
        results[entryId] = { skipped: true, reason: '매칭 리그 없음' };
        continue;
      }

      console.log(`  [${entryId}] → ${opt.text}`);

      let hitterRow = null, pitcherRow = null;
      let hitterHeaders = [], pitcherHeaders = [];

      // hitter
      try {
        await selectYearAndLeague(page, `https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, year, opt.value);
        const hitData = await scrapeTable(page, 1);
        hitterHeaders = hitData.headers;
        for (const row of hitData.rows) {
          const nameIdx = hitData.headers.indexOf('이름');
          const nameRaw = row[nameIdx] || '';
          if (matchesName(nameRaw)) {
            hitterRow = row;
            break;
          }
        }
      } catch (e) {
        console.log(`    hitter 에러: ${e.message}`);
      }

      // pitcher
      try {
        await selectYearAndLeague(page, `https://www.gameone.kr/club/info/ranking/pitcher?club_idx=${CLUB_IDX}`, year, opt.value);
        const pitData = await scrapeTable(page, 1);
        pitcherHeaders = pitData.headers;
        for (const row of pitData.rows) {
          const nameIdx = pitData.headers.indexOf('이름');
          const nameRaw = row[nameIdx] || '';
          if (matchesName(nameRaw)) {
            pitcherRow = row;
            break;
          }
        }
      } catch (e) {
        console.log(`    pitcher 에러: ${e.message}`);
      }

      const res = { league: opt.text, leagueValue: opt.value };
      if (hitterRow) {
        res.hitter = parseHitter(hitterHeaders, hitterRow);
        console.log(`    ✓ 타자 발견: ${res.hitter.name}(#${res.hitter.number}) G=${res.hitter.G} PA=${res.hitter.PA} H=${res.hitter.H}`);
      }
      if (pitcherRow) {
        res.pitcher = parsePitcher(pitcherHeaders, pitcherRow);
        console.log(`    ✓ 투수 발견: ${res.pitcher.name}(#${res.pitcher.number}) IP=${res.pitcher.IP}`);
      }
      if (!hitterRow && !pitcherRow) {
        console.log(`    - 추혜승 없음`);
      }
      results[entryId] = res;
    }
  }

  await browser.close();

  fs.writeFileSync(OUT_FILE, JSON.stringify(results, null, 2), 'utf-8');
  console.log(`\n=== 완료: ${OUT_FILE} ===`);
  const found = Object.entries(results).filter(([, v]) => v.hitter || v.pitcher);
  console.log(`발견: ${found.length}/${entryIds.length} 엔트리`);
  found.forEach(([id, v]) => {
    const parts = [];
    if (v.hitter) parts.push('타자');
    if (v.pitcher) parts.push('투수');
    console.log(`  ${id}: ${parts.join('+')}`);
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
