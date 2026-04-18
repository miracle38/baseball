const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 경기일정 및 기록 페이지
  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 2025 선택 (연도 셀렉트 혹은 버튼)
  const yearSel = await page.evaluate(() => {
    // select, option 확인
    const selects = Array.from(document.querySelectorAll('select'));
    return selects.map(s => ({
      name: s.name || s.id,
      options: Array.from(s.options).map(o => ({ value: o.value, text: o.textContent.trim() }))
    }));
  });
  console.log('=== 연도 셀렉트 ===');
  console.log(JSON.stringify(yearSel, null, 2));

  // 연도 필터가 있으면 2025 선택
  for (const sel of yearSel) {
    const has2025 = sel.options.some(o => o.value === '2025' || o.text === '2025');
    if (has2025) {
      await page.selectOption(`select[name="${sel.name}"], select#${sel.name}`, '2025');
      await page.waitForTimeout(2000);
      break;
    }
  }

  // 테이블 내용 확인
  const info = await page.evaluate(() => {
    const allTables = Array.from(document.querySelectorAll('table'));
    return allTables.map((t, idx) => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      const rows = Array.from(t.querySelectorAll('tbody tr, tr')).filter(r => r.querySelector('td'));
      return {
        tableIdx: idx,
        ths: ths.slice(0, 20),
        rowCount: rows.length,
        rows: rows.slice(0, 30).map(r => ({
          cells: Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g,' ').slice(0,80)),
          links: Array.from(r.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().slice(0,40), href: a.href.slice(0,200) }))
        }))
      };
    });
  });

  console.log('\n=== 테이블 구조 ===');
  console.log(JSON.stringify(info, null, 2).slice(0, 8000));

  await browser.close();
})();
