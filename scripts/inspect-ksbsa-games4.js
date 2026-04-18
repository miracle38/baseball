const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 네트워크 요청 캡처
  const requests = [];
  page.on('request', req => {
    if (req.url().includes('ksbsa.or.kr') && !req.url().includes('.css') && !req.url().includes('.js') && !req.url().includes('.png') && !req.url().includes('.jpg')) {
      requests.push({ method: req.method(), url: req.url(), postData: req.postData() });
    }
  });

  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchYear=2025';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('=== 초기 로드 요청 ===');
  requests.forEach(r => console.log(`  ${r.method} ${r.url} ${r.postData ? 'POST:'+r.postData.slice(0,200) : ''}`));

  // "더보기" 클릭 - JavaScript 실행으로 처리
  const moreInfo = await page.evaluate(() => {
    // "더보기" 링크의 onclick 핸들러 확인
    const links = Array.from(document.querySelectorAll('a'));
    const moreLinks = links.filter(a => /더보기/.test(a.textContent));
    return moreLinks.map(a => ({
      text: a.textContent.trim(),
      href: a.href,
      onclick: a.getAttribute('onclick'),
      parentTag: a.parentElement?.tagName,
      parentClass: a.parentElement?.className,
      grandparentClass: a.parentElement?.parentElement?.className
    }));
  });
  console.log('\n=== 더보기 링크 분석 ===');
  console.log(JSON.stringify(moreInfo, null, 2));

  // 첫 번째 더보기 클릭 시도 (JavaScript evaluate)
  if (moreInfo.length > 0 && moreInfo[0].onclick) {
    console.log('\n=== 더보기 클릭 시도 ===');
    requests.length = 0;
    await page.evaluate((onclick) => {
      eval(onclick);
    }, moreInfo[0].onclick);
    await page.waitForTimeout(3000);
    console.log('추가 요청:');
    requests.forEach(r => console.log(`  ${r.method} ${r.url} ${r.postData ? 'POST:'+r.postData.slice(0,200) : ''}`));
  }

  // 더보기 클릭 후 새로 나타난 테이블/영역 확인
  const afterClick = await page.evaluate(() => {
    const trs = Array.from(document.querySelectorAll('table tr'));
    // 행이 많은 테이블 찾기
    const tables = Array.from(document.querySelectorAll('table'));
    return tables.map((t, idx) => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      const trs = Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td'));
      return {
        idx,
        ths: ths.slice(0, 15),
        rowCount: trs.length,
        sample: trs.slice(0, 3).map(r =>
          Array.from(r.children).map(c => c.textContent.trim().replace(/\s+/g,' ').slice(0,60))
        )
      };
    });
  });
  console.log('\n=== 클릭 후 테이블 ===');
  console.log(JSON.stringify(afterClick, null, 2));

  await browser.close();
})();
