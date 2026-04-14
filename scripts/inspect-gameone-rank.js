const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // club 홈에서 시작하여 rank 메뉴 탐색
  console.log('=== 1. club main ===');
  await page.goto('https://www.gameone.kr/club/?club_idx=7734', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const urls = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a')).map(a => a.href).filter(h => /rank|순위|standing/i.test(h)).slice(0, 30);
  });
  console.log('순위 관련 링크:', urls);

  // 2. rank 페이지 직접 시도
  console.log('\n=== 2. rank page (2016) ===');
  for (const path of ['rank', 'ranking', 'standings', 'info/rank']) {
    try {
      const url = `https://www.gameone.kr/club/info/${path}?club_idx=7734`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
      const title = await page.title();
      const h1 = await page.evaluate(() => {
        const h = document.querySelector('h1, h2, .title, .page-title');
        return h ? h.textContent.trim() : '';
      });
      console.log(`  ${url} -> title="${title}" h="${h.slice(0,60)}"`);
    } catch(e) { console.log(`  ${path}: ERROR ${e.message}`); }
  }

  // 3. club 상위 메뉴 탐색
  console.log('\n=== 3. nav links ===');
  await page.goto('https://www.gameone.kr/club/?club_idx=7734', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const menu = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('nav a, .gnb a, .menu a, ul.tab a, .lnb a'))
      .map(a => ({ text: a.textContent.trim(), href: a.href }))
      .filter(x => x.text && x.href)
      .slice(0, 40);
  });
  console.log(JSON.stringify(menu, null, 2));

  await browser.close();
})();
