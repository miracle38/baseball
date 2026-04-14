const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 2020 대전 토요3부 lig_idx=113 group_code=58 - part_code 다르게 시도
  console.log('=== 2020 대전 토요3부 group_code=58 - part_code 변주 ===');
  for (const pc of ['-1', '0', '1', '2', '3', '4', '5']) {
    try {
      const url = `https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=58&part_code=${pc}&season=2020`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const rows = [];
        document.querySelectorAll('table tbody tr').forEach(tr => {
          const c = Array.from(tr.querySelectorAll('td')).map(x => x.textContent.trim());
          if (c.length >= 5 && parseInt(c[0])) rows.push(`${c[0]}.${c[1]} ${c[3]}-${c[4]}-${c[5]}`);
        });
        return rows;
      });
      console.log(`\npart_code=${pc}: ${r.length}팀`);
      r.forEach(x => console.log('  ' + x));
    } catch(e) { console.log(`pc=${pc} ERR`, e.message); }
  }

  // iframe의 part_code select 직접 조사 (JS로 동적 옵션 가능성)
  console.log('\n=== iframe part_code select 모든 옵션 (JS 렌더링 후) ===');
  await page.goto('https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=58&season=2020', { waitUntil: 'networkidle', timeout: 20000 });
  await page.waitForTimeout(4000);
  const selects = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('select')).map(s => ({
      name: s.name || s.id,
      options: Array.from(s.options).map(o => ({ text: o.textContent.trim(), value: o.value }))
    }));
  });
  console.log(JSON.stringify(selects, null, 2));

  await browser.close();
})();
