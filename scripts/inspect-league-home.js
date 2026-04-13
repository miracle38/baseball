const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 1. 대전광역시 야구소프트볼협회 리그 홈 (lig_idx=113) - 팀랭킹 iframe 구조
  console.log('=== /league/record/rank?lig_idx=113 - 연도별 group/part 옵션 ===');
  await page.goto('https://www.gameone.kr/league/record/rank?lig_idx=113', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 연도별로 group_code + part_code 조합 확인
  for (const year of ['2016', '2017', '2018', '2019', '2020', '2021', '2022', '2023', '2024', '2025', '2026']) {
    // iframe 내부로 들어가서 season select 변경
    const frames = page.frames();
    let rankFrame = frames.find(f => f.url().includes('league/record/content/rank'));
    if (!rankFrame) continue;

    // iframe의 season 변경 → 페이지 reload
    const baseUrl = `https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=0&season=${year}`;
    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(1500);

    const info = await page.evaluate(() => {
      const selects = Array.from(document.querySelectorAll('select')).map(s => ({
        name: s.name,
        options: Array.from(s.options).map(o => ({ text: o.textContent.trim(), value: o.value }))
      }));
      return selects;
    });
    console.log(`\n--- ${year} ---`);
    info.forEach(s => {
      if (s.name === 'group_code' || s.name === 'part_code') {
        console.log(`  ${s.name}: ${s.options.map(o => `${o.text}(${o.value})`).join(' | ')}`);
      }
    });
  }

  // 2. 각 group별로 part_code 찾기 - group_code 설정 후 part_code 로딩 여부 확인
  console.log('\n=== 2020 각 group에서 part_code 변화 ===');
  for (const gc of ['58', '59', '60', '61', '62']) {
    await page.goto(`https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=${gc}&season=2020`, { waitUntil: 'networkidle', timeout: 15000 });
    await page.waitForTimeout(2000);
    const parts = await page.evaluate(() => {
      const s = Array.from(document.querySelectorAll('select')).find(x => x.name === 'part_code');
      return s ? Array.from(s.options).map(o => ({ text: o.textContent.trim(), value: o.value })) : [];
    });
    console.log(`  group_code=${gc} part options: ${parts.map(p => p.text+'='+p.value).join(' | ')}`);
  }

  // 3. 2016 대전 토요금강 lig_idx=113 group=41 - 이때 group_code=41 이 유효했던건가? 아니면 이동 전 기록?
  console.log('\n=== 2016 모든 group_code 시도 (유효한 group만 표시) ===');
  for (let gc = 0; gc <= 90; gc++) {
    await page.goto(`https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=${gc}&season=2016`, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const c = Array.from(tr.querySelectorAll('td')).map(x => x.textContent.trim());
        if (c.length >= 5 && parseInt(c[0])) rows.push(c[1]);
      });
      const gs = Array.from(document.querySelectorAll('select')).find(x => x.name === 'group_code');
      const selected = gs ? Array.from(gs.options).find(o => o.selected)?.textContent.trim() : '';
      return { rows, selected };
    });
    if (r.rows.length > 0) {
      console.log(`  gc=${gc} [${r.selected}]: ${r.rows.length}팀 (와인드업 ${r.rows.includes('와인드업')?'YES':'no'}) - ${r.rows.slice(0,2).join(', ')}...`);
    }
  }

  await browser.close();
})();
