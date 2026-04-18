/**
 * ksbsa.or.kr 개별 경기 스크래퍼 (캘린더 + 경기내용 페이지 방식)
 *
 * 경기일정 캘린더에서 월별로 경기 목록을 수집하고,
 * 각 경기의 "경기내용" 링크에서 스코어/상대팀 파싱
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

// 연도별/리그별 수집 타겟
const TARGETS = [
  { entryId: '2025_sejong', year: 2025, leagueFilter: (l) => /토요\s*리그|토요4부/.test(l) && !/시장기|협회장기|인터리그/.test(l) },
  { entryId: '2025_sejong_cup1', year: 2025, leagueFilter: (l) => /시장기/.test(l) },
  { entryId: '2025_sejong_cup2', year: 2025, leagueFilter: (l) => /협회장기/.test(l) },
];

async function scrapeCalendarGames(page, year) {
  const allGames = [];

  // 3월 ~ 12월 (야구 시즌)
  for (let month = 3; month <= 11; month++) {
    const url = `https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93&searchYear=${year}&searchMonth=${month}`;
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    } catch(e) {
      // networkidle timeout은 무시
    }
    await page.waitForTimeout(2000);

    // 캘린더에서 경기 있는 날짜 찾기 ("+1" 등 표시)
    // 또는 하단의 경기 목록 테이블 확인
    const games = await page.evaluate(({yr, mo}) => {
      const results = [];

      // 방법1: 하단 경기 목록 테이블에서 수집
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
        if (ths.some(h => /경기일시/.test(h))) {
          const rows = Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td'));
          rows.forEach(r => {
            const cells = Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g, ' '));
            const links = Array.from(r.querySelectorAll('a'));
            const recordLink = links.find(a => /경기기록|경기내용/.test(a.textContent));
            results.push({
              dateTime: cells[0],
              league: cells[1],
              location: cells[2],
              game: cells[3],
              recordHref: recordLink ? recordLink.href : null
            });
          });
          break;
        }
      }

      // 방법2: 캘린더 셀에서 경기 정보 추출
      if (results.length === 0) {
        const calTable = tables[0];
        if (calTable) {
          const tds = Array.from(calTable.querySelectorAll('td'));
          tds.forEach(td => {
            const text = td.textContent.trim();
            const dayMatch = text.match(/^(\d+)/);
            if (!dayMatch) return;
            const links = Array.from(td.querySelectorAll('a'));
            links.forEach(a => {
              const href = a.href;
              if (/getGameRecord|gameScheduleSeq/.test(href)) {
                results.push({
                  dateTime: `${yr}-${String(mo).padStart(2,'0')}-${dayMatch[1].padStart(2,'0')}`,
                  league: '',
                  location: '',
                  game: a.textContent.trim(),
                  recordHref: href
                });
              }
            });
          });
        }
      }

      return results;
    }, {yr: year, mo: month});

    if (games.length > 0) {
      console.log(`  ${year}-${String(month).padStart(2,'0')}: ${games.length}경기`);
      allGames.push(...games);
    }
  }

  return allGames;
}

async function scrapeGameDetail(page, href) {
  try {
    await page.goto(href, { waitUntil: 'networkidle', timeout: 15000 });
  } catch(e) {}
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    // 경기 결과 정보 추출
    const text = document.body.textContent;

    // 팀명, 스코어 찾기
    const scoreEls = document.querySelectorAll('.score, .team-score, .game-score, [class*="score"]');
    const teamEls = document.querySelectorAll('.team-name, .team, [class*="team"]');

    // 테이블에서 라인스코어 찾기
    const tables = Array.from(document.querySelectorAll('table'));
    let lineScore = null;
    for (const t of tables) {
      const ths = Array.from(t.querySelectorAll('th, thead td')).map(th => th.textContent.trim());
      if (ths.some(h => /^R$|합계|TOTAL|계/.test(h)) || ths.some(h => /^1$|^1회$/.test(h))) {
        const rows = Array.from(t.querySelectorAll('tr'));
        lineScore = rows.map(r => ({
          cells: Array.from(r.children).map(c => c.textContent.trim())
        }));
        break;
      }
    }

    return {
      title: document.title,
      bodySnippet: text.slice(0, 1000),
      scoreEls: Array.from(scoreEls).slice(0, 5).map(e => ({ class: e.className, text: e.textContent.trim().slice(0, 100) })),
      teamEls: Array.from(teamEls).slice(0, 5).map(e => ({ class: e.className, text: e.textContent.trim().slice(0, 100) })),
      lineScore
    };
  });
}

function parseGameFromList(gameStr) {
  // "와인드업 4 VS 13 INCOURSE" 형식
  const vsMatch = gameStr.match(/(.+?)\s+(\d+)\s+VS\s+(\d+)\s+(.+)/i);
  if (!vsMatch) return null;

  let team1 = vsMatch[1].trim();
  let score1 = parseInt(vsMatch[2]);
  let score2 = parseInt(vsMatch[3]);
  let team2Raw = vsMatch[4].trim();

  // 키워드 제거
  let keyword = null;
  const kwMatch = team2Raw.match(/\s*(콜드승|콜드패|몰수승|몰수패|포기승|추첨승|추첨패|기권승|기권패)$/);
  if (kwMatch) {
    keyword = kwMatch[1];
    team2Raw = team2Raw.replace(kwMatch[0], '').trim();
  }

  const isWindup1 = /와인드업/.test(team1);
  const isWindup2 = /와인드업/.test(team2Raw);
  if (!isWindup1 && !isWindup2) return null;

  let opponent, ourScore, theirScore;
  if (isWindup1) {
    opponent = team2Raw; ourScore = score1; theirScore = score2;
  } else {
    opponent = team1; ourScore = score2; theirScore = score1;
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
    return `g${i+1}:{date:'${g.date}',opponent:'${opp}',ourScore:${g.ourScore},theirScore:${g.theirScore},result:'${g.result}',location:'${loc}'}`;
  }).join(',') + '}';
}

async function main() {
  console.log('=== ksbsa.or.kr 경기 스크래퍼 (v2) ===\n');

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });

  // Step 1: 경기기록 페이지에서 하단 경기 목록 수집 (리그 필터 포함)
  console.log('Step 1: 경기기록 페이지에서 전체 경기 목록 수집...\n');

  const page = await browser.newPage();
  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchYear=2025';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 하단 경기 테이블 확인
  let gameTableGames = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    for (const t of tables) {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      if (ths.some(h => /경기일시/.test(h))) {
        const rows = Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td'));
        return rows.map(r => {
          const cells = Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g, ' '));
          const links = Array.from(r.querySelectorAll('a'));
          const recordLink = links.find(a => /경기기록|경기내용/.test(a.textContent));
          return {
            dateTime: cells[0] || '',
            league: cells[1] || '',
            location: cells[2] || '',
            game: cells[3] || '',
            recordHref: recordLink ? recordLink.href : null
          };
        });
      }
    }
    return [];
  });

  console.log(`하단 게임 테이블: ${gameTableGames.length}경기`);
  gameTableGames.forEach(g => console.log(`  ${g.dateTime} | ${g.league} | ${g.game} | ${g.location}`));

  // 페이지네이션 확인
  const hasNextPage = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a'));
    return links.some(a => /다음|next|>>/i.test(a.textContent) || /page=\d/.test(a.href));
  });
  console.log(`\n페이지네이션: ${hasNextPage ? '있음' : '없음'}`);

  // 경기 목록이 부족하면 캘린더 방식으로 전환
  if (gameTableGames.length < 5) {
    console.log('\n하단 테이블에 경기가 부족합니다. 캘린더 방식으로 전환...\n');

    // 캘린더 페이지에서 월별 수집
    const calGames = await scrapeCalendarGames(page, 2025);
    console.log(`\n캘린더에서 ${calGames.length}경기 수집`);
    calGames.forEach(g => console.log(`  ${g.dateTime} | ${g.league} | ${g.game}`));

    // 경기내용 링크가 있으면 상세 페이지 스크래핑
    if (calGames.length > 0 && calGames[0].recordHref) {
      console.log('\n경기내용 상세 페이지 확인 (첫 번째 경기)...');
      const detail = await scrapeGameDetail(page, calGames[0].recordHref);
      console.log(JSON.stringify(detail, null, 2).slice(0, 2000));
    }

    gameTableGames = calGames;
  }

  // Step 2: "경기기록" 하단 테이블이 리그별이 아니라 최근 N개만 보여준다면,
  // 각 리그 행을 클릭해서 해당 리그 경기만 필터링된 결과를 확인
  console.log('\n\nStep 2: 리그별 "더보기" 클릭 후 경기 테이블 변화 확인...\n');

  // 경기기록 페이지로 다시 이동
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 2025 토요4부 행 (idx=6) 클릭
  const rowTexts = await page.evaluate(() => {
    const table = document.querySelectorAll('table')[0];
    if (!table) return [];
    return Array.from(table.querySelectorAll('tbody tr')).map((r, i) => ({
      idx: i,
      text: Array.from(r.children).map(c => c.textContent.trim()).slice(0, 4).join(' | ')
    }));
  });
  console.log('리그 행:');
  rowTexts.forEach(r => console.log(`  [${r.idx}] ${r.text}`));

  // 2025 토요4부 행의 "더보기" 클릭
  for (const target of [6, 4, 5]) { // 토요4부, 시장기, 협회장기
    console.log(`\n--- 행 ${target} 더보기 클릭 ---`);

    // 해당 행의 더보기 클릭 + 네트워크 요청 캡처
    await page.evaluate((rowIdx) => {
      const table = document.querySelectorAll('table')[0];
      const rows = Array.from(table.querySelectorAll('tbody tr'));
      const row = rows[rowIdx];
      if (!row) return;
      // 더보기 링크 찾기
      const links = Array.from(row.querySelectorAll('a'));
      const moreLink = links.find(a => /더보기/.test(a.textContent));
      if (moreLink) moreLink.click();
    }, target);
    await page.waitForTimeout(2000);

    // 변경된 게임 테이블 읽기
    const updatedGames = await page.evaluate(() => {
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
        if (ths.some(h => /경기일시/.test(h))) {
          const rows = Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td'));
          return rows.map(r => {
            const cells = Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g, ' '));
            return {
              dateTime: cells[0] || '',
              league: cells[1] || '',
              location: cells[2] || '',
              game: cells[3] || ''
            };
          });
        }
      }
      return [];
    });
    console.log(`  경기: ${updatedGames.length}개`);
    updatedGames.forEach(g => console.log(`    ${g.dateTime} | ${g.league} | ${g.game}`));
  }

  await browser.close();
  console.log('\n=== 탐색 완료 ===');
}

main().catch(err => { console.error(err); process.exit(1); });
