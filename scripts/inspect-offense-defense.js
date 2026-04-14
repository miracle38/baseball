const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  for (const kind of ['offense', 'defense']) {
    const url = `https://www.gameone.kr/league/record/content/${kind}?lig_idx=113&group_code=0&season=2016`;
    console.log('\n===', url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      return tables.map((t, idx) => ({
        idx,
        ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()),
        sample: Array.from(t.querySelectorAll('tbody tr')).slice(0, 3).map(r =>
          Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim()))
      }));
    });
    console.log(JSON.stringify(info, null, 2));
  }

  await browser.close();
})();
