const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // hitter 페이지 2016 + 리그 선택 후 나타나는 링크/URL 조사
  await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);
  await page.selectOption('select:first-of-type', '2016').catch(() => {});
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
      if (t.textContent.trim() === '리그') t.click();
    });
  });
  await page.waitForTimeout(2000);

  // 리그 선택
  await page.evaluate(() => {
    document.querySelectorAll('select').forEach(s => {
      Array.from(s.options).forEach(o => {
        if (o.value && o.value.includes('"lig_idx":"113"')) {
          s.value = o.value;
          s.dispatchEvent(new Event('change'));
        }
      });
    });
  });
  await page.waitForTimeout(3000);

  const links = await page.evaluate(() => {
    const a = Array.from(document.querySelectorAll('a'));
    return a.map(x => ({ text: x.textContent.trim().slice(0, 30), href: x.href }))
            .filter(x => /lig_idx|league|rank|series|순위|팀|game/i.test(x.href + x.text))
            .slice(0, 50);
  });
  console.log('Links after league select:', JSON.stringify(links, null, 2));

  console.log('\n=== 리그 탭 클릭한 club 페이지 URL ===');
  console.log(page.url());

  // 네트워크 요청 감시
  console.log('\n=== 네트워크 요청 시 URL 패턴 ===');
  const reqs = [];
  page.on('request', r => {
    if (/rank|lig_idx|series|league/i.test(r.url())) reqs.push(r.url());
  });
  // reload to capture
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  await page.selectOption('select:first-of-type', '2016').catch(() => {});
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
      if (t.textContent.trim() === '리그') t.click();
    });
  });
  await page.waitForTimeout(2000);
  await page.evaluate(() => {
    document.querySelectorAll('select').forEach(s => {
      Array.from(s.options).forEach(o => {
        if (o.value && o.value.includes('"lig_idx":"113"')) {
          s.value = o.value;
          s.dispatchEvent(new Event('change'));
        }
      });
    });
  });
  await page.waitForTimeout(3000);
  console.log('Captured requests:', reqs.slice(0, 30));

  await browser.close();
})();
