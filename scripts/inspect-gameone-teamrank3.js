const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // /league/record/rank 에서 년도 select로 변경
  await page.goto('https://www.gameone.kr/league/record/rank?lig_idx=113', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(5000);

  // 페이지 전체 HTML 구조 출력
  const htmlSample = await page.content();
  require('fs').writeFileSync('D:/00. Claude/02. baseball/scrape_debug/league_rank_page.html', htmlSample);
  console.log('HTML saved, length:', htmlSample.length);

  // iframe 있는지 체크
  const frames = page.frames();
  console.log('Frames:', frames.length);
  for (const f of frames) console.log('  frame URL:', f.url());


  // 첫 번째 year select 변경
  await page.evaluate(() => {
    const selects = document.querySelectorAll('select');
    selects.forEach(s => {
      if (Array.from(s.options).some(o => o.value === '2016')) {
        s.value = '2016';
        s.dispatchEvent(new Event('change', { bubbles: true }));
      }
    });
  });
  await page.waitForTimeout(4000);

  const info = await page.evaluate(() => {
    return {
      url: location.href,
      bodyLen: document.body.innerText.length,
      bodyAround: document.body.innerText.slice(1000, 3500),
      tableCount: document.querySelectorAll('table').length,
      tables: Array.from(document.querySelectorAll('table')).slice(0, 3).map((t, i) => ({
        idx: i,
        ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()),
        rowCount: t.querySelectorAll('tbody tr').length,
        sample: Array.from(t.querySelectorAll('tbody tr')).slice(0, 5).map(r =>
          Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim()))
      }))
    };
  });
  console.log('URL:', info.url);
  console.log('BodyLen:', info.bodyLen);
  console.log('Body around position 1000:', info.bodyAround);
  console.log('Tables:', JSON.stringify(info.tables, null, 2));

  await browser.close();
})();
