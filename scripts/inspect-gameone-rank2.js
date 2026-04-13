const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  console.log('=== series/combine/rank ===');
  await page.goto('https://www.gameone.kr/series/combine/rank', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const info1 = await page.evaluate(() => {
    const selects = Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.name || s.id,
      options: Array.from(s.options).slice(0, 10).map(o => ({ text: o.textContent.trim(), value: o.value.slice(0, 100) }))
    }));
    const tables = Array.from(document.querySelectorAll('table')).map((t, i) => ({
      idx: i,
      ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()),
      rowCount: t.querySelectorAll('tbody tr').length,
      firstRow: Array.from(t.querySelectorAll('tbody tr')[0]?.querySelectorAll('td') || []).map(td => td.textContent.trim())
    }));
    return { selects, tables, bodyFirst500: document.body.innerText.slice(0, 500) };
  });
  console.log(JSON.stringify(info1, null, 2));

  // 리그 선택 시도 - 과거 2016 금강토요리그 lig_idx 찾기
  console.log('\n=== 2016 리그 탐색: hitter 페이지에서 2016 선택 ===');
  await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.selectOption('select:first-of-type', '2016').catch(() => {});
  await page.waitForTimeout(3000);

  // 리그 탭
  await page.evaluate(() => {
    document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
      if (t.textContent.trim() === '리그') t.click();
    });
  });
  await page.waitForTimeout(2000);

  const leagues2016 = await page.evaluate(() => {
    const opts = [];
    document.querySelectorAll('select').forEach(s => {
      Array.from(s.options).forEach(o => {
        try {
          const val = JSON.parse(o.value);
          if (val.lig_idx) opts.push({ text: o.textContent.trim(), lig_idx: val.lig_idx, raw: o.value });
        } catch(e) {}
      });
    });
    return opts;
  });
  console.log('2016 리그:', JSON.stringify(leagues2016, null, 2));

  // 리그별 순위 URL 시도
  if (leagues2016.length > 0) {
    const lig = leagues2016[0];
    console.log(`\n=== 리그 ${lig.lig_idx} 순위 시도 ===`);
    for (const url of [
      `https://www.gameone.kr/league/rank/team?lig_idx=${lig.lig_idx}`,
      `https://www.gameone.kr/league/info/rank?lig_idx=${lig.lig_idx}`,
      `https://www.gameone.kr/series/rank?lig_idx=${lig.lig_idx}`,
      `https://www.gameone.kr/series/info/rank?lig_idx=${lig.lig_idx}`,
    ]) {
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await page.waitForTimeout(2000);
        const r = await page.evaluate(() => {
          const tables = document.querySelectorAll('table');
          return {
            title: document.title,
            bodyLen: document.body.innerText.length,
            tableCount: tables.length,
            firstTable: tables[0] ? {
              ths: Array.from(tables[0].querySelectorAll('th')).map(t => t.textContent.trim()),
              firstRow: Array.from(tables[0].querySelectorAll('tbody tr')[0]?.querySelectorAll('td') || []).map(t => t.textContent.trim())
            } : null
          };
        });
        console.log(`  ${url}:`, JSON.stringify(r).slice(0, 300));
      } catch(e) { console.log(`  ${url}: ERROR ${e.message}`); }
    }
  }

  await browser.close();
})();
