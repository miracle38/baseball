const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const page = await browser.newPage();
  const url = `https://www.gameone.kr/league/record/content/batter?lig_idx=108&season=2017&group_code=61`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  // Look at page structure -- pagination links
  const info = await page.evaluate(() => {
    const paging = document.querySelector('.paging, .pagination, .page');
    return {
      pagingHtml: paging ? paging.outerHTML : null,
      urlParams: location.search,
      selects: Array.from(document.querySelectorAll('select')).map(s => ({ name: s.name, options: Array.from(s.options).map(o => ({v: o.value, t: o.textContent.trim()})) })),
      // Links that contain page or ?pg=
      pageLinks: Array.from(document.querySelectorAll('a')).filter(a => /(&|\?)(pg|page)=/i.test(a.href || '')).map(a => a.href).slice(0, 10),
      allALinksPage: Array.from(document.querySelectorAll('a[href*="pg="], a[href*="page="]')).map(a => a.href).slice(0, 20)
    };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
