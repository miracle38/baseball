/**
 * POST 방식으로 연도별 전체 경기 조회 시도.
 * 먼저 실제 페이지 방문 후 년도 선택 form 있는지 탐색.
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // dbsa 2023 접근
  const url = 'https://daedeokgu.dbsa.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=24';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const info = await page.evaluate(() => {
    const links = Array.from(document.querySelectorAll('a')).map(a => ({
      text: a.textContent.trim().slice(0, 60),
      href: a.href.slice(0, 200)
    })).filter(l => l.href && !/#$/.test(l.href));
    const forms = Array.from(document.querySelectorAll('form')).map(f => ({
      action: f.action,
      method: f.method,
      inputs: Array.from(f.querySelectorAll('input,select')).map(i => ({
        name: i.name, type: i.type, value: i.value
      }))
    }));
    const tabs = Array.from(document.querySelectorAll('.tab, .nav, .menu, ul')).slice(0, 10).map(el => el.textContent.replace(/\s+/g,' ').trim().slice(0, 300));
    return { links: links.slice(0, 40), forms, tabs, title: document.title };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
