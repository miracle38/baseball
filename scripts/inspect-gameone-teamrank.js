const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  const url = 'https://www.gameone.kr/league/record/rank?lig_idx=113';
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.name || s.id,
      options: Array.from(s.options).slice(0, 20).map(o => ({ text: o.textContent.trim().slice(0,40), value: (o.value||'').slice(0,100) }))
    }));
    const tables = Array.from(document.querySelectorAll('table')).map((t, idx) => ({
      idx,
      ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().split(/\s+/)[0]),
      rowCount: t.querySelectorAll('tbody tr').length,
      sampleRows: Array.from(t.querySelectorAll('tbody tr')).slice(0, 3).map(r =>
        Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim()))
    }));
    return { selects, tables };
  });
  console.log(JSON.stringify(info, null, 2));

  await browser.close();
})();
