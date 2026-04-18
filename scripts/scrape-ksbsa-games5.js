/**
 * ksbsa.or.kr 경기 스크래퍼 (v5)
 * 전략: 캘린더 POST 네비게이션으로 월별 이동 → 경기 날짜 수집 → 경기내용 링크 추출
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

async function main() {
  console.log('=== ksbsa.or.kr 경기 스크래퍼 (v5) ===\n');

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  const allGames = [];

  // 2025년 3월~11월 각 월 순회
  for (let month = 3; month <= 11; month++) {
    console.log(`\n--- 2025년 ${month}월 ---`);

    // POST로 캘린더 페이지 이동
    await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93', {
      waitUntil: 'networkidle', timeout: 20000
    }).catch(() => {});
    await page.waitForTimeout(1000);

    // 폼 서밋으로 해당 월 이동
    await page.evaluate(({yr, mo}) => {
      // 직접 form을 만들어서 POST
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93';

      const addField = (name, value) => {
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = name;
        input.value = value;
        form.appendChild(input);
      };

      addField('thisYear', yr);
      addField('thisMonth', String(mo).padStart(2, '0'));
      addField('thisDay', '01');
      document.body.appendChild(form);
      form.submit();
    }, {yr: '2025', mo: month});

    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // 현재 표시된 월 확인 + 경기 날짜/링크 수집
    const monthData = await page.evaluate(() => {
      const result = {
        displayedMonth: '',
        games: []
      };

      // 표시 중인 월 확인
      const monthDisplay = document.querySelector('.cal-month, .month-title, h3, h2');
      if (monthDisplay) result.displayedMonth = monthDisplay.textContent.trim();

      // 하단 경기 테이블에서 수집
      const tables = document.querySelectorAll('table');
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
        if (ths.some(h => /경기일시/.test(h))) {
          const rows = Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td'));
          rows.forEach(r => {
            const cells = Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g, ' '));
            const links = Array.from(r.querySelectorAll('a'));
            const recordLink = links.find(a => /경기기록|경기내용/.test(a.textContent));
            result.games.push({
              dateTime: cells[0] || '',
              league: cells[1] || '',
              location: cells[2] || '',
              gameStr: cells[3] || '',
              recordHref: recordLink ? recordLink.href : null
            });
          });
          break;
        }
      }

      // 캘린더 셀에서도 추가 정보 수집
      const calCells = document.querySelectorAll('td a.el-cal-item');
      const gameDates = [];
      calCells.forEach(a => {
        const dateP = a.querySelector('.date');
        const matchP = a.querySelector('.match');
        if (dateP && matchP) {
          const day = dateP.textContent.trim();
          const count = matchP.textContent.trim();
          if (/\+\d/.test(count)) {
            gameDates.push({ day: parseInt(day), count: count });
          }
        }
      });
      result.gameDates = gameDates;

      return result;
    });

    console.log(`  표시 월: ${monthData.displayedMonth}`);
    console.log(`  캘린더 경기 날짜: ${monthData.gameDates.map(d => d.day + '일(' + d.count + ')').join(', ') || '없음'}`);
    console.log(`  하단 경기: ${monthData.games.length}개`);
    monthData.games.forEach(g => console.log(`    ${g.dateTime} | ${g.league} | ${g.gameStr}`));

    // 하단 경기 테이블의 내용 수집
    allGames.push(...monthData.games);

    // 캘린더 날짜를 클릭하여 해당 날짜의 경기 확인
    for (const gd of monthData.gameDates) {
      console.log(`\n  ${gd.day}일 클릭...`);
      await page.evaluate(({day}) => {
        const calCells = document.querySelectorAll('td a.el-cal-item');
        for (const a of calCells) {
          const dateP = a.querySelector('.date');
          if (dateP && parseInt(dateP.textContent.trim()) === day) {
            a.click();
            return;
          }
        }
      }, {day: gd.day});

      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1500);

      // 경기 테이블 확인
      const dayGames = await page.evaluate(() => {
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
                gameStr: cells[3] || '',
                recordHref: recordLink ? recordLink.href : null
              };
            });
          }
        }
        return [];
      });

      console.log(`    경기: ${dayGames.length}개`);
      dayGames.forEach(g => console.log(`      ${g.dateTime} | ${g.league} | ${g.gameStr}`));

      // 새 경기 추가 (중복 제거)
      for (const g of dayGames) {
        if (!allGames.some(existing => existing.dateTime === g.dateTime && existing.gameStr === g.gameStr)) {
          allGames.push(g);
        }
      }

      // 다시 해당 월 캘린더로 돌아가기
      await page.evaluate(({yr, mo}) => {
        const form = document.createElement('form');
        form.method = 'POST';
        form.action = '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93';
        const addField = (name, value) => {
          const input = document.createElement('input');
          input.type = 'hidden'; input.name = name; input.value = value;
          form.appendChild(input);
        };
        addField('thisYear', yr);
        addField('thisMonth', String(mo).padStart(2, '0'));
        addField('thisDay', '01');
        document.body.appendChild(form);
        form.submit();
      }, {yr: '2025', mo: month});

      await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
      await page.waitForTimeout(1000);
    }
  }

  await browser.close();

  // 결과 정리
  console.log('\n\n=== 수집 결과 ===');
  console.log(`총 ${allGames.length}경기`);

  // 중복 제거
  const unique = [];
  const seen = new Set();
  allGames.forEach(g => {
    const key = g.dateTime + '|' + g.gameStr;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(g);
    }
  });

  console.log(`고유 경기: ${unique.length}개`);
  unique.sort((a, b) => a.dateTime.localeCompare(b.dateTime));
  unique.forEach(g => console.log(`  ${g.dateTime} | ${g.league} | ${g.gameStr} | ${g.location}`));

  // 디버그 저장
  const debugDir = path.join(__dirname, '..', 'scrape_debug', 'ksbsa');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });
  fs.writeFileSync(path.join(debugDir, 'all_games_v5.json'), JSON.stringify(unique, null, 2), 'utf-8');
}

main().catch(err => { console.error(err); process.exit(1); });
