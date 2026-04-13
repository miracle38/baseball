const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 1. 2020 대전 토요3부 - 해당 리그 사이트의 팀랭킹 페이지에서 조 구조 확인
  console.log('=== 1. /league/record/rank?lig_idx=113 페이지 분석 (조 드롭다운?) ===');
  await page.goto('https://www.gameone.kr/league/record/rank?lig_idx=113', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  // 모든 프레임에서 select/조 구조 수집
  for (const frame of page.frames()) {
    if (!frame.url().includes('league/record')) continue;
    console.log('\nFrame URL:', frame.url());
    try {
      const info = await frame.evaluate(() => {
        const selects = Array.from(document.querySelectorAll('select')).map(s => ({
          name: s.name || s.id || 'unnamed',
          options: Array.from(s.options).map(o => ({ text: o.textContent.trim(), value: o.value }))
        }));
        const links = Array.from(document.querySelectorAll('a')).map(a => ({
          text: a.textContent.trim().slice(0, 30),
          href: a.href
        })).filter(x => /group|part|조|부/i.test(x.text + x.href)).slice(0, 30);
        return { selects, links };
      });
      console.log('Selects:', JSON.stringify(info.selects, null, 2));
      console.log('Links:', JSON.stringify(info.links, null, 2));
    } catch(e) {}
  }

  // 2. 2020 hitter 페이지에서 대전 토요3부 선택 후 sub-groups 여부 확인
  console.log('\n=== 2. hitter 페이지 - 2020 + 리그 선택 후 모든 select ===');
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

  const allOpts = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('select').forEach((s, idx) => {
      Array.from(s.options).forEach(o => {
        out.push({ selectIdx: idx, name: s.name || s.id, text: o.textContent.trim(), value: o.value });
      });
    });
    return out.slice(0, 80);
  });
  console.log(JSON.stringify(allOpts, null, 2));

  await browser.close();
})();
