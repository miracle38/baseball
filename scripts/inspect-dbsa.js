const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();
  await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getBatterRecord.hs?teamSeq=93&searchYear=2026', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 첫 번째 table 구조 뽑기
  const info = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const result = [];
    tables.forEach((t, idx) => {
      const ths = Array.from(t.querySelectorAll('thead th, tr th')).map(th => th.textContent.trim());
      const firstRow = t.querySelector('tbody tr');
      const cells = firstRow ? Array.from(firstRow.querySelectorAll('td')).map(td => td.textContent.trim()) : [];
      result.push({ idx, ths, firstRowCells: cells, rowCount: t.querySelectorAll('tbody tr').length });
    });
    return result;
  });
  fs.writeFileSync('D:/00. Claude/02. baseball/scrape_debug/dbsa_batter_struct.json', JSON.stringify(info, null, 2));
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
