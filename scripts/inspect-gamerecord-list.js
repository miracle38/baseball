/**
 * "경기 기록" 페이지에서 연도별 전체 경기 목록 시도.
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');

const targets = [
  { name:'dbsa24-gameRecord', url:'https://daedeokgu.dbsa.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=24' },
  { name:'ksbsa93-gameRecord', url:'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  for (const t of targets) {
    console.log(`\n===== ${t.name} =====`);
    await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30000 }).catch(e => console.log('err', e.message));
    await page.waitForTimeout(2000);
    const info = await page.evaluate(() => {
      const forms = Array.from(document.querySelectorAll('form')).map(f => ({
        action: f.action, method: f.method,
        inputs: Array.from(f.querySelectorAll('input,select')).map(i => ({
          name: i.name, type: i.type, value: i.value,
          options: i.tagName === 'SELECT' ? Array.from(i.querySelectorAll('option')).map(o => o.value+'='+o.textContent.trim()) : null
        }))
      }));
      const rows = Array.from(document.querySelectorAll('table tr')).slice(0, 40).map(tr =>
        Array.from(tr.children).map(c => c.textContent.trim().replace(/\s+/g,' ').slice(0, 60)).join(' | ')
      );
      const gameSeqLinks = Array.from(document.querySelectorAll('a[href*="gameScheduleSeq"]')).slice(0, 80).map(a => ({
        text: a.textContent.replace(/\s+/g,' ').trim().slice(0, 80),
        href: a.href
      }));
      return { formsCount: forms.length, forms: forms.slice(0,3), rows, gameSeqLinks };
    });
    console.log(JSON.stringify(info, null, 2).slice(0, 5000));
  }

  await browser.close();
})();
