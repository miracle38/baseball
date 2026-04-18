const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const page = await browser.newPage();
  const url = `https://www.gameone.kr/league/record/content/batter?lig_idx=63&season=2016&group_code=50`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
  const info = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((t, idx) => {
      const ths = t.querySelector('thead') ? Array.from(t.querySelector('thead').querySelectorAll('th')).map(th=>th.textContent.trim()) : [];
      const rows = t.tBodies[0] ? Array.from(t.tBodies[0].querySelectorAll('tr')) : [];
      const chu = rows.find(tr => Array.from(tr.children).map(c=>c.textContent.trim()).some(s => s.includes('추혜승')));
      const windupRows = rows.filter(tr => Array.from(tr.children).map(c=>c.textContent.trim()).some(s => s.replace(/\s+/g,'').includes('와인드업')));
      return { idx, rowCount: rows.length, thsCount: ths.length, hasChu: !!chu, chuCells: chu ? Array.from(chu.children).map(c=>c.textContent.trim()) : null, windupCount: windupRows.length };
    });
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
