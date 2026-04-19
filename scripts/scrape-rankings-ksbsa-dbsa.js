/**
 * ksbsa / donggu.dbsa.kr / daedeokgu.dbsa.kr 팀순위 스크래퍼
 * - null-rankings 엔트리를 타깃
 * - 각 엔트리별 fixed 맵: {year, host, top, low}
 * - getTeamRankList.hs 에서 table #1 에서 팀순위 테이블 파싱
 * - 결과를 scrape_debug/rankings/<entryId>.json 저장
 *
 * 결과 포맷 (gameone 방식과 동일):
 *   배열: [{rank,team,pts,G,W,L,D,RS,RA}, ...]
 *   조별: {A:[...], B:[...]}
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'rankings');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

// 엔트리별 스크래핑 맵 (null-rankings 타깃)
// group: 여러 조 중 한 조에 속할 때 {A: {top,low}, B: {top,low}} 형태로
const TARGETS = [
  // 2023 sejong 세종 - 토요4부 정규
  { id: '2023_sejong', year: 2023, host: 'https://www.ksbsa.or.kr',
    groups: { A: { top: 26, low: 27 }, B: { top: 26, low: 28 } } },
  // 2023 sejong po - 플레이오프
  { id: '2023_sejong_po', year: 2023, host: 'https://www.ksbsa.or.kr',
    single: { top: 26, low: 152 } },
  // 2023 sejong inter - 인터리그 (따로 리그 없음 -> skip)
  // 2023_sejong_inter 는 건너뜀
  // 2023 daedeok - 대덕구 토요A (2023 대덕 site 는 top=25)
  { id: '2023_daedeok', year: 2023, host: 'https://daedeokgu.dbsa.kr',
    single: { top: 25, low: 27 } },
  // 2024 daedeok - 대덕구 토요A
  { id: '2024_daedeok', year: 2024, host: 'https://daedeokgu.dbsa.kr',
    single: { top: 25, low: 27 } },
  // 2025 sejong cup - 시장기 / 협회장기 (일단 시도)
  // 아래 top 값은 team page 에서 발견한 것 (204=시장기, 233=협회장기)
  // 단 lower 옵션이 있을지 미지수 - 실행시 찾음
  // 2025_gongju gameone 는 별도 스크립트에서

  // 기존 rankings 가 있는 ksbsa/dbsa 엔트리도 재스크래핑
  // top-league seq는 team 페이지 UI 옵션 기준으로 사용 (연도별로 다름)
  { id: '2024_sejong', year: 2024, host: 'https://www.ksbsa.or.kr',
    single: { top: 115, low: 118 } },   // 토요3부
  { id: '2025_sejong', year: 2025, host: 'https://www.ksbsa.or.kr',
    single: { top: 177, low: 183 } },   // 토요4부
  { id: '2026_sejong', year: 2026, host: 'https://www.ksbsa.or.kr',
    groups: { 'A': { top: 242, low: 248 }, 'B': { top: 242, low: 257 } } },  // 토요4부 A조/B조
  { id: '2026_donggu', year: 2026, host: 'https://donggu.dbsa.kr',
    single: { top: 44, low: 47 } },   // 동구 토요리그
  // 2025 cup events
  { id: '2025_sejong_cup1', year: 2025, host: 'https://www.ksbsa.or.kr',
    single: { top: 204, low: 209 } },  // 시장기 E조
  { id: '2025_sejong_cup2', year: 2025, host: 'https://www.ksbsa.or.kr',
    single: { top: 233, low: 234 } },  // 협회장기 토너먼트
];

async function scrapeRankTable(page, url) {
  await page.goto(url, { waitUntil: 'networkidle', timeout: 25000 });
  await page.waitForTimeout(1500);
  return page.evaluate(() => {
    const tbls = document.querySelectorAll('table');
    for (const t of tbls) {
      const ths = Array.from(t.querySelectorAll('th')).map(x => x.textContent.trim()).join('|');
      if (ths.includes('순위') && ths.includes('팀명') && ths.includes('승점')) {
        const rows = Array.from(t.querySelectorAll('tbody tr')).map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));
        return rows;
      }
    }
    return [];
  });
}

function parseRow(prevRank, index, cells) {
  // ksbsa/dbsa 포맷: [순위, 팀명, 승점, 경기, 승, 패, 무, 득점, 실점, ...]
  // rank 1-3 은 medal 아이콘으로 표시되어 cell 이 공백일 수 있음.
  // 2~3등이 동률인 경우도 있으므로 승점 비교로 판단 필요.
  let rank;
  const raw = (cells[0] || '').trim();
  if (raw === '' || raw === null || raw === undefined) {
    rank = null;  // caller가 결정
  } else {
    const m = raw.match(/\d+/);
    rank = m ? parseInt(m[0]) : null;
  }
  if (!cells[1]) return null;
  const team = cells[1].trim();
  if (!team) return null;
  // 나머지 필드
  const numOrNull = (v) => {
    if (v === '-' || v === '' || v === undefined || v === null) return 0;
    const n = parseInt(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };
  return {
    rank,
    team,
    pts: numOrNull(cells[2]),
    G:   numOrNull(cells[3]),
    W:   numOrNull(cells[4]),
    L:   numOrNull(cells[5]),
    D:   numOrNull(cells[6]),
    RS:  numOrNull(cells[7]),
    RA:  numOrNull(cells[8]),
  };
}

function rowsToRankings(rawRows) {
  const out = [];
  let index = 0;
  for (const r of rawRows) {
    if (r.length < 5) continue;
    const p = parseRow(null, index, r);
    if (p) { out.push(p); index++; }
  }
  // 2단계: blank-rank 행들의 rank 결정
  // 전략: 승점(pts)을 기준으로 그룹화해서 같은 pts끼리 동률 처리
  // 첫 blank 를 만나면 index+1 부터 순차로, 이전 row와 pts 같으면 rank 공유
  let lastRank = 0;
  let lastPts = null;
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    if (r.rank === null) {
      if (lastPts !== null && r.pts === lastPts) {
        r.rank = lastRank;
      } else {
        r.rank = i + 1;
      }
    }
    lastRank = r.rank;
    lastPts = r.pts;
  }
  return out;
}

async function main() {
  console.log('=== ksbsa/dbsa 팀순위 스크래퍼 ===');
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors','--no-sandbox'] });
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  const summary = [];
  for (const t of TARGETS) {
    try {
      console.log(`\n[${t.id}] year=${t.year}`);
      let result;
      if (t.groups) {
        result = {};
        for (const [label, p] of Object.entries(t.groups)) {
          const url = `${t.host}/record/getTeamRankList.hs?leagueCategory=NORMAL&searchYear=${t.year}&searchTopLeagueSeq=${p.top}&searchLowerLeagueSeq=${p.low}`;
          const raw = await scrapeRankTable(page, url);
          const rows = rowsToRankings(raw);
          console.log(`  ${label}조: ${rows.length}팀`);
          result[label] = rows;
          await page.waitForTimeout(500);
        }
      } else if (t.single) {
        const url = `${t.host}/record/getTeamRankList.hs?leagueCategory=NORMAL&searchYear=${t.year}&searchTopLeagueSeq=${t.single.top}&searchLowerLeagueSeq=${t.single.low}`;
        const raw = await scrapeRankTable(page, url);
        result = rowsToRankings(raw);
        console.log(`  ${result.length}팀`);
      }
      // 와인드업 확인 (로깅용)
      let windupRow = null;
      let windupLabel = '';
      if (Array.isArray(result)) {
        windupRow = result.find(r => /와인드업/.test(r.team));
      } else {
        for (const [k, arr] of Object.entries(result)) {
          const w = arr.find(r => /와인드업/.test(r.team));
          if (w) { windupRow = w; windupLabel = k; break; }
        }
      }
      console.log(`  와인드업: ${windupRow ? `${windupLabel}조 ${windupRow.rank}위 ${windupRow.W}-${windupRow.L}-${windupRow.D} RS${windupRow.RS}/RA${windupRow.RA}` : '(없음)'}`);

      fs.writeFileSync(path.join(DEBUG_DIR, `${t.id}.json`), JSON.stringify(result, null, 2), 'utf8');
      summary.push(`${t.id}: ok`);
    } catch (e) {
      console.error(`  ERR: ${e.message}`);
      summary.push(`${t.id}: ERR ${e.message}`);
    }
    await page.waitForTimeout(500);
  }

  await browser.close();
  console.log('\n=== 요약 ===');
  summary.forEach(s => console.log('  ' + s));
}

main().catch(err => { console.error(err); process.exit(1); });
