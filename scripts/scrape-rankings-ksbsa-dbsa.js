/**
 * ksbsa / donggu.dbsa.kr / daedeokgu.dbsa.kr 팀순위 스크래퍼
 * - 각 엔트리별 fixed 맵: {year, host, top, low}
 * - getTeamRankList.hs 에서 팀순위 테이블 파싱
 * - 결과를 scrape_debug/rankings/<entryId>.json 저장
 * - index.html 의 해당 엔트리 rankings / seasonSummary 필드 갱신
 *
 * 결과 포맷 (gameone 방식과 동일):
 *   배열: [{rank,team,pts,G,W,L,D,RS,RA}, ...]
 *   조별: {A:[...], B:[...]}
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
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
  // 2023 daedeok - 대덕구 토요A
  { id: '2023_daedeok', year: 2023, host: 'https://daedeokgu.dbsa.kr',
    single: { top: 25, low: 27 } },
  // 2024 daedeok - 대덕구 토요A
  { id: '2024_daedeok', year: 2024, host: 'https://daedeokgu.dbsa.kr',
    single: { top: 25, low: 27 } },

  // 기존 rankings 가 있는 ksbsa/dbsa 엔트리도 재스크래핑
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
  let rank;
  const raw = (cells[0] || '').trim();
  if (raw === '' || raw === null || raw === undefined) {
    rank = null;
  } else {
    const m = raw.match(/\d+/);
    rank = m ? parseInt(m[0]) : null;
  }
  if (!cells[1]) return null;
  const team = cells[1].trim();
  if (!team) return null;
  const numOrNull = (v) => {
    if (v === '-' || v === '' || v === undefined || v === null) return 0;
    const n = parseInt(String(v).replace(/,/g, ''));
    return isNaN(n) ? 0 : n;
  };
  const str = (v) => (v === undefined || v === null) ? '' : String(v).trim();
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
    H:   numOrNull(cells[9]),   // 안타
    E:   numOrNull(cells[10]),  // 실책
    BBHBP: numOrNull(cells[11]),// 사사구
    recent10: str(cells[12]),   // 최근 10경기 (문자열)
    streak:   str(cells[13]),   // 연속
    away:     str(cells[14]),   // 선공
    home:     str(cells[15]),   // 후공
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

// ---------- index.html 주입 로직 (gameone 버전과 동일) ----------

function rankArrayToJs(rankings) {
  const s = (v) => `'${String(v == null ? '' : v).replace(/'/g, "\\'")}'`;
  return '[' + rankings.map(r => {
    const team = String(r.team).replace(/'/g, "\\'");
    return `{rank:${r.rank},team:'${team}',pts:${r.pts},G:${r.G},W:${r.W},L:${r.L},D:${r.D},RS:${r.RS||0},RA:${r.RA||0}`
      + `,H:${r.H||0},E:${r.E||0},BBHBP:${r.BBHBP||0},recent10:${s(r.recent10)},streak:${s(r.streak)},away:${s(r.away)},home:${s(r.home)}}`;
  }).join(',') + ']';
}

function rankingsToJs(rankings) {
  if (!rankings) return 'null';
  if (Array.isArray(rankings)) {
    if (!rankings.length) return 'null';
    return rankArrayToJs(rankings);
  }
  const keys = Object.keys(rankings);
  if (keys.length === 0) return 'null';
  return '{' + keys.map(k => {
    const safeKey = /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) ? k : `'${k.replace(/'/g, "\\'")}'`;
    return `${safeKey}:${rankArrayToJs(rankings[k])}`;
  }).join(',') + '}';
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

function updateEntrySeasonSummary(html, entryId, summary) {
  const span = findEntrySpan(html, entryId);
  if (!span) return html;
  let entryText = html.substring(span.start, span.end);
  const s = (v) => `'${String(v == null ? '' : v).replace(/'/g, "\\'")}'`;
  const ssJs = `{rank:${summary.rank},G:${summary.G},W:${summary.W},L:${summary.L},D:${summary.D},RS:${summary.RS},RA:${summary.RA}`
    + `,H:${summary.H||0},E:${summary.E||0},BBHBP:${summary.BBHBP||0},recent10:${s(summary.recent10)},streak:${s(summary.streak)},away:${s(summary.away)},home:${s(summary.home)}}`;

  const re = /seasonSummary\s*:\s*\{/;
  const m = re.exec(entryText);
  if (m) {
    const openIdx = m.index + m[0].length - 1;
    let depth = 1, i = openIdx + 1;
    let inStr = false, strCh = '', esc = false;
    while (i < entryText.length && depth > 0) {
      const c = entryText[i];
      if (esc) { esc = false; i++; continue; }
      if (c === '\\' && inStr) { esc = true; i++; continue; }
      if (inStr) { if (c === strCh) inStr = false; i++; continue; }
      if (c === "'" || c === '"') { inStr = true; strCh = c; i++; continue; }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      i++;
    }
    entryText = entryText.substring(0, m.index) + `seasonSummary:${ssJs}` + entryText.substring(i);
  } else {
    const rm = entryText.match(/,?\s*rankings\s*:/);
    if (rm) {
      const idx = rm.index;
      entryText = entryText.substring(0, idx) + `, seasonSummary:${ssJs}` + entryText.substring(idx);
    } else {
      const lastCurly = entryText.lastIndexOf('}');
      entryText = entryText.substring(0, lastCurly).replace(/,?\s*$/, '') + `, seasonSummary:${ssJs} }`;
    }
  }
  return html.substring(0, span.start) + entryText + html.substring(span.end);
}

function updateEntryRankings(html, entryId, rankings) {
  const span = findEntrySpan(html, entryId);
  if (!span) { console.warn(`  [${entryId}] 엔트리 못 찾음`); return html; }
  let entryText = html.substring(span.start, span.end);
  const repl = rankingsToJs(rankings);
  const re = /rankings\s*:\s*(null|\[|\{)/;
  const m = re.exec(entryText);
  if (!m) {
    const lastCurly = entryText.lastIndexOf('}');
    entryText = entryText.substring(0, lastCurly).replace(/,?\s*$/, '') + `, rankings:${repl} }`;
  } else {
    const startIdx = m.index;
    if (m[1] === 'null') {
      entryText = html.substring(span.start, span.end).replace(/rankings\s*:\s*null/, `rankings:${repl}`);
    } else {
      const openChar = m[1];
      const closeChar = openChar === '[' ? ']' : '}';
      const openPos = startIdx + m[0].length - 1;
      let depth = 1, k = openPos + 1;
      let inStr = false, strCh = '', esc = false;
      while (k < entryText.length && depth > 0) {
        const c = entryText[k];
        if (esc) { esc = false; k++; continue; }
        if (c === '\\' && inStr) { esc = true; k++; continue; }
        if (inStr) { if (c === strCh) inStr = false; k++; continue; }
        if (c === "'" || c === '"') { inStr = true; strCh = c; k++; continue; }
        if (c === openChar) depth++;
        else if (c === closeChar) depth--;
        k++;
      }
      entryText = entryText.substring(0, startIdx) + `rankings:${repl}` + entryText.substring(k);
    }
  }
  return html.substring(0, span.start) + entryText + html.substring(span.end);
}

// ---------- 메인 ----------

async function main() {
  console.log('=== ksbsa/dbsa 팀순위 스크래퍼 ===');
  console.log(new Date().toISOString());

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const originalHtml = html;

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

      // 와인드업 찾기 (seasonSummary 주입용 + 로깅)
      let windupRow = null;
      let windupLabel = '';
      let teamCount = 0;
      if (Array.isArray(result)) {
        teamCount = result.length;
        windupRow = result.find(r => /와인드업/.test(r.team));
      } else if (result) {
        for (const [k, arr] of Object.entries(result)) {
          teamCount += arr.length;
          const w = arr.find(r => /와인드업/.test(r.team));
          if (w && !windupRow) { windupRow = w; windupLabel = k; }
        }
      }
      console.log(`  와인드업: ${windupRow ? `${windupLabel ? windupLabel + '조 ' : ''}${windupRow.rank}위 ${windupRow.W}-${windupRow.L}-${windupRow.D} RS${windupRow.RS}/RA${windupRow.RA}` : '(없음)'}`);

      // 결과가 비어있으면 HTML 갱신 스킵 (잘못된 빈 결과로 덮어쓰지 않도록)
      if (teamCount === 0) {
        console.warn(`  ⚠️ 결과 비어있음 - HTML 갱신 스킵`);
        summary.push(`${t.id}: 0팀 (스킵)`);
        continue;
      }

      // 디버그 JSON 저장
      fs.writeFileSync(path.join(DEBUG_DIR, `${t.id}.json`), JSON.stringify(result, null, 2), 'utf8');

      // index.html 갱신
      html = updateEntryRankings(html, t.id, result);
      if (windupRow) {
        html = updateEntrySeasonSummary(html, t.id, {
          rank: windupRow.rank,
          G: windupRow.G, W: windupRow.W, L: windupRow.L, D: windupRow.D,
          RS: windupRow.RS || 0, RA: windupRow.RA || 0,
          H: windupRow.H || 0, E: windupRow.E || 0, BBHBP: windupRow.BBHBP || 0,
          recent10: windupRow.recent10 || '', streak: windupRow.streak || '',
          away: windupRow.away || '', home: windupRow.home || ''
        });
      }

      summary.push(`${t.id}: ${teamCount}팀${windupRow ? ` (와인드업 ${windupRow.rank}위)` : ''}`);
    } catch (e) {
      console.error(`  ERR: ${e.message}`);
      summary.push(`${t.id}: ERR ${e.message}`);
    }
    await page.waitForTimeout(500);
  }

  await browser.close();

  if (html !== originalHtml) {
    fs.writeFileSync(INDEX_FILE, html, 'utf-8');
    console.log('\n✅ index.html 업데이트');
  } else {
    console.log('\n⚠️ 변경 없음');
  }

  console.log('\n=== 요약 ===');
  summary.forEach(s => console.log('  ' + s));
}

main().catch(err => { console.error(err); process.exit(1); });
