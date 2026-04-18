/**
 * 각 사이트 팀별 연도별 전체 경기 목록을 getScheduleRecord.hs 로 조회
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');

const TARGETS = [
  { name: 'ksbsa93-2023', url: 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getScheduleRecord.hs?teamSeq=93&searchYear=2023' },
  { name: 'dbsa24-2023',  url: 'https://daedeokgu.dbsa.kr/teamPage/scheduleRecord/getScheduleRecord.hs?teamSeq=24&searchYear=2023' },
  { name: 'dbsa24-2024',  url: 'https://daedeokgu.dbsa.kr/teamPage/scheduleRecord/getScheduleRecord.hs?teamSeq=24&searchYear=2024' },
];

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  for (const t of TARGETS) {
    console.log(`\n===== ${t.name} : ${t.url} =====`);
    try {
      await page.goto(t.url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);
      const info = await page.evaluate(() => {
        const tables = Array.from(document.querySelectorAll('table'));
        const out = [];
        tables.forEach((t, idx) => {
          const rows = Array.from(t.querySelectorAll('tr'));
          out.push({
            idx,
            rowCount: rows.length,
            firstRows: rows.slice(0, 5).map(tr => Array.from(tr.children).map(c => c.textContent.trim().replace(/\s+/g,' ').slice(0,80)))
          });
        });
        // 추출: 경기 목록 (.game-list 등)
        const gameItems = [];
        document.querySelectorAll('.game-list li, .match-list, .schedule-list li, tr').forEach(el => {
          const txt = el.textContent.replace(/\s+/g,' ').trim();
          if (/\d{4}[-.]\d{2}[-.]\d{2}|\d{4}년\s*\d{1,2}월\s*\d{1,2}일/.test(txt) && /와인드업/.test(txt)) {
            const link = el.querySelector('a[href*="gameScheduleSeq"]');
            gameItems.push({
              text: txt.slice(0, 250),
              href: link ? link.href.slice(0, 200) : null
            });
          }
        });
        return { tables: out, gameItems: gameItems.slice(0, 60), bodyLen: document.body.textContent.length };
      });
      console.log(JSON.stringify(info, null, 2).slice(0, 8000));
    } catch (e) {
      console.log('  err:', e.message);
    }
  }

  await browser.close();
})();
