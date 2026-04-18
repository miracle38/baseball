/**
 * ksbsa.or.kr 개별 경기 스크래퍼
 * - 경기기록 페이지에서 각 리그 엔트리의 "더보기" 클릭 → 개별 경기 목록 수집
 * - 2025 세종 토요4부, 시장기, 협회장기 경기 데이터 추출
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

// ksbsa leagueKey → index.html entry id 매핑
const LEAGUE_MATCHERS = {
  '2025_sejong':      { year: '2025', leagueTest: (l, d) => /토요리그|토요4부/.test(l) && !/시장기|협회장기|인터리그/.test(l) },
  '2025_sejong_cup1': { year: '2025', leagueTest: (l, d) => /시장기/.test(l) },
  '2025_sejong_cup2': { year: '2025', leagueTest: (l, d) => /협회장기/.test(l) },
  '2024_sejong':      { year: '2024', leagueTest: (l, d) => /토요리그|토요3부/.test(l) && !/인터리그/.test(l) },
  '2023_sejong':      { year: '2023', leagueTest: (l, d) => /토요4부/.test(l) && !/플레이오프|인터리그/.test(l) },
  '2023_sejong_po':   { year: '2023', leagueTest: (l, d) => /플레이오프/.test(d) },
  '2023_sejong_inter':{ year: '2023', leagueTest: (l, d) => /인터리그/.test(l) },
};

function parseGameString(gameStr) {
  // "와인드업 4 VS 13 INCOURSE" 또는 "금강 옥시전스 2 VS 11 와인드업 콜드승"
  const vsMatch = gameStr.match(/(.+?)\s+(\d+)\s+VS\s+(\d+)\s+(.+)/i);
  if (!vsMatch) return null;

  let team1 = vsMatch[1].trim();
  let score1 = parseInt(vsMatch[2]);
  let score2 = parseInt(vsMatch[3]);
  let team2Raw = vsMatch[4].trim();

  // 콜드승/콜드패 등 키워드 제거
  let keyword = null;
  const kwMatch = team2Raw.match(/\s*(콜드승|콜드패|몰수승|몰수패|포기승|추첨승|추첨패|기권승|기권패)$/);
  if (kwMatch) {
    keyword = kwMatch[1];
    team2Raw = team2Raw.replace(kwMatch[0], '').trim();
  }
  let team2 = team2Raw;

  const isWindup1 = /와인드업/.test(team1);
  const isWindup2 = /와인드업/.test(team2);

  if (!isWindup1 && !isWindup2) return null;

  let opponent, ourScore, theirScore;
  if (isWindup1) {
    opponent = team2;
    ourScore = score1;
    theirScore = score2;
  } else {
    opponent = team1;
    ourScore = score2;
    theirScore = score1;
  }

  let result = '무';
  if (ourScore > theirScore) result = '승';
  else if (ourScore < theirScore) result = '패';

  return { opponent, ourScore, theirScore, result, keyword };
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

function replaceField(text, fieldRe, newValue) {
  const m = fieldRe.exec(text);
  if (!m) return null;
  const startIdx = m.index + m[0].length - 1;
  const openChar = text[startIdx];
  if (openChar !== '{' && openChar !== '[') {
    let k = m.index + m[0].length;
    while (k < text.length && !/[,}]/.test(text[k])) k++;
    return text.substring(0, m.index) + newValue + text.substring(k);
  }
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 1, k = startIdx + 1;
  let inStr = false, strCh = '', esc = false;
  while (k < text.length && depth > 0) {
    const c = text[k];
    if (esc) { esc = false; k++; continue; }
    if (c === '\\' && inStr) { esc = true; k++; continue; }
    if (inStr) { if (c === strCh) inStr = false; k++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; k++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) depth--;
    k++;
  }
  return text.substring(0, m.index) + newValue + text.substring(k);
}

function gamesToJs(games) {
  if (!games || !games.length) return '{}';
  return '{' + games.map((g, i) => {
    const opp = (g.opponent || '').replace(/'/g, "\\'");
    const loc = (g.location || '').replace(/'/g, "\\'");
    const league = (g.league || '').replace(/'/g, "\\'");
    return `g${i+1}:{date:'${g.date}',opponent:'${opp}',ourScore:${g.ourScore},theirScore:${g.theirScore},result:'${g.result}',location:'${loc}'}`;
  }).join(',') + '}';
}

async function main() {
  console.log('=== ksbsa.or.kr 경기 스크래퍼 ===\n');

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchYear=2025';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 1) 모든 리그 엔트리 행 수집
  const leagueRows = await page.evaluate(() => {
    const table = document.querySelectorAll('table')[0]; // 첫 번째 테이블
    if (!table) return [];
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    return rows.map((r, idx) => {
      const cells = Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g, ' '));
      return {
        idx,
        year: cells[0],
        league: cells[1],
        division: cells[2],
        rank: cells[3],
        G: cells[5],
        W: cells[6],
        L: cells[7],
        D: cells[8],
        RS: cells[9],
        RA: cells[10]
      };
    });
  });

  console.log(`리그 엔트리 ${leagueRows.length}개:`);
  leagueRows.forEach(r => console.log(`  [${r.idx}] ${r.year} ${r.league} / ${r.division}: ${r.W}승 ${r.L}패 ${r.D}무 (${r.G}경기)`));

  // 2) 각 리그의 "더보기" 클릭 → 경기 목록 수집
  const allResults = {};

  for (let i = 0; i < leagueRows.length; i++) {
    const row = leagueRows[i];
    console.log(`\n--- [${i}] ${row.year} ${row.league} / ${row.division} 경기 수집 ---`);

    // 더보기 클릭
    const clicked = await page.evaluate((rowIdx) => {
      const table = document.querySelectorAll('table')[0];
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const row = rows[rowIdx];
      if (!row) return false;
      const moreLink = row.querySelector('a');
      if (moreLink && /더보기/.test(moreLink.textContent)) {
        moreLink.click();
        return true;
      }
      return false;
    }, i);

    if (!clicked) {
      console.log('  더보기 버튼 없음, 스킵');
      continue;
    }

    await page.waitForTimeout(2000);

    // 경기 테이블 읽기 (idx=3 테이블 — 경기일시/리그/장소/경기/경기기록)
    const games = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      // "경기일시" 헤더가 있는 테이블 찾기
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
        if (!ths.some(h => /경기일시/.test(h))) continue;

        const rows = Array.from(t.querySelectorAll('tbody tr, tr')).filter(r => r.querySelector('td'));
        return rows.map(r => {
          const cells = Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g, ' '));
          const links = Array.from(r.querySelectorAll('a')).map(a => ({ text: a.textContent.trim(), href: a.href }));
          return {
            dateTime: cells[0],
            league: cells[1],
            location: cells[2],
            game: cells[3],
            recordLink: links.find(l => /경기기록|경기내용/.test(l.text))?.href || null
          };
        });
      }
      return [];
    });

    console.log(`  ${games.length}경기 발견`);
    games.forEach(g => console.log(`    ${g.dateTime} | ${g.game} | ${g.location}`));

    allResults[i] = { ...row, games };
  }

  await browser.close();

  // 3) 경기 데이터를 index.html에 반영
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  // 디버그 저장
  const debugDir = path.join(__dirname, '..', 'scrape_debug', 'ksbsa');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(path.join(debugDir, 'raw_games.json'), JSON.stringify(allResults, null, 2), 'utf-8');

  for (const [idx, data] of Object.entries(allResults)) {
    if (!data.games || data.games.length === 0) continue;

    // 매칭되는 entry 찾기
    let matchedEntryId = null;
    for (const [entryId, matcher] of Object.entries(LEAGUE_MATCHERS)) {
      if (matcher.year === data.year && matcher.leagueTest(data.league, data.division)) {
        matchedEntryId = entryId;
        break;
      }
    }

    if (!matchedEntryId) {
      console.log(`\n[${idx}] ${data.year} ${data.league}/${data.division}: 매칭 엔트리 없음, 스킵`);
      continue;
    }

    console.log(`\n[${idx}] → ${matchedEntryId}`);

    // 경기 파싱
    const parsedGames = [];
    for (const g of data.games) {
      const dateMatch = g.dateTime.match(/(\d{4}-\d{2}-\d{2})/);
      if (!dateMatch) continue;

      const parsed = parseGameString(g.game);
      if (!parsed) {
        console.log(`  파싱 실패: ${g.game}`);
        continue;
      }

      parsedGames.push({
        date: dateMatch[1],
        opponent: parsed.opponent,
        ourScore: parsed.ourScore,
        theirScore: parsed.theirScore,
        result: parsed.result,
        location: g.location || '',
        league: g.league || ''
      });
    }

    // 날짜순 정렬 (최신순)
    parsedGames.sort((a, b) => b.date.localeCompare(a.date));

    console.log(`  파싱 완료: ${parsedGames.length}경기`);
    parsedGames.forEach(g => console.log(`    ${g.date} vs ${g.opponent}: ${g.ourScore}-${g.theirScore} ${g.result}`));

    if (parsedGames.length === 0) continue;

    // index.html 업데이트
    const span = findEntrySpan(html, matchedEntryId);
    if (!span) { console.log(`  ${matchedEntryId} 엔트리 못 찾음`); continue; }
    let entryText = html.substring(span.start, span.end);

    const gjs = gamesToJs(parsedGames);
    const r = replaceField(entryText, /games\s*:\s*(\{|null|\[)/, `games:${gjs}`);
    if (r) {
      entryText = r;
      html = html.substring(0, span.start) + entryText + html.substring(span.end);
      console.log(`  ✅ ${matchedEntryId} games 업데이트 (${parsedGames.length}경기)`);
    } else {
      console.log(`  ❌ games 필드 교체 실패`);
    }
  }

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log('\n=== 완료 ===');
}

main().catch(err => { console.error(err); process.exit(1); });
