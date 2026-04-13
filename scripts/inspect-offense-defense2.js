const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 2016 토요금강 A조 offense/defense
  for (const kind of ['offense', 'defense']) {
    const url = `https://www.gameone.kr/league/record/content/${kind}?lig_idx=113&group_code=41&part_code=1&season=2016`;
    console.log('\n===', kind, url);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
    await page.waitForTimeout(2500);

    // DOM 구조 깊이 분석: 모든 테이블의 thead/tbody
    const info = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      return tables.map((t, idx) => {
        const thead = t.querySelector('thead');
        const tbody = t.querySelector('tbody');
        return {
          idx,
          theadText: thead ? thead.textContent.trim().replace(/\s+/g, ' ').slice(0, 200) : 'NO THEAD',
          tbodyRowCount: tbody ? tbody.querySelectorAll('tr').length : 0,
          tbodyFirstRows: tbody ? Array.from(tbody.querySelectorAll('tr')).slice(0, 3).map(r =>
            Array.from(r.children).map(c => ({ tag: c.tagName, text: c.textContent.trim() }))
          ) : [],
          rawHtml: t.outerHTML.slice(0, 500)
        };
      });
    });
    console.log(JSON.stringify(info, null, 2).slice(0, 3000));
  }

  await browser.close();
})();
