const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 다양한 파라미터 조합
  const urls = [
    'https://www.gameone.kr/league/record/rank?lig_idx=113&season=2016',
    'https://www.gameone.kr/league/record/rank?lig_idx=113&season=2016&group=41&part=1',
    'https://www.gameone.kr/league/record/rank?lig_idx=113&season=2016&group=41',
    'https://www.gameone.kr/league/record/rank?lig_idx=63&season=2016',  // 대덕 토요3부B
    'https://www.gameone.kr/league/record/rank?lig_idx=113&season=2025', // 비교: 금강 2025
  ];

  for (const url of urls) {
    console.log('\n===', url);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const info = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      return tables.map((t, idx) => ({
        idx,
        ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()),
        rowCount: t.querySelectorAll('tbody tr').length,
        sampleRows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 5).map(r =>
          Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim()))
      }));
    });
    console.log(JSON.stringify(info, null, 2));
  }

  await browser.close();
})();
