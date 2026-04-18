const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 경기일정/결과 페이지로 직접 접근
  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getScheduleRecord.hs?teamSeq=93&searchYear=2025';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const allTables = Array.from(document.querySelectorAll('table'));
    const result = [];

    allTables.forEach((t, idx) => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      const rows = Array.from(t.querySelectorAll('tbody tr'));
      result.push({
        tableIdx: idx,
        ths: ths.slice(0, 20),
        rowCount: rows.length,
        rows: rows.slice(0, 20).map(r => ({
          cells: Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g,' ').slice(0,80)),
          links: Array.from(r.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().slice(0,30), href: a.href.slice(0,150) }))
        }))
      });
    });

    // 테이블 없으면 전체 body 텍스트 일부
    if (result.length === 0) {
      result.push({ type: 'no_tables', bodyText: document.body.textContent.trim().slice(0, 2000) });
    }

    return result;
  });

  console.log(JSON.stringify(info, null, 2));

  // URL에 다양한 경로 시도
  const urls = [
    'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getScheduleRecord.hs?teamSeq=93&searchYear=2025',
    'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93&searchYear=2025',
    'https://www.ksbsa.or.kr/teamPage/main/getMain.hs?teamSeq=93',
  ];

  // 메인 페이지에서 경기 일정 링크 찾기
  await page.goto('https://www.ksbsa.or.kr/teamPage/main/getMain.hs?teamSeq=93', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const navLinks = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent.trim().slice(0, 50),
      href: a.href
    })).filter(l => /일정|경기|기록|schedule|record|game/i.test(l.text + l.href));
  });
  console.log('\n=== 네비게이션 링크 ===');
  console.log(JSON.stringify(navLinks, null, 2));

  await browser.close();
})();
