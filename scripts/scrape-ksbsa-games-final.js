/**
 * ksbsa.or.kr 경기 스크래퍼 (최종)
 * 캘린더 월별 POST → 경기 날짜 클릭 → match-list-wrap에서 경기 정보 + gameScheduleSeq 추출
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

// 리그 매칭: ksbsa 리그명 → entry id
function matchLeague(league, year) {
  if (year !== 2025) return null;
  if (/시장기/.test(league)) return '2025_sejong_cup1';
  if (/협회장기/.test(league)) return '2025_sejong_cup2';
  if (/토요리그|토요\d부/.test(league) && !/시장기|협회장기|인터리그/.test(league)) return '2025_sejong';
  return null;
}

async function navigateToMonth(page, year, month) {
  await page.evaluate(({yr, mo}) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93';
    [['thisYear', yr], ['thisMonth', String(mo).padStart(2, '0')], ['thisDay', '01']].forEach(([n, v]) => {
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = n; input.value = v;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }, {yr: String(year), mo: month});
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
}

async function getGameDatesFromCalendar(page) {
  return await page.evaluate(() => {
    const dates = [];
    document.querySelectorAll('td a.el-cal-item').forEach(a => {
      const dateP = a.querySelector('.date');
      const matchP = a.querySelector('.match');
      if (dateP && matchP && /\+\d/.test(matchP.textContent)) {
        dates.push(parseInt(dateP.textContent.trim()));
      }
    });
    return dates;
  });
}

async function clickDateAndGetGames(page, day) {
  await page.evaluate(({day}) => {
    const calCells = document.querySelectorAll('td a.el-cal-item');
    for (const a of calCells) {
      const dateP = a.querySelector('.date');
      if (dateP && parseInt(dateP.textContent.trim()) === day) {
        a.click();
        return;
      }
    }
  }, {day});
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1500);

  return await page.evaluate(() => {
    const games = [];
    const matchWrap = document.querySelector('.match-list-wrap');
    if (!matchWrap) return games;

    const matches = matchWrap.querySelectorAll('.team-match');
    matches.forEach(match => {
      const dateTimeEl = match.querySelector('.match-info, .date-info');
      const fullText = match.textContent.replace(/\s+/g, ' ').trim();

      // 날짜/시간 추출
      const dateMatch = fullText.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2}:\d{2})/);
      const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
      const time = dateMatch ? dateMatch[4] : '';

      // 장소 추출
      const locationMatch = fullText.match(/\d{2}:\d{2}(.+?)(?:토요|인터|시장기|협회|리그)/);
      let location = '';
      if (locationMatch) {
        location = locationMatch[1].trim();
      }

      // 리그 추출
      const leagueEl = match.querySelector('.league-name, .match-league');
      let league = '';
      if (leagueEl) {
        league = leagueEl.textContent.trim();
      } else {
        const leagueMatch = fullText.match(/(토요리그\s*-\s*토요\d부|인터리그\s*-\s*\S+|시장기\s*-\s*\S+|협회장기\s*-\s*\S+|[^\s]+리그[^\s]*)/);
        if (leagueMatch) league = leagueMatch[1];
      }

      // 팀/스코어 추출
      const lTeam = match.querySelector('.l-team');
      const rTeam = match.querySelector('.r-team');

      let lTeamName = '', lScore = 0, rTeamName = '', rScore = 0;
      if (lTeam) {
        const info = lTeam.querySelector('.team-info');
        const scoreEl = lTeam.querySelector('.team-info + *') || lTeam;
        const nameText = info ? info.textContent.trim() : '';
        const nums = lTeam.textContent.match(/\d+/g);
        lTeamName = nameText.split(/\d/)[0].trim() || lTeam.textContent.replace(/\d+/g, '').trim();
        lScore = nums ? parseInt(nums[nums.length - 1]) : 0;
      }
      if (rTeam) {
        const info = rTeam.querySelector('.team-info');
        const nameText = info ? info.textContent.trim() : '';
        const nums = rTeam.textContent.match(/\d+/g);
        rTeamName = nameText.split(/\d/)[0].trim() || rTeam.textContent.replace(/\d+/g, '').trim();
        rScore = nums ? parseInt(nums[nums.length - 1]) : 0;
      }

      // gameScheduleSeq 추출
      const detailLink = match.closest('.match-list')?.querySelector('a[href*="gameScheduleSeq"]') ||
                          matchWrap.querySelector('a[href*="gameScheduleSeq"]');
      let gameScheduleSeq = null;
      if (detailLink) {
        const seqMatch = detailLink.href.match(/gameScheduleSeq=(\d+)/);
        if (seqMatch) gameScheduleSeq = seqMatch[1];
      }

      // 장소 재추출 (더 정확하게)
      const allText = match.textContent;
      const locMatch = allText.match(/\d{2}:\d{2}([^가-힣]*(?:야구장|공원|운동장|그라운드|경기장|구장)[^\n]*)/);
      if (locMatch) location = locMatch[1].trim();
      if (!location) {
        const locMatch2 = allText.match(/((?:\S+\s*){1,4}(?:야구장|공원|운동장|그라운드|경기장|구장))/);
        if (locMatch2) location = locMatch2[1].trim();
      }

      games.push({
        date, time, location, league,
        lTeamName, lScore, rTeamName, rScore,
        gameScheduleSeq,
        rawText: fullText.slice(0, 200)
      });
    });

    // matches가 비어있으면 전체 텍스트에서 추출 시도
    if (games.length === 0) {
      const text = matchWrap.textContent.replace(/\s+/g, ' ').trim();
      const link = matchWrap.querySelector('a[href*="gameScheduleSeq"]');
      games.push({
        rawText: text.slice(0, 300),
        gameScheduleSeq: link ? link.href.match(/gameScheduleSeq=(\d+)/)?.[1] : null
      });
    }

    return games;
  });
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
  console.log('=== ksbsa.or.kr 경기 스크래퍼 (최종) ===\n');

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 초기 페이지 로드
  await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93', {
    waitUntil: 'networkidle', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(1000);

  const allGames = [];

  for (let month = 3; month <= 11; month++) {
    console.log(`\n=== 2025년 ${month}월 ===`);

    // 해당 월로 이동
    await navigateToMonth(page, 2025, month);

    // 경기 날짜 수집
    const gameDates = await getGameDatesFromCalendar(page);
    if (gameDates.length === 0) {
      console.log('  경기 없음');
      continue;
    }
    console.log(`  경기 날짜: ${gameDates.join(', ')}일`);

    // 각 경기 날짜 클릭하여 상세 수집
    for (const day of gameDates) {
      // 먼저 해당 월로 다시 이동 (날짜 클릭 후 페이지가 변경될 수 있으므로)
      await navigateToMonth(page, 2025, month);
      await page.waitForTimeout(500);

      const games = await clickDateAndGetGames(page, day);
      console.log(`  ${month}/${day}: ${games.length}경기`);

      for (const g of games) {
        // 팀/스코어 정리
        let opponent, ourScore, theirScore;
        const isWindupLeft = /와인드업/.test(g.lTeamName);
        const isWindupRight = /와인드업/.test(g.rTeamName);

        if (isWindupLeft) {
          opponent = g.rTeamName;
          ourScore = g.lScore;
          theirScore = g.rScore;
        } else if (isWindupRight) {
          opponent = g.lTeamName;
          ourScore = g.rScore;
          theirScore = g.lScore;
        } else {
          console.log(`    ⚠ 와인드업 못 찾음: ${g.rawText?.slice(0, 100)}`);
          continue;
        }

        let result = '무';
        if (ourScore > theirScore) result = '승';
        else if (ourScore < theirScore) result = '패';

        const entryId = matchLeague(g.league || g.rawText, 2025);
        console.log(`    ${g.date} vs ${opponent}: ${ourScore}-${theirScore} ${result} [${g.league}] → ${entryId || '?'} (seq:${g.gameScheduleSeq})`);

        allGames.push({
          date: g.date,
          opponent,
          ourScore,
          theirScore,
          result,
          location: g.location || '',
          league: g.league || '',
          entryId,
          gameScheduleSeq: g.gameScheduleSeq
        });
      }
    }
  }

  await browser.close();

  // 결과 정리 및 index.html 반영
  console.log('\n\n=== 수집 완료 ===');
  console.log(`총 ${allGames.length}경기`);

  // entryId별 분류
  const byEntry = {};
  allGames.forEach(g => {
    if (!g.entryId) return;
    if (!byEntry[g.entryId]) byEntry[g.entryId] = [];
    byEntry[g.entryId].push(g);
  });

  const unmatched = allGames.filter(g => !g.entryId);
  if (unmatched.length > 0) {
    console.log(`\n미매칭 경기 ${unmatched.length}개:`);
    unmatched.forEach(g => console.log(`  ${g.date} vs ${g.opponent} [${g.league}]`));
  }

  // 디버그 저장
  const debugDir = path.join(__dirname, '..', 'scrape_debug', 'ksbsa');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(path.join(debugDir, 'final_games.json'), JSON.stringify({allGames, byEntry}, null, 2), 'utf-8');

  // index.html 업데이트
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  for (const [entryId, games] of Object.entries(byEntry)) {
    // 날짜순 정렬 (최신순)
    games.sort((a, b) => b.date.localeCompare(a.date));

    console.log(`\n${entryId}: ${games.length}경기`);
    games.forEach(g => console.log(`  ${g.date} vs ${g.opponent}: ${g.ourScore}-${g.theirScore} ${g.result}`));

    const span = findEntrySpan(html, entryId);
    if (!span) { console.log(`  ❌ 엔트리 못 찾음`); continue; }
    let entryText = html.substring(span.start, span.end);

    const gjs = gamesToJs(games);
    const r = replaceField(entryText, /games\s*:\s*(\{|null|\[)/, `games:${gjs}`);
    if (r) {
      entryText = r;
      html = html.substring(0, span.start) + entryText + html.substring(span.end);
      console.log(`  ✅ 업데이트 완료`);
    } else {
      console.log(`  ❌ games 필드 교체 실패`);
    }
  }

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log('\n=== 완료 ===');
}

main().catch(err => { console.error(err); process.exit(1); });
