/**
 * ksbsa.or.kr 경기 스크래퍼 (v3)
 * - 캘린더에서 날짜 클릭 → 경기 상세 수집
 * - 또는 메인 페이지에서 모든 "경기내용" 링크 수집 → 개별 박스스코어 페이지 파싱
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

async function main() {
  console.log('=== ksbsa.or.kr 경기 스크래퍼 (v3) ===\n');

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 1) 캘린더 페이지에서 경기 있는 날짜 클릭 시 무슨 일이 일어나는지 확인
  console.log('=== 캘린더 날짜 클릭 테스트 (2025-04) ===');
  await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93&searchYear=2025&searchMonth=4', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  // 캘린더에서 "+1" 표시 있는 날짜 셀 찾기
  const calInfo = await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td'));
    return cells.map((td, i) => {
      const text = td.textContent.trim();
      const hasGame = /\+\d/.test(text) || td.querySelector('.schedule-count, .badge, .event');
      const links = Array.from(td.querySelectorAll('a')).map(a => ({ href: a.href, text: a.textContent.trim().slice(0, 50), onclick: a.getAttribute('onclick') }));
      if (hasGame || links.length > 0) {
        return { idx: i, text: text.slice(0, 50), hasGame, links };
      }
      return null;
    }).filter(Boolean);
  });
  console.log('경기 있는 셀:', JSON.stringify(calInfo.slice(0, 10), null, 2));

  // 경기 있는 날짜 클릭
  if (calInfo.length > 0) {
    const gameCell = calInfo.find(c => c.hasGame) || calInfo[0];
    console.log(`\n클릭할 셀: ${gameCell.text}`);

    if (gameCell.links.length > 0 && gameCell.links[0].onclick) {
      await page.evaluate((onclick) => eval(onclick), gameCell.links[0].onclick);
    } else {
      await page.evaluate((idx) => {
        const cells = Array.from(document.querySelectorAll('td'));
        const links = cells[idx].querySelectorAll('a');
        if (links.length > 0) links[0].click();
        else cells[idx].click();
      }, gameCell.idx);
    }
    await page.waitForTimeout(3000);

    // 날짜 클릭 후 화면 변화 확인
    const afterClick = await page.evaluate(() => {
      // 모달, 팝업, 새 테이블 등 확인
      const modals = Array.from(document.querySelectorAll('.modal, .popup, [class*="modal"], [class*="popup"], [style*="display: block"], [style*="display:block"]'));
      const tables = Array.from(document.querySelectorAll('table'));

      return {
        modals: modals.map(m => ({ class: m.className, text: m.textContent.trim().slice(0, 300), visible: m.offsetParent !== null })),
        tables: tables.map((t, idx) => ({
          idx,
          ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()).slice(0, 10),
          rowCount: t.querySelectorAll('tr td').length > 0 ? Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td')).length : 0
        })),
        url: window.location.href
      };
    });
    console.log('클릭 후:', JSON.stringify(afterClick, null, 2).slice(0, 2000));
  }

  // 2) 메인 페이지에서 모든 경기 링크 수집
  console.log('\n\n=== 메인 페이지에서 경기 링크 수집 ===');
  await page.goto('https://www.ksbsa.or.kr/teamPage/main/getMain.hs?teamSeq=93', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const mainInfo = await page.evaluate(() => {
    // "경기내용" 또는 "경기기록" 링크 모두 수집
    const allLinks = Array.from(document.querySelectorAll('a'));
    const gameLinks = allLinks.filter(a =>
      /경기내용|경기기록|gameRecord|gameScheduleSeq/.test(a.textContent + a.href)
    );
    return gameLinks.map(a => ({
      text: a.textContent.trim().slice(0, 50),
      href: a.href,
      parentText: a.parentElement?.textContent.trim().replace(/\s+/g, ' ').slice(0, 150)
    }));
  });
  console.log(`경기 링크 ${mainInfo.length}개:`);
  mainInfo.forEach(l => console.log(`  ${l.href}`));
  console.log('\n부모 텍스트:');
  mainInfo.forEach(l => console.log(`  ${l.parentText}`));

  // 3) 실제 경기내용 페이지의 구조 확인
  if (mainInfo.length > 0) {
    console.log('\n\n=== 경기내용 상세 페이지 구조 ===');
    const href = mainInfo[0].href;
    console.log(`URL: ${href}`);
    await page.goto(href, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);

    const detail = await page.evaluate(() => {
      const result = {};

      // 전체 구조 파악
      const allText = document.body.textContent.replace(/\s+/g, ' ').slice(0, 3000);
      result.bodyText = allText;

      // 모든 테이블
      const tables = Array.from(document.querySelectorAll('table'));
      result.tables = tables.map((t, idx) => {
        const allRows = Array.from(t.querySelectorAll('tr'));
        return {
          idx,
          rows: allRows.slice(0, 5).map(r =>
            Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g, ' ').slice(0, 60))
          )
        };
      });

      // 팀명/스코어 관련 요소
      const h1h2 = Array.from(document.querySelectorAll('h1, h2, h3, h4, .title, .game-title'));
      result.headings = h1h2.map(h => h.textContent.trim().slice(0, 100));

      return result;
    });
    console.log('\n헤딩:', detail.headings);
    console.log('\n테이블:', JSON.stringify(detail.tables, null, 2).slice(0, 3000));
    console.log('\n본문 (일부):', detail.bodyText.slice(0, 1500));
  }

  // 4) 캘린더 2025년 3~11월 순회하며 경기 날짜 수집
  console.log('\n\n=== 2025년 월별 캘린더 경기 날짜 수집 ===');
  const allGameDates = [];

  for (let month = 3; month <= 11; month++) {
    const calUrl = `https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93&searchYear=2025&searchMonth=${month}`;
    await page.goto(calUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const dates = await page.evaluate(({mo}) => {
      const cells = Array.from(document.querySelectorAll('td'));
      const gameDates = [];
      cells.forEach(td => {
        const text = td.textContent.trim();
        if (/\+\d/.test(text)) {
          const dayMatch = text.match(/^(\d+)/);
          if (dayMatch) gameDates.push(parseInt(dayMatch[1]));
        }
      });
      return gameDates;
    }, {mo: month});

    if (dates.length > 0) {
      console.log(`  ${month}월: ${dates.join(', ')}일`);
      dates.forEach(d => allGameDates.push({ year: 2025, month, day: d }));
    }
  }

  console.log(`\n총 ${allGameDates.length}개 경기 날짜 발견`);

  // 5) 각 경기 날짜 클릭하여 상세 정보 수집
  if (allGameDates.length > 0) {
    console.log('\n=== 첫 번째 경기 날짜 클릭 테스트 ===');
    const first = allGameDates[0];
    const calUrl = `https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93&searchYear=2025&searchMonth=${first.month}`;
    await page.goto(calUrl, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // 해당 날짜 셀의 링크 클릭
    const clickResult = await page.evaluate(({day}) => {
      const cells = Array.from(document.querySelectorAll('td'));
      for (const td of cells) {
        const text = td.textContent.trim();
        const dayMatch = text.match(/^(\d+)/);
        if (dayMatch && parseInt(dayMatch[1]) === day && /\+\d/.test(text)) {
          const links = td.querySelectorAll('a');
          // 각 링크의 정보
          const linkInfo = Array.from(links).map(a => ({
            text: a.textContent.trim().slice(0, 50),
            href: a.href,
            onclick: a.getAttribute('onclick'),
            dataAttr: Array.from(a.attributes).filter(attr => attr.name.startsWith('data-')).map(attr => `${attr.name}=${attr.value}`)
          }));
          return { found: true, linkInfo, cellHtml: td.innerHTML.slice(0, 500) };
        }
      }
      return { found: false };
    }, {day: first.day});
    console.log(JSON.stringify(clickResult, null, 2));
  }

  await browser.close();
  console.log('\n=== 탐색 완료 ===');
}

main().catch(err => { console.error(err); process.exit(1); });
