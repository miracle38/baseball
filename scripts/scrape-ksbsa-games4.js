/**
 * ksbsa.or.kr API 탐색 - 네트워크 인터셉트로 AJAX 엔드포인트 찾기
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 모든 XHR/fetch 요청 캡처
  const xhrRequests = [];
  page.on('request', req => {
    const type = req.resourceType();
    if (['xhr', 'fetch', 'document'].includes(type)) {
      const url = req.url();
      if (url.includes('ksbsa.or.kr') && !url.includes('google')) {
        xhrRequests.push({
          method: req.method(),
          url: url,
          type: type,
          postData: req.postData()
        });
      }
    }
  });

  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchYear=2025';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3000);

  console.log('=== 초기 로드 XHR 요청 ===');
  xhrRequests.forEach(r => console.log(`  ${r.type} ${r.method} ${r.url} ${r.postData ? 'POST:'+r.postData : ''}`));

  // JS 소스에서 경기 목록 API 관련 코드 찾기
  const jsCode = await page.evaluate(() => {
    // 인라인 스크립트 수집
    const scripts = Array.from(document.querySelectorAll('script:not([src])'));
    return scripts.map(s => s.textContent).join('\n');
  });

  // gameSchedule, gameRecord, getGame 등 관련 함수/URL 찾기
  const relevantLines = jsCode.split('\n').filter(line =>
    /gameSchedule|gameRecord|getGame|scheduleSeq|leagueCategory|searchYear|ajax|\.hs|teamSeq/i.test(line)
  );
  console.log('\n=== 관련 JS 코드 ===');
  relevantLines.slice(0, 50).forEach(l => console.log(l.trim().slice(0, 200)));

  // "더보기" 클릭 시 호출되는 함수 찾기
  const moreRelated = jsCode.split('\n').filter(line =>
    /더보기|moreView|detail|toggle|slideDown|slideUp|expand/i.test(line)
  );
  console.log('\n=== 더보기 관련 JS 코드 ===');
  moreRelated.slice(0, 30).forEach(l => console.log(l.trim().slice(0, 200)));

  // "더보기" 클릭 시 XHR 요청 캡처
  xhrRequests.length = 0;

  // 행 6 (2025 토요4부)의 더보기 클릭
  await page.evaluate(() => {
    const table = document.querySelectorAll('table')[0];
    const rows = Array.from(table.querySelectorAll('tbody tr'));
    if (rows[6]) {
      const link = rows[6].querySelector('a');
      if (link) link.click();
    }
  });
  await page.waitForTimeout(3000);

  console.log('\n=== 더보기 클릭 후 XHR 요청 ===');
  xhrRequests.forEach(r => console.log(`  ${r.type} ${r.method} ${r.url} ${r.postData ? 'POST:'+r.postData : ''}`));

  // 경기 일정 페이지의 JS도 확인
  console.log('\n=== 경기일정 페이지 JS 확인 ===');
  await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  xhrRequests.length = 0;

  const scheduleJs = await page.evaluate(() => {
    const scripts = Array.from(document.querySelectorAll('script:not([src])'));
    return scripts.map(s => s.textContent).join('\n');
  });

  const scheduleLines = scheduleJs.split('\n').filter(line =>
    /gameSchedule|getSchedule|searchMonth|searchYear|calDate|loadSchedule|ajax|\.hs/i.test(line)
  );
  console.log(scheduleLines.slice(0, 40).map(l => l.trim().slice(0, 200)).join('\n'));

  // 날짜 클릭 시 네트워크 요청 확인
  await page.evaluate(() => {
    const cells = Array.from(document.querySelectorAll('td a.el-cal-item'));
    const withGame = cells.find(a => a.textContent.includes('+'));
    if (withGame) withGame.click();
  });
  await page.waitForTimeout(3000);

  console.log('\n=== 날짜 클릭 후 XHR 요청 ===');
  xhrRequests.forEach(r => console.log(`  ${r.type} ${r.method} ${r.url} ${r.postData ? 'POST:'+r.postData : ''}`));

  await browser.close();
})();
