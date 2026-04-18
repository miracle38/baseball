/**
 * Phase 1: 와인드업 팀 전수조사 (gameone 리그 단위)
 * - tmp_chuhs_progress.json 의 groupsCache 를 사용해 (lig_idx, season, group_code) 조합 리스트 재구성
 * - 각 조합에서 batter/pitcher 랭킹 페이지를 열어 "와인드업" 또는 "에스메카 와인드업" 팀 선수만 필터
 * - 결과: tmp_windup_all_leagues.json
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const PROGRESS_FILE = path.join(__dirname, '..', 'tmp_chuhs_progress.json');
const OUT_FILE = path.join(__dirname, '..', 'tmp_windup_all_leagues.json');
const SCRAPE_PROGRESS = path.join(__dirname, '..', 'tmp_windup_scrape_progress.json');

const LEAGUE_NAMES = {
  45:  '대전광역시 동구 야구연합회',
  63:  '대덕구야구연합회',
  108: '국민생활체육 대전광역시 야구연합회',
  113: '대전광역시 야구소프트볼협회',
  199: '국민생활체육 대전광역시(구)',
  432: '대전명품리그',
  495: '세종특별자치시 야구소프트볼협회',
};

function normalizeTeam(s) {
  if (!s) return '';
  return s.replace(/\s+/g, '').trim();
}

function isWindup(teamName) {
  const t = normalizeTeam(teamName);
  return t === '와인드업' || t === '에스메카와인드업' || t.includes('와인드업');
}

async function scrapePlayerList(page, type, ligIdx, season, groupCode) {
  const url = `https://www.gameone.kr/league/record/content/${type}?lig_idx=${ligIdx}&season=${season}&group_code=${groupCode}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch { return null; }
  }
  await page.waitForTimeout(400);
  return await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    // Page structure: may contain up to 4 tables:
    //   - "규정타석" top group (small row count, 3-col + 32-col pair)
    //   - "전체" full group (larger row count, 3-col + 32-col pair)
    // A row may be present in one but not the other (e.g. unqualified PA / full not showing all).
    // Strategy: collect rows from ALL tables that have the maximum column count (32). Dedupe by name.
    const candidateTables = [];
    let maxCols = 0;
    tables.forEach(tbl => {
      let ths = [];
      const thead = tbl.querySelector('thead');
      if (thead) {
        ths = Array.from(thead.querySelectorAll('th')).map(t => t.textContent.trim());
      } else {
        const firstRow = tbl.querySelector('tr');
        if (firstRow) ths = Array.from(firstRow.querySelectorAll('th, td')).map(t => t.textContent.trim());
      }
      if (ths.length === 0) return;
      if (ths.length > maxCols) maxCols = ths.length;
      candidateTables.push({ tbl, ths });
    });
    // Only keep tables with the max column count (to skip the small 3-column "rank/name/team" tables)
    const fullTables = candidateTables.filter(x => x.ths.length === maxCols);
    const rows = [];
    const headers = fullTables.length ? fullTables[0].ths : [];
    const seen = new Set();
    fullTables.forEach(({ tbl, ths }) => {
      const nameIdx = ths.indexOf('이름');
      const teamIdx = ths.indexOf('팀명');
      const bodyRows = tbl.tBodies[0] ? Array.from(tbl.tBodies[0].querySelectorAll('tr')) : Array.from(tbl.querySelectorAll('tr')).slice(1);
      bodyRows.forEach(tr => {
        const cells = Array.from(tr.children).map(c => c.textContent.trim());
        if (cells.length < 3) return;
        const name = nameIdx >= 0 ? cells[nameIdx] : cells[1] || '';
        const team = teamIdx >= 0 ? cells[teamIdx] : cells[2] || '';
        const key = `${name}::${team}`;
        if (seen.has(key)) return;
        seen.add(key);
        rows.push({ ths, cells });
      });
    });
    return { headers, rows };
  });
}

function cellsToObj(headers, cells) {
  const obj = {};
  headers.forEach((h, i) => { obj[h] = cells[i] !== undefined ? cells[i] : ''; });
  return obj;
}

function loadScrapeProg() {
  if (fs.existsSync(SCRAPE_PROGRESS)) {
    try { return JSON.parse(fs.readFileSync(SCRAPE_PROGRESS, 'utf-8')); } catch {}
  }
  return { done: {}, results: {} };
}

function saveScrapeProg(p) {
  fs.writeFileSync(SCRAPE_PROGRESS, JSON.stringify(p, null, 2), 'utf-8');
}

async function main() {
  // Build combination list from groupsCache
  const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
  const combos = [];
  Object.keys(progress.groupsCache).forEach(cacheKey => {
    const [ligIdx, year] = cacheKey.split('_');
    const groups = progress.groupsCache[cacheKey];
    groups.forEach(g => {
      combos.push({ ligIdx, year: parseInt(year), groupCode: g.value, groupName: g.text });
    });
  });
  combos.sort((a, b) => a.ligIdx.localeCompare(b.ligIdx) || a.year - b.year || a.groupCode - b.groupCode);
  console.log(`총 조합: ${combos.length}`);

  const scrapeProg = loadScrapeProg();
  console.log(`기존 스크래핑 완료: ${Object.keys(scrapeProg.done).length}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(25000);
  try {
    await page.goto('https://www.gameone.kr/league/?lig_idx=113', { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(500);
  } catch {}

  let count = 0;
  const startTs = Date.now();
  const TIMEOUT_MS = 115 * 60 * 1000; // 115 min total

  for (const c of combos) {
    const key = `${c.ligIdx}_${c.year}_${c.groupCode}`;
    if (scrapeProg.done[key]) { count++; continue; }
    if (Date.now() - startTs > TIMEOUT_MS) {
      console.log('타임아웃 — 나머지 조합 skip');
      break;
    }
    const result = { ligIdx: c.ligIdx, year: c.year, groupCode: c.groupCode, groupName: c.groupName, batters: [], pitchers: [] };

    // batter
    try {
      const bd = await scrapePlayerList(page, 'batter', c.ligIdx, c.year, c.groupCode);
      if (bd && bd.rows) {
        for (const r of bd.rows) {
          const teamIdx = r.ths.indexOf('팀명');
          const nameIdx = r.ths.indexOf('이름');
          const team = teamIdx >= 0 ? r.cells[teamIdx] : '';
          const name = nameIdx >= 0 ? r.cells[nameIdx] : '';
          if (isWindup(team)) {
            result.batters.push({ name, team, stats: cellsToObj(r.ths, r.cells) });
          }
        }
      }
    } catch (e) {}

    // pitcher
    try {
      const pd = await scrapePlayerList(page, 'pitcher', c.ligIdx, c.year, c.groupCode);
      if (pd && pd.rows) {
        for (const r of pd.rows) {
          const teamIdx = r.ths.indexOf('팀명');
          const nameIdx = r.ths.indexOf('이름');
          const team = teamIdx >= 0 ? r.cells[teamIdx] : '';
          const name = nameIdx >= 0 ? r.cells[nameIdx] : '';
          if (isWindup(team)) {
            result.pitchers.push({ name, team, stats: cellsToObj(r.ths, r.cells) });
          }
        }
      }
    } catch (e) {}

    scrapeProg.results[key] = result;
    scrapeProg.done[key] = true;
    count++;

    if (result.batters.length || result.pitchers.length) {
      console.log(`[${count}/${combos.length}] ${key} (${c.groupName}) — B:${result.batters.length} P:${result.pitchers.length}`);
    } else if (count % 20 === 0) {
      console.log(`[${count}/${combos.length}] ${key} empty`);
    }

    if (count % 10 === 0) saveScrapeProg(scrapeProg);
  }

  saveScrapeProg(scrapeProg);
  await browser.close();

  // Build final output: only keys that have data
  const withData = {};
  Object.keys(scrapeProg.results).forEach(k => {
    const r = scrapeProg.results[k];
    if (r.batters.length || r.pitchers.length) withData[k] = r;
  });

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    totalCombos: combos.length,
    scanned: Object.keys(scrapeProg.done).length,
    combosWithWindup: Object.keys(withData).length,
    data: withData,
    leagueNames: LEAGUE_NAMES
  }, null, 2), 'utf-8');

  console.log(`\n=== 완료 ===`);
  console.log(`조합 수: ${combos.length}`);
  console.log(`스캔됨: ${Object.keys(scrapeProg.done).length}`);
  console.log(`와인드업 발견: ${Object.keys(withData).length}`);
  console.log(`출력: ${OUT_FILE}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
