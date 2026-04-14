const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchYear=2025';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);

  // "더보기" 같은 것 전체 확장
  await page.evaluate(() => {
    document.querySelectorAll('a, button').forEach(el => {
      if (/더보기|전체/.test(el.textContent)) el.click();
    });
  });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((t, idx) => ({
      idx,
      ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()),
      rowCount: t.querySelectorAll('tbody tr').length,
      sampleRows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 5).map(r => ({
        cells: Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g,' ').slice(0, 60)),
        links: Array.from(r.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().slice(0,20), href: a.href }))
      }))
    }));
  });
  console.log(JSON.stringify(info, null, 2).slice(0, 5000));

  await browser.close();
})();
