const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchYear=2025';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 모든 "더보기" 버튼 클릭
  const moreButtons = await page.$$('a:has-text("더보기"), button:has-text("더보기")');
  console.log(`"더보기" 버튼 ${moreButtons.length}개 발견`);

  for (let i = 0; i < moreButtons.length; i++) {
    try {
      await moreButtons[i].click();
      await page.waitForTimeout(1500);
    } catch(e) {
      console.log(`  버튼 ${i} 클릭 실패: ${e.message}`);
    }
  }

  await page.waitForTimeout(2000);

  // 전체 HTML 구조 탐색: 더보기 후 어떤 요소가 나타났는지
  const info = await page.evaluate(() => {
    // 테이블 아래 or 옆에 나타난 추가 정보 찾기
    const allTables = Array.from(document.querySelectorAll('table'));
    const result = [];

    allTables.forEach((t, idx) => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      const rows = Array.from(t.querySelectorAll('tbody tr'));

      // 경기 일정/결과 테이블인지 확인
      if (ths.some(h => /일자|날짜|일시|홈|원정|비고/.test(h))) {
        result.push({
          tableIdx: idx,
          type: 'game_schedule',
          ths,
          rowCount: rows.length,
          rows: rows.slice(0, 10).map(r => ({
            cells: Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g,' ').slice(0,80)),
            links: Array.from(r.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().slice(0,30), href: a.href.slice(0,100) }))
          }))
        });
      }
    });

    // 테이블이 아닌 div/section도 확인
    const detailDivs = Array.from(document.querySelectorAll('.detail, .game-list, .schedule-list, [class*="game"], [class*="schedule"], [class*="record"]'));
    result.push({
      type: 'div_search',
      count: detailDivs.length,
      samples: detailDivs.slice(0, 5).map(d => ({
        tag: d.tagName,
        class: d.className,
        text: d.textContent.trim().slice(0, 200)
      }))
    });

    // 모든 테이블 간단 요약
    result.push({
      type: 'all_tables_summary',
      tables: allTables.map((t, idx) => ({
        idx,
        ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()).slice(0, 10),
        rowCount: t.querySelectorAll('tbody tr').length
      }))
    });

    return result;
  });

  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
