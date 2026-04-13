const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  await page.goto('https://www.gameone.kr/league/?lig_idx=113', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  const info = await page.evaluate(() => {
    return {
      url: location.href,
      title: document.title,
      allLinks: Array.from(document.querySelectorAll('a'))
        .map(a => ({ text: a.textContent.trim(), href: a.href }))
        .filter(x => x.text && /랭킹|rank|record|기록/i.test(x.text + x.href))
        .slice(0, 50)
    };
  });
  console.log('URL:', info.url);
  console.log('Title:', info.title);
  console.log('Links:', JSON.stringify(info.allLinks, null, 2));

  await browser.close();
})();
