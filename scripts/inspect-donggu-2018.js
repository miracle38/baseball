const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  for (const kind of ['rank', 'offense', 'defense']) {
    const url = `https://www.gameone.kr/league/record/content/${kind}?lig_idx=45&group_code=0&season=2018`;
    console.log('\n===', kind, url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table.ranking_table, table'));
      return tables.map((t, idx) => {
        const ths = Array.from(t.querySelectorAll('thead th')).map(th => th.textContent.trim().replace(/\s+/g,' '));
        const rows = Array.from(t.querySelectorAll('tbody tr'));
        const windup = rows.find(r => /와인드업/.test(r.textContent));
        const windupCells = windup ? Array.from(windup.children).map(c => c.textContent.trim()) : null;
        return {
          idx,
          thsCount: ths.length,
          ths: ths.slice(0, 30),
          rowCount: rows.length,
          windupCells
        };
      });
    });
    console.log(JSON.stringify(info, null, 2).slice(0, 3500));
  }

  await browser.close();
})();
