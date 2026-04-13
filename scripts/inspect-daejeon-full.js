const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 2020년 대전 리그 전체 옵션 - hitter 선택 시 나오는 모든 group/part 확인
  console.log('=== 2020년 lig_idx=113의 모든 group/part 조합 ===');
  await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.selectOption('select:first-of-type', '2020').catch(()=>{});
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
        try {
          const v = JSON.parse(o.value);
          if (v.lig_idx) out.push({ text: o.textContent.trim(), ...v });
        } catch(e) {}
      });
    });
    const seen = new Set();
    return out.filter(o => { const k=o.lig_idx+'_'+o.group+'_'+o.part; if (seen.has(k)) return false; seen.add(k); return true; });
  });
  console.log(JSON.stringify(opts, null, 2));

  // 2020 대전 토요3부 페이지 본인 홈피 시즌 summary 확인
  console.log('\n=== club 홈피 2020 대전 토요3부 와인드업 기록 ===');
  await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2500);
  await page.selectOption('select:first-of-type', '2020').catch(()=>{});
  await page.waitForTimeout(2500);
  await page.evaluate(() => {
    document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
      if (t.textContent.trim() === '리그') t.click();
    });
  });
  await page.waitForTimeout(1500);
  await page.evaluate(() => {
    document.querySelectorAll('select').forEach(s => {
      Array.from(s.options).forEach(o => {
        if (o.value && o.value.includes('"lig_idx":"113"')) { s.value = o.value; s.dispatchEvent(new Event('change')); }
      });
    });
  });
  await page.waitForTimeout(3500);
  const bodyText = await page.evaluate(() => document.body.innerText);
  const m = bodyText.match(/(\d+)게임\s*승률\s*:\s*([\d.]+)%\s*\(\s*(\d+)승(\d+)패(\d+)무/);
  console.log('시즌 기록:', m ? m[0] : 'no match');

  // 경기 일정·결과 페이지에서 2020 대전 토요3부 경기들 확인
  console.log('\n=== 일정·결과 페이지 2020 ===');
  await page.goto('https://www.gameone.kr/club/info/schedule/table?club_idx=7734&season=2020', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const games = await page.evaluate(() => {
    const rows = [];
    document.querySelectorAll('table tbody tr').forEach(tr => {
      const c = Array.from(tr.querySelectorAll('td')).map(x => x.textContent.trim().replace(/\s+/g, ' '));
      if (c.length >= 3) rows.push(c.slice(0, 8).join(' | '));
    });
    return rows.slice(0, 40);
  });
  console.log(games.join('\n'));

  // 2020 토요3부 모든 group_code (토요3부=58 이외 값도 테스트)
  console.log('\n=== 2020 토요3부 대전 - 여러 group_code 빠르게 확인 ===');
  const gcsToTest = [58, 41, 42, 43, 44, 58, 113, 63];
  for (const gc of gcsToTest) {
    const url = `https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=${gc}&season=2020`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 10000 });
    await page.waitForTimeout(1000);
    const r = await page.evaluate(() => {
      const rows = [];
      document.querySelectorAll('table tbody tr').forEach(tr => {
        const c = Array.from(tr.querySelectorAll('td')).map(x => x.textContent.trim());
        if (c.length >= 5 && parseInt(c[0])) rows.push(c[1]);
      });
      return { rows, hasWindup: rows.includes('와인드업') };
    });
    console.log(`gc=${gc}: ${r.rows.length}팀 와인드업:${r.hasWindup?'YES':'no'} - ${r.rows.slice(0,3).join(', ')}`);
  }

  await browser.close();
})();
