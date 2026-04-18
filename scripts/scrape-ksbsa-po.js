const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  const OUT = path.join(__dirname, '..', 'tmp_games');

  for (const [seq, name] of [['152', 'PO'], ['11', 'INTER']]) {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    await page.evaluate(({ sv }) => {
      document.querySelector('select[name="searchLeagueSeq"]').value = sv;
      const rs = document.querySelector('select[name="rowSize"]'); if (rs) rs.value = '300';
      const sd = document.querySelector('input[name="searchStartGameDate"]'); if (sd) sd.value = '2023-01-01';
      const ed = document.querySelector('input[name="searchEndGameDate"]'); if (ed) ed.value = '2023-12-31';
    }, { sv: seq });
    await page.evaluate(() => {
      for (const b of document.querySelectorAll('button, a.btn, a')) {
        if (/^검색$/.test(b.textContent.trim())) { b.click(); return; }
      }
      document.querySelector('select[name="searchLeagueSeq"]').form?.submit();
    });
    await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);
    const rows = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let target = null;
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
        if (/경기일시/.test(ths.join('|')) && /장소/.test(ths.join('|'))) { target = t; break; }
      }
      if (!target) return [];
      const rs = Array.from((target.querySelector('tbody') || target).querySelectorAll('tr'));
      return rs.map(tr => Array.from(tr.children).map(c => c.textContent.replace(/\s+/g,' ').trim()).concat([
        tr.querySelector('a[href*="gameScheduleSeq"]')?.href || ''
      ]));
    });
    console.log(`\n=== leagueSeq=${seq} (${name}): ${rows.length} rows ===`);
    rows.forEach(r => console.log('  ' + r.join(' | ')));
  }
  await browser.close();
})();
