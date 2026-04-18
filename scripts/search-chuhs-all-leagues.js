/**
 * gameone.kr 대전/세종/충남 전 리그 × 2010~2025 전수조사
 * - 리그 전체 타자/투수 랭킹 페이지에서 "추혜승" 검색
 * - URL: /league/record/content/batter?lig_idx=X&season=Y&group_code=Z[&part_code=W]
 * - URL: /league/record/content/pitcher?lig_idx=X&season=Y&group_code=Z[&part_code=W]
 *
 * 발견 시: {year, league, group, part, teamName, position(hitter/pitcher), stats} 기록
 * 결과 → tmp_chuhs_all_leagues.json
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const OUT_FILE = path.join(__dirname, '..', 'tmp_chuhs_all_leagues.json');
const PROGRESS_FILE = path.join(__dirname, '..', 'tmp_chuhs_progress.json');

// 대전·세종·충남권 리그 (lig_idx 목록)
// tmp_chuhs.json 및 기존 inspect 스크립트에서 등장한 lig_idx들
const TARGET_LEAGUES = {
  45:  '대전광역시 동구 야구연합회',
  63:  '대덕구야구연합회',
  108: '국민생활체육 대전광역시 야구연합회',
  113: '대전광역시 야구소프트볼협회',
  199: '국민생활체육 대전광역시(구)',
  432: '대전명품리그',
  495: '세종특별자치시 야구소프트볼협회',
  // 추가로 시도해볼 근접 lig_idx (스캔용)
};

const YEARS = [2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];

function matchesChuhs(nameRaw) {
  if (!nameRaw) return false;
  const stripped = nameRaw.replace(/\s+/g, '');
  // (숫자) 등번호 제거 후 비교
  const core = stripped.replace(/\(\d+\)/g, '');
  return core.includes('추혜승');
}

async function getGroupOptionsFromTeamRank(page, ligIdx, season) {
  // 팀랭킹 페이지에서 해당 season의 group_code 옵션 전체 수집
  const url = `https://www.gameone.kr/league/record/content/rank?lig_idx=${ligIdx}&group_code=0&season=${season}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    } catch { return []; }
  }
  await page.waitForTimeout(800);
  return await page.evaluate(() => {
    const result = [];
    const gs = Array.from(document.querySelectorAll('select')).find(s => s.name === 'group_code');
    if (!gs) return result;
    Array.from(gs.options).forEach(o => {
      const v = parseInt(o.value);
      if (v > 0) result.push({ value: v, text: o.textContent.trim() });
    });
    return result;
  });
}

async function scrapePlayerList(page, type, ligIdx, season, groupCode) {
  const url = `https://www.gameone.kr/league/record/content/${type}?lig_idx=${ligIdx}&season=${season}&group_code=${groupCode}`;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
  } catch {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    } catch { return null; }
  }
  await page.waitForTimeout(500);
  return await page.evaluate(() => {
    // 모든 테이블 병합하여 rows 추출
    const allRows = [];
    let bestHeaders = [];
    document.querySelectorAll('table').forEach(tbl => {
      const ths = Array.from(tbl.querySelectorAll('thead th, tr:first-child th')).map(t => t.textContent.trim());
      const hasIreum = ths.includes('이름') || ths.some(x => /이름/.test(x));
      if (ths.length > bestHeaders.length) bestHeaders = ths;
      tbl.querySelectorAll('tbody tr').forEach(tr => {
        const cells = Array.from(tr.children).map(c => c.textContent.trim());
        if (cells.length >= 3) allRows.push({ ths, cells });
      });
    });
    return { headers: bestHeaders, rows: allRows };
  });
}

function loadProgress() {
  if (fs.existsSync(PROGRESS_FILE)) {
    try { return JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')); } catch {}
  }
  return { done: {}, found: [], groupsCache: {} };
}

function saveProgress(p) {
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify(p, null, 2), 'utf-8');
}

async function main() {
  const progress = loadProgress();
  console.log('=== 추혜승 전 리그 검색 (gameone.kr) ===');
  console.log(`대상 리그: ${Object.keys(TARGET_LEAGUES).length}개`);
  console.log(`대상 연도: ${YEARS[0]}~${YEARS[YEARS.length-1]}`);
  console.log(`기존 진행: ${Object.keys(progress.done).length}개 조합 완료, ${progress.found.length}건 발견\n`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);

  // 세션 확보
  try {
    await page.goto('https://www.gameone.kr/league/?lig_idx=113', { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);
  } catch {}

  let totalChecks = 0;

  for (const ligIdx of Object.keys(TARGET_LEAGUES)) {
    const ligName = TARGET_LEAGUES[ligIdx];
    for (const year of YEARS) {
      // group_code 옵션 수집 (캐시)
      const cacheKey = `${ligIdx}_${year}`;
      let groups = progress.groupsCache[cacheKey];
      if (!groups) {
        try {
          groups = await getGroupOptionsFromTeamRank(page, ligIdx, year);
        } catch (e) {
          groups = [];
        }
        progress.groupsCache[cacheKey] = groups;
        saveProgress(progress);
      }
      if (groups.length === 0) {
        // console.log(`  [${ligIdx}/${year}] group 없음 SKIP`);
        continue;
      }
      console.log(`\n[lig=${ligIdx} ${ligName.slice(0,20)} / ${year}] groups: ${groups.length}개`);

      for (const g of groups) {
        const key = `${ligIdx}_${year}_${g.value}`;
        if (progress.done[key]) continue;

        // 타자 랭킹
        let hitterData = null;
        try {
          hitterData = await scrapePlayerList(page, 'batter', ligIdx, year, g.value);
        } catch (e) {}
        if (hitterData && hitterData.rows.length > 0) {
          for (const row of hitterData.rows) {
            // '이름' 컬럼 찾기
            const nameIdx = row.ths.indexOf('이름');
            let nameRaw = '';
            if (nameIdx >= 0) nameRaw = row.cells[nameIdx] || '';
            else {
              // heuristic: 3번째 셀이 이름일 확률이 높음
              nameRaw = row.cells[1] || row.cells[2] || '';
            }
            if (matchesChuhs(nameRaw)) {
              // team 찾기
              const teamIdx = row.ths.indexOf('팀명');
              const team = teamIdx >= 0 ? row.cells[teamIdx] : '?';
              const hit = {
                lig_idx: ligIdx, ligName, year, group_code: g.value, groupName: g.text,
                type: 'batter', name: nameRaw, team,
                headers: row.ths, cells: row.cells
              };
              progress.found.push(hit);
              console.log(`  *** 발견 (타자): ${year} ${ligName} ${g.text} / ${nameRaw} / 팀: ${team}`);
            }
          }
        }

        // 투수 랭킹
        let pitcherData = null;
        try {
          pitcherData = await scrapePlayerList(page, 'pitcher', ligIdx, year, g.value);
        } catch (e) {}
        if (pitcherData && pitcherData.rows.length > 0) {
          for (const row of pitcherData.rows) {
            const nameIdx = row.ths.indexOf('이름');
            let nameRaw = '';
            if (nameIdx >= 0) nameRaw = row.cells[nameIdx] || '';
            else nameRaw = row.cells[1] || row.cells[2] || '';
            if (matchesChuhs(nameRaw)) {
              const teamIdx = row.ths.indexOf('팀명');
              const team = teamIdx >= 0 ? row.cells[teamIdx] : '?';
              const hit = {
                lig_idx: ligIdx, ligName, year, group_code: g.value, groupName: g.text,
                type: 'pitcher', name: nameRaw, team,
                headers: row.ths, cells: row.cells
              };
              progress.found.push(hit);
              console.log(`  *** 발견 (투수): ${year} ${ligName} ${g.text} / ${nameRaw} / 팀: ${team}`);
            }
          }
        }

        progress.done[key] = {
          hitterRows: hitterData ? hitterData.rows.length : 0,
          pitcherRows: pitcherData ? pitcherData.rows.length : 0
        };
        totalChecks++;
        if (totalChecks % 20 === 0) {
          saveProgress(progress);
          console.log(`    ... ${totalChecks} checks, ${progress.found.length} matches so far`);
        }
      }
      saveProgress(progress);
    }
  }

  await browser.close();

  fs.writeFileSync(OUT_FILE, JSON.stringify({
    leagues: TARGET_LEAGUES,
    years: YEARS,
    totalChecks,
    found: progress.found,
    groupsCache: progress.groupsCache
  }, null, 2), 'utf-8');

  console.log(`\n=== 완료 ===`);
  console.log(`총 조회: ${Object.keys(progress.done).length} 조합`);
  console.log(`발견: ${progress.found.length} 건`);
  progress.found.forEach(f => {
    console.log(`  - ${f.year} ${f.ligName} ${f.groupName} (${f.type}) ${f.name} @ ${f.team}`);
  });
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
