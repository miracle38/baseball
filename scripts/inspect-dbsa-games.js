const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  for (const { name, base, teamSeq, year } of [
    { name: 'ksbsa 2026', base: 'https://www.ksbsa.or.kr', teamSeq: 93, year: 2026 },
    { name: 'ksbsa 2024', base: 'https://www.ksbsa.or.kr', teamSeq: 93, year: 2024 },
    { name: 'donggu 2026', base: 'https://donggu.dbsa.kr', teamSeq: 70, year: 2026 },
    { name: 'daedeok 2024', base: 'https://daedeokgu.dbsa.kr', teamSeq: 24, year: 2024 },
  ]) {
    console.log('\n===', name);
    const url = `${base}/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=${teamSeq}&searchYear=${year}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const info = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a')).filter(a => /box|score|game_idx|gameSeq|game_seq|기록/.test(a.href + a.textContent));
      return links.slice(0, 15).map(a => ({ text: a.textContent.trim().slice(0,20), href: a.href.slice(0, 200) }));
    });
    console.log('links:', JSON.stringify(info, null, 2));

    // 메인 페이지 경기 결과
    const url2 = `${base}/teamPage/main/getMain.hs?teamSeq=${teamSeq}`;
    await page.goto(url2, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);
    const rows = await page.evaluate(() => {
      const out = [];
      document.querySelectorAll('table tr').forEach(tr => {
        const cells = Array.from(tr.children);
        const rowText = tr.textContent.replace(/\s+/g, ' ').trim();
        const links = Array.from(tr.querySelectorAll('a')).map(a => ({ text: a.textContent.trim().slice(0,20), href: a.href }));
        if (rowText.includes(':') || rowText.includes('VS')) {
          out.push({ text: rowText.slice(0, 100), links });
        }
      });
      return out.slice(0, 10);
    });
    console.log('main page game rows:', JSON.stringify(rows, null, 2));
  }

  await browser.close();
})();
