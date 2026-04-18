const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const page = await browser.newPage();
  const url = `https://www.gameone.kr/league/record/content/batter?lig_idx=108&season=2017&group_code=61`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1500);
  const result = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((tbl, idx) => {
      const thead = tbl.querySelector('thead');
      const ths = thead ? Array.from(thead.querySelectorAll('th')).map(t => t.textContent.trim()) : [];
      const firstTr = tbl.querySelector('tr');
      const firstTrCells = firstTr ? Array.from(firstTr.children).map(c => c.textContent.trim()) : [];
      const bodyRows = tbl.tBodies[0] ? Array.from(tbl.tBodies[0].querySelectorAll('tr')).slice(0, 3) : [];
      const sample = bodyRows.map(tr => Array.from(tr.children).map(c => c.textContent.trim()));
      const rowCount = tbl.tBodies[0] ? tbl.tBodies[0].querySelectorAll('tr').length : 0;
      return { idx, className: tbl.className, id: tbl.id, headersFromThead: ths, firstTrCells, sampleRows: sample, rowCount };
    });
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})();
