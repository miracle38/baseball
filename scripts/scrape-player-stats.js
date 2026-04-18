/**
 * gameone.kr 선수 기록 전체 재수집
 * - /club/info/ranking/hitter|pitcher 페이지에서 연도/리그 선택 후 실제 기록 수집
 * - 볼넷/사구/삼진/장타율/출루율/OPS, 투수 이닝/방어율/투구수 등 전체 필드
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const CLUB_IDX = 7734;

const LEAGUE_MATCHERS = {
  '2025_gongju':         { pattern: /금강토요|공주.*금강/ },
  '2022_daedeok':        { pattern: /대덕구.*토요\s*4부/ },
  '2022_sejong_1':       { pattern: /세종.*토요\s*4부\)$/ },
  '2022_sejong_2':       { pattern: /세종.*토요\s*4부\(/ },
  '2021_daedeok':        { pattern: /대덕구.*토요\s*4부/ },
  '2021_sejong_1':       { pattern: /세종.*토요\s*4부/, textMatch: /^(?!.*평일|.*후기)/ },
  '2021_sejong_weekday': { pattern: /세종.*평일\s*4부/ },
  '2021_sejong_2':       { pattern: /세종.*토요\s*4부/, pickIndex: 'last' },
  '2020_daejeon':        { pattern: /대전.*토요\s*3부/ },
  '2020_sejong':         { pattern: /세종.*토요\s*4부/ },
  '2019_daejeon':        { pattern: /대전.*토요\s*3부/ },
  '2019_sejong':         { pattern: /세종.*토요\s*4부/ },
  '2018_donggu':         { pattern: /동구.*토요|대전.*동구/ },
  '2018_daejeon':        { pattern: /대전.*토요\s*3부/ },
  '2017_kukmin_nanum':   { pattern: /토요\s*나눔/ },
  '2017_kukmin_eoul':    { pattern: /토요\s*어울/ },
  '2017_daejeon':        { pattern: /대전.*토요\s*3부/ },
  '2016_daedeok':        { pattern: /대덕구.*토요\s*3부\s*B|토요\s*3부\s*B/ },
  '2016_daejeon_geumgang': { pattern: /대전.*토요금강|토요금강/ },
  '2015_donggu_taebaek': { pattern: /태백|동구/ },
  '2015_daejeon_geumgang': { pattern: /토요금강|대전.*금강/ },
  '2014_kukmin_chugye':  { pattern: /추계|금강/ },
  '2014_myeongpum':      { pattern: /명품/ },
  '2013_kukmin_chugye':  { pattern: /추계|금강/ },
  '2013_myeongpum':      { pattern: /명품/ },
  '2012_kukmin_chugye':  { pattern: /추계|토요추계/ },
  '2012_daejeon':        { pattern: /대전.*토요/, textMatch: /^(?!.*추계)/ },
  '2011_geumgang':       { pattern: /금강|대전/ },
  '2010_geumgang':       { pattern: /금강|대전/ }
};

function escStr(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function selectYearAndLeague(page, baseUrl, year, leagueValue) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  await page.selectOption('select[name="season"]', String(year)).catch(() => {});
  await page.waitForTimeout(2000);
  // Click 리그 tab
  await page.evaluate(() => { document.querySelectorAll('.game_tab li a').forEach(a => { if (a.textContent.trim() === '리그') a.click(); }); });
  await page.waitForTimeout(1500);
  // Select league
  await page.evaluate((v) => { const s = document.querySelectorAll('select')[1]; if(s){s.value=v; s.dispatchEvent(new Event('change'));} }, leagueValue);
  await page.waitForTimeout(3000);
}

async function scrapeTable(page, tableIndex) {
  return await page.evaluate((ti) => {
    const tbl = document.querySelectorAll('table')[ti];
    if (!tbl) return { headers: [], rows: [] };
    const ths = Array.from(tbl.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const rows = [];
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      // 순위/이름은 <th>, 나머지는 <td> — 모든 children을 순서대로 읽음
      const cells = Array.from(tr.children).map(c => c.textContent.trim());
      if (cells.length > 5) rows.push(cells);
    });
    return { headers: ths, rows };
  }, tableIndex);
}

function parseHitters(headers, rows) {
  const gi = (col) => headers.indexOf(col);
  const players = [];
  rows.forEach(vals => {
    const nameRaw = vals[gi('이름')] || '';
    const numMatch = nameRaw.match(/\((\d+)\)/);
    const name = nameRaw.replace(/\(\d+\)/, '').trim();
    const number = numMatch ? parseInt(numMatch[1]) : 0;
    if (!name) return;
    const v = (col) => { const i = gi(col); return i >= 0 ? (parseInt(vals[i]) || 0) : 0; };
    const f = (col) => { const i = gi(col); return i >= 0 ? (parseFloat(vals[i]) || 0) : 0; };
    players.push({
      name, number,
      G: v('게임수') || v('경기') || v('경기수'),
      PA: v('타석'), AB: v('타수'), H: v('총안타'),
      '2B': v('2루타'), '3B': v('3루타'), HR: v('홈런'),
      RBI: v('타점'), R: v('득점'), SB: v('도루'),
      BB: v('볼넷'), HBP: v('사구'), SO: v('삼진'),
      kOBP: f('출루율'), kSLG: f('장타율'), kOPS: f('OPS')
    });
  });
  return players;
}

function parsePitchers(headers, rows) {
  const gi = (col) => headers.indexOf(col);
  const pitchers = [];
  rows.forEach(vals => {
    const nameRaw = vals[gi('이름')] || '';
    const numMatch = nameRaw.match(/\((\d+)\)/);
    const name = nameRaw.replace(/\(\d+\)/, '').trim();
    const number = numMatch ? parseInt(numMatch[1]) : 0;
    if (!name) return;
    const v = (col) => { const i = gi(col); return i >= 0 ? (parseInt(vals[i]) || 0) : 0; };
    const f = (col) => { const i = gi(col); return i >= 0 ? (parseFloat(vals[i]) || 0) : 0; };
    const s = (col) => { const i = gi(col); return i >= 0 ? vals[i] : '0'; };
    pitchers.push({
      name, number,
      G: v('게임수') || v('경기수') || v('경기'),
      W: v('승'), L: v('패'), SV: v('세'), HD: v('홀드'),
      IP: s('이닝'), BF: v('타자'), NP: v('투구수'),
      pH: v('피안타'), pHR: v('피홈런'),
      K: v('탈삼진'), pBB: v('볼넷'), pIBB: v('고의4구'), pHBP: v('사구'),
      R: v('실점'), ER: v('자책점')
    });
  });
  return pitchers;
}

function buildPlayersJs(players) {
  if (!players || players.length === 0) return '{}';
  return '{' + players.map((p, i) => {
    let s = `p${i+1}:{name:'${escStr(p.name)}',number:${p.number}`;
    ['G','PA','AB','H','2B','3B','HR','RBI','R','SB','BB','HBP','SO'].forEach(k => {
      const key = /^\d/.test(k) ? `'${k}'` : k;
      s += `,${key}:${p[k]||0}`;
    });
    if (p.kOBP) s += `,kOBP:${p.kOBP}`;
    if (p.kSLG) s += `,kSLG:${p.kSLG}`;
    if (p.kOPS) s += `,kOPS:${p.kOPS}`;
    return s + '}';
  }).join(',') + '}';
}

function buildPitchersJs(pitchers) {
  if (!pitchers || pitchers.length === 0) return '{}';
  return '{' + pitchers.map((p, i) => {
    const ipVal = parseFloat(p.IP) || 0;
    let s = `pt${i+1}:{name:'${escStr(p.name)}',num:${p.number}`;
    s += `,G:${p.G||0},W:${p.W||0},L:${p.L||0},SV:${p.SV||0},HD:${p.HD||0},IP:${ipVal}`;
    s += `,pH:${p.pH||0},pHR:${p.pHR||0},K:${p.K||0},pBB:${p.pBB||0},pIBB:${p.pIBB||0},pHBP:${p.pHBP||0}`;
    s += `,R:${p.R||0},ER:${p.ER||0}`;
    return s + '}';
  }).join(',') + '}';
}

function replaceBlock(html, entryId, blockName, newContent) {
  const idRe = new RegExp(`id\\s*:\\s*['"]${entryId}['"]`);
  const idMatch = idRe.exec(html);
  if (!idMatch) return html;
  let si = idMatch.index;
  while (si > 0 && html[si] !== '{') si--;

  const slice = html.substring(si, si + 80000);
  const blockRe = new RegExp(blockName + ':\\{');
  const bm = blockRe.exec(slice);
  if (!bm) return html;

  let depth = 1, j = bm.index + bm[0].length;
  let inStr = false, strCh = '', esc = false;
  while (j < slice.length && depth > 0) {
    const c = slice[j];
    if (esc) { esc = false; j++; continue; }
    if (c === '\\' && inStr) { esc = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    j++;
  }
  return html.substring(0, si + bm.index) + blockName + ':' + newContent + html.substring(si + j);
}

async function main() {
  console.log('=== gameone.kr 선수 기록 전체 재수집 ===\n');

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const m = html.match(/const ALL_DATA = (\[[\s\S]*?\n\]);/);
  if (!m) { console.error('ALL_DATA 못 찾음'); process.exit(1); }
  let DATA; eval('DATA = ' + m[1]);

  const targets = DATA.filter(e => e.source === 'gameone.kr');
  const years = [...new Set(targets.map(e => e.year))].sort();
  console.log(`대상 엔트리: ${targets.length}개\n`);

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });

  let successCount = 0, failCount = 0;

  for (const year of years) {
    console.log(`\n=== ${year} ===`);
    const yearEntries = targets.filter(e => e.year === year);

    // Get league options for this year
    const optPage = await browser.newPage();
    let leagueOpts = [];
    try {
      await optPage.goto(`https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, { waitUntil: 'networkidle', timeout: 30000 });
      await optPage.waitForTimeout(2000);
      await optPage.selectOption('select[name="season"]', String(year)).catch(() => {});
      await optPage.waitForTimeout(2000);
      await optPage.evaluate(() => { document.querySelectorAll('.game_tab li a').forEach(a => { if (a.textContent.trim() === '리그') a.click(); }); });
      await optPage.waitForTimeout(2000);
      leagueOpts = await optPage.evaluate(() => {
        const s = document.querySelectorAll('select')[1];
        if (!s) return [];
        return Array.from(s.options).filter(o => o.value !== '{}').map(o => ({ text: o.textContent.trim(), value: o.value }));
      });
      console.log(`  리그 옵션: ${leagueOpts.map(o => o.text).join(' | ')}`);
    } catch (e) {
      console.log(`  리그 옵션 로드 실패: ${e.message}`);
    }
    await optPage.close();

    for (const entry of yearEntries) {
      const matcher = LEAGUE_MATCHERS[entry.id];
      if (!matcher) { console.log(`  [${entry.id}] 매칭 규칙 없음`); failCount++; continue; }

      const matches = leagueOpts.filter(o => matcher.pattern.test(o.text) && (!matcher.textMatch || matcher.textMatch.test(o.text)));
      let opt = matches[0];
      if (matcher.pickIndex === 'last' && matches.length > 1) opt = matches[matches.length - 1];
      if (!opt) { console.log(`  [${entry.id}] 매칭 리그 없음`); failCount++; continue; }

      console.log(`  [${entry.id}] → ${opt.text}`);

      try {
        const page = await browser.newPage();

        // Hitter
        await selectYearAndLeague(page, `https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, year, opt.value);
        const hitData = await scrapeTable(page, 1); // table[1] = 리그 tab
        const hitters = parseHitters(hitData.headers, hitData.rows);

        // Pitcher
        await selectYearAndLeague(page, `https://www.gameone.kr/club/info/ranking/pitcher?club_idx=${CLUB_IDX}`, year, opt.value);
        const pitData = await scrapeTable(page, 1);
        const pitchers = parsePitchers(pitData.headers, pitData.rows);

        await page.close();

        if (hitters.length > 0) html = replaceBlock(html, entry.id, 'players', buildPlayersJs(hitters));
        if (pitchers.length > 0) html = replaceBlock(html, entry.id, 'pitchers', buildPitchersJs(pitchers));

        console.log(`    ✓ 타자 ${hitters.length}명, 투수 ${pitchers.length}명`);
        successCount++;
      } catch (e) {
        console.log(`    에러: ${e.message}`);
        failCount++;
      }
    }
  }

  await browser.close();
  fs.writeFileSync(INDEX_FILE, html, 'utf-8');

  console.log(`\n=== 완료 ===`);
  console.log(`성공: ${successCount}, 실패: ${failCount}, 총: ${targets.length}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
