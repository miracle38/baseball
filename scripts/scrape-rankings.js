/**
 * 와인드업 팀순위 스크래퍼
 * - gameone.kr의 모든 엔트리(2010~2025)에 대해 리그 팀순위 수집
 * - 연도별 lig_idx는 club/info/ranking/hitter 페이지의 리그 옵션에서 추출
 * - 순위 iframe URL: /league/record/content/rank?lig_idx=XX&group_code=0&season=YYYY
 * - ALL_DATA의 `rankings: null` 를 배열로 교체
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const CLUB_IDX = 7734;

// 엔트리 id → 리그명 매칭 패턴 (gameone에서 해당 연도 리그 드롭다운 옵션에서 찾을 때 사용)
// 기본값: 엔트리의 league 값을 그대로 regex로 사용
// 연도별 엔트리 → {pattern, groupHint} 매칭
// groupHint가 있으면 여러 매칭 중 group 값으로 추가 필터링
const LEAGUE_MATCHERS = {
  '2025_gongju':         { pattern: /금강토요|공주.*금강/ },
  '2022_daedeok':        { pattern: /대덕구.*토요\s*4부/ },
  '2022_sejong_1':       { pattern: /세종.*토요\s*4부\)$/ },  // 끝이 ) - 전기/일반
  '2022_sejong_2':       { pattern: /세종.*토요\s*4부\(/ },   // ( 로 시작하는 후기
  '2021_daedeok':        { pattern: /대덕구.*토요\s*4부/ },
  '2021_sejong_1':       { pattern: /세종.*토요\s*4부/, textMatch: /^(?!.*평일|.*후기)/ },
  '2021_sejong_weekday': { pattern: /세종.*평일\s*4부/ },
  '2021_sejong_2':       { pattern: /세종.*토요\s*4부/, pickIndex: 'last' }, // 여러 개 중 마지막
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

async function getLeagueOptionsForYear(browser, year) {
  const page = await browser.newPage();
  try {
    await page.goto(`https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2500);
    await page.selectOption('select:first-of-type', String(year)).catch(() => {});
    await page.waitForTimeout(3000);

    // 리그 탭 클릭
    await page.evaluate(() => {
      document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
        if (t.textContent.trim() === '리그') t.click();
      });
    });
    await page.waitForTimeout(2500);

    const opts = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      const out = [];
      selects.forEach(s => {
        Array.from(s.options).forEach(o => {
          try {
            const val = JSON.parse(o.value);
            if (val.lig_idx) {
              out.push({
                text: o.textContent.trim(),
                lig_idx: val.lig_idx,
                group: val.group || '0',
                part: val.part || '0'
              });
            }
          } catch(e) {}
        });
      });
      // 중복 제거
      const seen = new Set();
      return out.filter(o => {
        const key = o.lig_idx + '_' + o.group + '_' + o.part;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    });
    return opts;
  } finally { await page.close(); }
}

// 공격/수비 페이지에서 팀별 득점/실점 추출
async function scrapeTeamRSRA(browser, lig_idx, year, group_code, part_code) {
  const result = {}; // { teamName: { RS, RA } }
  const page = await browser.newPage();
  try {
    for (const kind of ['offense', 'defense']) {
      const gc = group_code != null ? group_code : '0';
      const pc = part_code != null ? `&part_code=${part_code}` : '';
      const url = `https://www.gameone.kr/league/record/content/${kind}?lig_idx=${lig_idx}&group_code=${gc}${pc}&season=${year}`;
      try {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
        await page.waitForTimeout(1500);
      } catch(e) { continue; }

      const parsed = await page.evaluate((k) => {
        // 헤더 텍스트로 컬럼 인덱스 매핑 (순위 테이블과 상세 테이블이 나란히 있어 둘째 테이블 선택)
        const tables = Array.from(document.querySelectorAll('table.ranking_table, table'));
        for (const t of tables) {
          const thTexts = Array.from(t.querySelectorAll('thead th')).map(th => th.textContent.trim());
          const target = k === 'offense' ? '득점' : '실점';
          const ci = thTexts.indexOf(target);
          if (ci < 0) continue;
          const out = {};
          t.querySelectorAll('tbody tr').forEach(tr => {
            const children = Array.from(tr.children);
            const team = (children[1] && children[1].textContent.trim()) || '';
            const cellText = (children[ci] && children[ci].textContent.trim()) || '0';
            const val = parseInt(cellText) || 0;
            if (team && val >= 0) out[team] = val;
          });
          return { key: target, data: out };
        }
        return null;
      }, kind);

      if (parsed) {
        Object.entries(parsed.data).forEach(([team, val]) => {
          if (!result[team]) result[team] = { RS: 0, RA: 0 };
          if (kind === 'offense') result[team].RS = val;
          else result[team].RA = val;
        });
      }
    }
  } finally { await page.close(); }
  return result;
}

// 해당 리그/group의 part_code 옵션 조회 (A조/B조 등 sub-division 확인)
async function getPartOptions(browser, lig_idx, group_code, year) {
  const page = await browser.newPage();
  try {
    const url = `https://www.gameone.kr/league/record/content/rank?lig_idx=${lig_idx}&group_code=${group_code}&season=${year}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(1500);
    const parts = await page.evaluate(() => {
      const s = Array.from(document.querySelectorAll('select')).find(x => x.name === 'part_code');
      if (!s) return [];
      return Array.from(s.options)
        .map(o => ({ text: o.textContent.trim(), value: o.value }))
        .filter(o => o.value !== '-1' && o.value !== '' && o.text !== '조리그분류');
    });
    return parts;
  } finally { await page.close(); }
}

async function scrapeTeamRank(browser, lig_idx, year, group_code, part_code) {
  const page = await browser.newPage();
  try {
    const gc = group_code != null ? group_code : '0';
    const pc = part_code != null ? `&part_code=${part_code}` : '';
    const url = `https://www.gameone.kr/league/record/content/rank?lig_idx=${lig_idx}&group_code=${gc}${pc}&season=${year}`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    const rows = await page.evaluate(() => {
      const out = [];
      const tbl = document.querySelector('table');
      if (!tbl) return out;
      tbl.querySelectorAll('tbody tr').forEach(tr => {
        const cells = Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim());
        if (cells.length < 8) return;
        // 0:순위 1:팀명 2:게임(괄호 포함 가능) 3:승 4:패 5:무 6:승률 7:승점 8:승차
        const rank = parseInt(cells[0]) || 0;
        if (!rank) return;
        const team = cells[1];
        // 게임 "15(2)" 형태 처리 → 15만 추출
        const G = parseInt((cells[2] || '').match(/\d+/)?.[0] || '0') || 0;
        out.push({
          rank,
          team,
          G,
          W: parseInt(cells[3]) || 0,
          L: parseInt(cells[4]) || 0,
          D: parseInt(cells[5]) || 0,
          pts: parseInt(cells[7]) || 0,
          RS: 0,  // 별도 스크래핑 필요
          RA: 0
        });
      });
      return out;
    });
    return rows;
  } finally { await page.close(); }
}

async function scrapeTeamRS_RA(browser, lig_idx, year) {
  // 공격(offense) → 득점, 수비(defense) → 실점
  // 이 페이지는 table 구조가 불규칙하므로 div/text 기반 파싱
  const result = {}; // { team: { RS, RA } }
  const page = await browser.newPage();
  try {
    for (const kind of ['offense', 'defense']) {
      const url = `https://www.gameone.kr/league/record/content/${kind}?lig_idx=${lig_idx}&group_code=0&season=${year}`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(1500);
      const data = await page.evaluate((k) => {
        // 모든 tr 스캔, 셀 추출
        const rows = document.querySelectorAll('tr');
        const out = [];
        rows.forEach(tr => {
          const cells = Array.from(tr.children).map(c => c.textContent.trim());
          if (cells.length < 5) return;
          const rank = parseInt(cells[0]);
          if (!rank || rank > 30) return;
          const team = cells[1];
          if (!team || team.length > 30) return;
          // 공격: [rank, team, AVG, G, PA, AB, 득점(R), ...]
          // 수비: [rank, team, ERA, G, ..., 실점(R), ...]
          out.push({ rank, team, cells });
        });
        return out;
      }, kind);

      data.forEach(({ team, cells }) => {
        if (!result[team]) result[team] = { RS: 0, RA: 0 };
        if (kind === 'offense') {
          // 득점은 보통 index 6 근처 (랭킹,팀명,타율,게임,타석,타수,득점,...)
          const R = parseInt(cells[6]) || parseInt(cells[5]) || 0;
          result[team].RS = R;
        } else {
          // 실점은 defense 테이블 뒤쪽 - 정확한 컬럼 필요
          // 일단 '실점'을 키워드로 앞의 th 매칭해서 추출하는 방식 미적용, 간단히 큰 값 중 하나
          // 수비는 나중에 정확히 구현 (일단 생략)
        }
      });
    }
  } finally { await page.close(); }
  return result;
}

function rankArrayToJs(rankings) {
  return '[' + rankings.map(r => {
    const team = String(r.team).replace(/'/g, "\\'");
    return `{rank:${r.rank},team:'${team}',pts:${r.pts},G:${r.G},W:${r.W},L:${r.L},D:${r.D},RS:${r.RS||0},RA:${r.RA||0}}`;
  }).join(',') + ']';
}

function rankingsToJs(rankings) {
  if (!rankings) return 'null';
  if (Array.isArray(rankings)) {
    if (!rankings.length) return 'null';
    return rankArrayToJs(rankings);
  }
  // 객체: { A: [...], B: [...] }
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
  const ssJs = `{rank:${summary.rank},G:${summary.G},W:${summary.W},L:${summary.L},D:${summary.D},RS:${summary.RS},RA:${summary.RA}}`;

  // seasonSummary 이미 있으면 교체, 없으면 rankings 앞에 삽입
  const re = /seasonSummary\s*:\s*\{/;
  const m = re.exec(entryText);
  if (m) {
    // balance-match 로 끝 찾기
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
    // rankings 필드 앞에 seasonSummary 삽입
    const rm = entryText.match(/,?\s*rankings\s*:/);
    if (rm) {
      const idx = rm.index;
      entryText = entryText.substring(0, idx) + `, seasonSummary:${ssJs}` + entryText.substring(idx);
    } else {
      // 마지막 } 직전에 삽입
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
  // rankings:null  또는  rankings:[...]  또는  rankings:{...}  패턴을 찾아 교체
  // balance-matching으로 정확히 교체
  const re = /rankings\s*:\s*(null|\[|\{)/;
  const m = re.exec(entryText);
  if (!m) {
    // rankings 필드가 없으면 추가 (entry 객체의 마지막 } 직전에)
    const lastCurly = entryText.lastIndexOf('}');
    entryText = entryText.substring(0, lastCurly).replace(/,?\s*$/, '') + `, rankings:${repl} }`;
  } else {
    const startIdx = m.index;
    if (m[1] === 'null') {
      entryText = entryText.substring(0, startIdx) + `rankings:${repl}` + entryText.substring(startIdx + m[0].length - 4 + 4 + 0).replace(/^null/, '');
      // 위 방식은 복잡 — 간단히 문자열 치환
      entryText = html.substring(span.start, span.end).replace(/rankings\s*:\s*null/, `rankings:${repl}`);
    } else {
      // [ 또는 { 로 시작하는 값: balance-match로 끝 찾기
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

async function main() {
  console.log('=== gameone 팀순위 스크래퍼 ===');
  console.log(new Date().toISOString());

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const originalHtml = html;

  // ALL_DATA에서 gameone 엔트리 추출
  const m = html.match(/const ALL_DATA = (\[[\s\S]*?\n\]);/);
  if (!m) { console.error('ALL_DATA를 찾을 수 없음'); process.exit(1); }
  let DATA;
  try { eval('DATA = ' + m[1]); } catch(e) { console.error('ALL_DATA eval 실패:', e.message); process.exit(1); }
  // gameone 소스 엔트리 전체 재스크래핑 (group_code 버그 수정으로 재실행 필요)
  const targets = DATA.filter(e => e.source === 'gameone.kr');
  console.log(`총 ${targets.length}개 엔트리 대상 (gameone 전체)`);

  // 연도별로 그룹화 (연도당 한 번만 리그 목록 조회)
  const byYear = {};
  targets.forEach(e => {
    if (!byYear[e.year]) byYear[e.year] = [];
    byYear[e.year].push(e);
  });

  const summary = [];
  const debugDir = path.join(__dirname, '..', 'scrape_debug', 'rankings');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  for (const year of Object.keys(byYear).sort()) {
    console.log(`\n=== ${year} ===`);
    let leagueOpts;
    try {
      leagueOpts = await getLeagueOptionsForYear(browser, year);
    } catch(e) {
      console.warn(`  리그 옵션 조회 실패: ${e.message}`);
      byYear[year].forEach(en => summary.push(`${en.id}: 리그 옵션 조회 실패`));
      continue;
    }
    console.log(`  ${year} 리그 옵션: ${leagueOpts.map(o => o.text).join(' | ')}`);

    for (const entry of byYear[year]) {
      const mDef = LEAGUE_MATCHERS[entry.id] || { pattern: new RegExp(entry.league.replace(/[()]/g, '.?')) };
      let candidates = leagueOpts.filter(o => mDef.pattern.test(o.text));
      if (mDef.textMatch) candidates = candidates.filter(o => mDef.textMatch.test(o.text));
      let matched = null;
      if (candidates.length === 0) matched = null;
      else if (candidates.length === 1) matched = candidates[0];
      else if (mDef.pickIndex === 'last') matched = candidates[candidates.length - 1];
      else matched = candidates[0];
      if (!matched) {
        console.warn(`  [${entry.id}] 매칭 리그 없음 (패턴: ${mDef.pattern})`);
        summary.push(`${entry.id}: 매칭 실패`);
        continue;
      }
      console.log(`  [${entry.id}] → ${matched.text} (lig_idx=${matched.lig_idx}, group=${matched.group}, part=${matched.part})`);
      try {
        // part_code 옵션 확인 (조 subdivision)
        const partOpts = await getPartOptions(browser, matched.lig_idx, matched.group, entry.year);

        let rankings;
        let windupRow = null;       // 와인드업 랭킹 행
        let windupPartLabel = null; // 조 라벨 (있으면)

        if (partOpts.length >= 2) {
          rankings = {};
          for (const po of partOpts) {
            const ranks = await scrapeTeamRank(browser, matched.lig_idx, entry.year, matched.group, po.value);
            if (ranks.length === 0) continue;
            // 해당 part의 RS/RA 병합
            const rsra = await scrapeTeamRSRA(browser, matched.lig_idx, entry.year, matched.group, po.value);
            ranks.forEach(r => {
              if (rsra[r.team]) { r.RS = rsra[r.team].RS; r.RA = rsra[r.team].RA; }
            });

            let label = po.text.trim();
            const lm = label.match(/([A-Z가-힣])조$/);
            if (lm) label = lm[1];
            rankings[label] = ranks;

            const wr = ranks.find(r => /와인드업/.test(r.team));
            if (wr && !windupRow) { windupRow = wr; windupPartLabel = label; }
          }
          const partCount = Object.keys(rankings).length;
          if (partCount === 0) { summary.push(`${entry.id}: 순위 0건`); continue; }
          const totalTeams = Object.values(rankings).reduce((a, b) => a + b.length, 0);
          console.log(`    ✓ ${partCount}조 총 ${totalTeams}팀${windupRow ? ` (와인드업 ${windupPartLabel}조 ${windupRow.rank}위 RS${windupRow.RS}/RA${windupRow.RA})` : ''}`);
          summary.push(`${entry.id}: ${partCount}조 ${totalTeams}팀`);
        } else {
          rankings = await scrapeTeamRank(browser, matched.lig_idx, entry.year, matched.group);
          if (rankings.length === 0) { summary.push(`${entry.id}: 순위 0건`); continue; }
          const rsra = await scrapeTeamRSRA(browser, matched.lig_idx, entry.year, matched.group);
          rankings.forEach(r => {
            if (rsra[r.team]) { r.RS = rsra[r.team].RS; r.RA = rsra[r.team].RA; }
          });
          windupRow = rankings.find(r => /와인드업/.test(r.team));
          console.log(`    ✓ ${rankings.length}팀${windupRow ? ` (와인드업 ${windupRow.rank}위 RS${windupRow.RS}/RA${windupRow.RA})` : ''}`);
          summary.push(`${entry.id}: ${rankings.length}팀`);
        }

        fs.writeFileSync(path.join(debugDir, `${entry.id}.json`), JSON.stringify(rankings, null, 2), 'utf-8');
        html = updateEntryRankings(html, entry.id, rankings);

        // seasonSummary 주입 (와인드업 행 기반)
        if (windupRow) {
          const ss = {
            rank: windupRow.rank,
            G: windupRow.G, W: windupRow.W, L: windupRow.L, D: windupRow.D,
            RS: windupRow.RS || 0, RA: windupRow.RA || 0
          };
          html = updateEntrySeasonSummary(html, entry.id, ss);
        }
      } catch(e) {
        console.warn(`    에러: ${e.message}`);
        summary.push(`${entry.id}: 에러 ${e.message}`);
      }
    }
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
