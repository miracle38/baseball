const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 1. club 홈에서 팀명 확인
  console.log('=== 1. club 정보 ===');
  await page.goto('https://www.gameone.kr/club/info/intro?club_idx=7734', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const info = await page.evaluate(() => ({
    title: document.title,
    teamName: document.querySelector('h1, h2, .team-name, .club-name')?.textContent?.trim(),
    body: document.body.innerText.slice(0, 1500)
  }));
  console.log('Title:', info.title);
  console.log('TeamName:', info.teamName);
  console.log('Body:', info.body);

  // 2. 2016 hitter 페이지 - 리그 옵션 및 승률
  console.log('\n=== 2. 2016 hitter 페이지 ===');
  await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734&season=2016', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  const batText = await page.evaluate(() => document.body.innerText);
  const sMatch = batText.match(/(\d+)게임\s*승률\s*:\s*([\d.]+)%\s*\(\s*(\d+)승(\d+)패(\d+)무/);
  console.log('전체 summary:', sMatch ? sMatch[0] : 'no match');

  // 리그 탭 클릭
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
          const val = JSON.parse(o.value);
          if (val.lig_idx) out.push({ text: o.textContent.trim(), lig_idx: val.lig_idx, group: val.group, part: val.part });
        } catch(e) {}
      });
    });
    const seen = new Set();
    return out.filter(o => { const k = o.lig_idx+'_'+o.group+'_'+o.part; if (seen.has(k)) return false; seen.add(k); return true; });
  });
  console.log('2016 리그 옵션:', JSON.stringify(opts, null, 2));

  // 각 리그별 승률 확인
  for (const opt of opts) {
    await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.selectOption('select:first-of-type', '2016').catch(()=>{});
    await page.waitForTimeout(2000);
    await page.evaluate(() => {
      document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
        if (t.textContent.trim() === '리그') t.click();
      });
    });
    await page.waitForTimeout(1500);
    await page.evaluate((val) => {
      document.querySelectorAll('select').forEach(s => {
        Array.from(s.options).forEach(o => {
          const json = (()=>{try{return JSON.parse(o.value)}catch{return null}})();
          if (json && json.lig_idx === val.lig_idx && json.group === val.group && json.part === val.part) {
            s.value = o.value; s.dispatchEvent(new Event('change'));
          }
        });
      });
    }, opt);
    await page.waitForTimeout(3000);
    const t = await page.evaluate(() => document.body.innerText);
    const m = t.match(/(\d+)게임\s*승률\s*:\s*([\d.]+)%\s*\(\s*(\d+)승(\d+)패(\d+)무/);
    console.log(`  [${opt.text}] (lig_idx=${opt.lig_idx}, group=${opt.group}, part=${opt.part}):`, m ? m[0] : 'no data');
  }

  // 3. 공식 팀명이 뭔지 - 팀검색
  console.log('\n=== 3. 팀 검색으로 와인드업 확인 ===');
  await page.goto('https://www.gameone.kr/search/team?keyword=%EC%99%80%EC%9D%B8%EB%93%9C%EC%97%85', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);
  const searchResult = await page.evaluate(() => {
    const items = [];
    document.querySelectorAll('a').forEach(a => {
      const href = a.href;
      const text = a.textContent.trim();
      if (/club_idx=\d+/.test(href) && text.length > 0 && text.length < 50) {
        items.push({ text, href });
      }
    });
    return items.slice(0, 20);
  });
  console.log('검색결과:', JSON.stringify(searchResult, null, 2));

  await browser.close();
})();
