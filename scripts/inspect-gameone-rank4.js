const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 다양한 URL 시도
  const urls = [
    'https://www.gameone.kr/club/info/ranking/team?club_idx=7734&season=2016&kind=5&lig_idx=113&group=41&part=1',
    'https://www.gameone.kr/club/info/ranking/rank?club_idx=7734&season=2016&lig_idx=113',
    'https://www.gameone.kr/club/info/ranking?club_idx=7734',
    'https://www.gameone.kr/club/info/rank?club_idx=7734&season=2016',
    'https://www.gameone.kr/league/?lig_idx=113',
    'https://www.gameone.kr/league/info?lig_idx=113',
    'https://www.gameone.kr/league/info/rank?lig_idx=113&group=41&part=1',
    'https://www.gameone.kr/league/rank/team?lig_idx=113&group=41&part=1',
    'https://www.gameone.kr/series/info/rank?lig_idx=113',
    'https://www.gameone.kr/search/league?keyword=%EA%B8%88%EA%B0%95',
  ];

  for (const url of urls) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const tables = document.querySelectorAll('table');
        const ths = Array.from(tables[0]?.querySelectorAll('th') || []).map(t => t.textContent.trim());
        const firstRow = Array.from(tables[0]?.querySelectorAll('tbody tr')[0]?.querySelectorAll('td') || []).map(t => t.textContent.trim());
        return {
          title: document.title,
          rows: tables[0]?.querySelectorAll('tbody tr').length || 0,
          ths: ths.slice(0, 15),
          firstRow: firstRow.slice(0, 15),
          has순위: document.body.innerText.includes('순위') && !document.body.innerText.includes('찾을 수 없습니다')
        };
      });
      console.log(url);
      console.log(' ', JSON.stringify(r).slice(0, 400));
    } catch(e) { console.log(url, 'ERR', e.message); }
  }

  await browser.close();
})();
