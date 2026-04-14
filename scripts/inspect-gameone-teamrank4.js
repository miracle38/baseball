const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  const urls = [
    'https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=0&season=2016',
    'https://www.gameone.kr/league/record/content/rank?lig_idx=113&group=41&part=1&season=2016',
    'https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=41&season=2016',
    'https://www.gameone.kr/league/record/content/rank?lig_idx=113&season=2016',
    'https://www.gameone.kr/league/record/content/rank?lig_idx=63&group_code=0&season=2016',
  ];

  for (const url of urls) {
    console.log('\n===', url);
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);
      const info = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        return tables.map((t, idx) => ({
          idx,
          ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()),
          rowCount: t.querySelectorAll('tbody tr').length,
          sample: Array.from(t.querySelectorAll('tbody tr')).slice(0, 15).map(r =>
            Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim()))
        }));
      });
      console.log(JSON.stringify(info, null, 2));
    } catch(e) { console.log('ERR', e.message); }
  }

  await browser.close();
})();
