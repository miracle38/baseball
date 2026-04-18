const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const page = await browser.newPage();
  const url = `https://www.gameone.kr/league/record/content/batter?lig_idx=108&season=2017&group_code=61`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((t, idx) => {
      const ths = t.querySelector('thead') ? Array.from(t.querySelector('thead').querySelectorAll('th')).map(th=>th.textContent.trim()) : [];
      const rows = t.tBodies[0] ? Array.from(t.tBodies[0].querySelectorAll('tr')) : [];
      // Find Chu
      const chu = rows.find(tr => Array.from(tr.children).map(c=>c.textContent.trim()).some(s => s.includes('추혜승')));
      return { idx, cls: t.className, rowCount: rows.length, thsCount: ths.length, hasChu: !!chu, chuCells: chu ? Array.from(chu.children).map(c=>c.textContent.trim()) : null };
    });
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
