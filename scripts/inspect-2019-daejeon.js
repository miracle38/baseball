const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  console.log('=== 2019 대전 토요3부 lig=113 group=55 - 각 part_code ===');
  for (const pc of ['-1', '0', '1', '2', '3']) {
    const url = `https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=55&part_code=${pc}&season=2019`;
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
  }

  // 2016 일요금강 3부 (gc=43) 각 part - 확인 용
  console.log('\n=== 2016 일요금강 3부 gc=43 part_code ===');
  for (const pc of ['-1', '1', '2', '3', '4', '5']) {
    const url = `https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=43&part_code=${pc}&season=2016`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const c = Array.from(tr.querySelectorAll('td')).map(x => x.textContent.trim());
        if (c.length >= 5 && parseInt(c[0])) rows.push(`${c[0]}.${c[1]}`);
      });
      return rows;
    });
    console.log(`pc=${pc}: ${r.length}팀 - ${r.slice(0,3).join(', ')}`);
  }

  // 2021 대전 토요3부는 어떻게? club dropdown 에서 group/part 확인
  console.log('\n=== 2021 club 리그 옵션 ===');
  await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.selectOption('select:first-of-type', '2021').catch(()=>{});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
      if (t.textContent.trim() === '리그') t.click();
    });
  });
  await page.waitForTimeout(2000);
  const opts = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('select').forEach(s => {
      Array.from(s.options).forEach(o => {
        try { const v = JSON.parse(o.value); if (v.lig_idx) out.push({ text: o.textContent.trim(), ...v }); } catch(e) {}
      });
    });
    const seen = new Set();
    return out.filter(o => { const k=o.lig_idx+'_'+o.group+'_'+o.part; if(seen.has(k)) return false; seen.add(k); return true; });
  });
  console.log(JSON.stringify(opts, null, 2));

  await browser.close();
})();
