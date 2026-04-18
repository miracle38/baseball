const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const page = await browser.newPage();
  // try ?pg=2
  for (const pg of [1,2,3]) {
    const url = `https://www.gameone.kr/league/record/content/batter?lig_idx=108&season=2017&group_code=61&pg=${pg}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1500);
    const info = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let best = null, max = 0;
      tables.forEach(t => { const h = t.querySelector('thead') ? t.querySelector('thead').querySelectorAll('th').length : 0; if (h > max) { max = h; best = t; }});
      if (!best) return null;
      const rows = Array.from(best.tBodies[0].querySelectorAll('tr'));
      return { rows: rows.length, first: rows.slice(0,2).map(tr => Array.from(tr.children).slice(0,3).map(c=>c.textContent.trim())), last: rows.slice(-2).map(tr => Array.from(tr.children).slice(0,3).map(c=>c.textContent.trim())) };
    });
    console.log(`pg=${pg}:`, JSON.stringify(info));
  }
  // alt: maybe /list or different api
  // try large limit param
  for (const u of [
    'https://www.gameone.kr/league/record/content/batter?lig_idx=108&season=2017&group_code=61&limit=1000',
    'https://www.gameone.kr/league/record/content/batter?lig_idx=108&season=2017&group_code=61&pg=1&pageSize=500',
  ]) {
    await page.goto(u, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1200);
    const n = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let max = 0;
      tables.forEach(t => { const h = t.querySelector('thead') ? t.querySelector('thead').querySelectorAll('th').length : 0; if (h > max) { max = h; }});
      let best = tables.find(t => t.querySelector('thead') && t.querySelector('thead').querySelectorAll('th').length === max);
      return best && best.tBodies[0] ? best.tBodies[0].querySelectorAll('tr').length : 0;
    });
    console.log(`'${u}' rows=${n}`);
  }
  await browser.close();
})();
