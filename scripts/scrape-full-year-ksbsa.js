/**
 * ksbsa 2023 전체 경기 조회
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'tmp_games');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93';
  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);

  await page.evaluate(() => {
    const sel = document.querySelector('select[name="searchLeagueSeq"]');
    if (sel) sel.value = '';
    const rs = document.querySelector('select[name="rowSize"]');
    if (rs) rs.value = '300';
    const sd = document.querySelector('input[name="searchStartGameDate"]');
    if (sd) sd.value = '2023-01-01';
    const ed = document.querySelector('input[name="searchEndGameDate"]');
    if (ed) ed.value = '2023-12-31';
  });

  // Click search
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button, a.btn, a'));
    for (const b of btns) {
      const t = b.textContent.trim();
      if (/^검색$/.test(t)) { b.click(); return; }
    }
    const sel = document.querySelector('select[name="searchLeagueSeq"]');
    if (sel?.form) sel.form.submit();
  });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(2500);

  const info = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    let target = null;
    for (const t of tables) {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim());
      if (/경기일시/.test(ths.join('|')) && /장소/.test(ths.join('|'))) { target = t; break; }
    }
    if (!target) return { found: false };
    const rows = Array.from((target.querySelector('tbody') || target).querySelectorAll('tr'));
    return {
      found: true,
      games: rows.map(tr => {
        const cells = Array.from(tr.children).map(c => c.textContent.replace(/\s+/g,' ').trim());
        const a = tr.querySelector('a[href*="gameScheduleSeq"]');
        return {
          cells,
          gameScheduleSeq: a ? (a.href.match(/gameScheduleSeq=(\d+)/) || [])[1] : null,
          leagueCategory: a ? (a.href.match(/leagueCategory=([A-Z_]+)/) || [])[1] : null
        };
      })
    };
  });

  fs.writeFileSync(path.join(OUT_DIR, 'raw_ksbsa_2023_all.json'), JSON.stringify(info, null, 2), 'utf-8');
  console.log(`total rows: ${info.games?.length || 0}`);
  if (info.games) {
    for (const g of info.games) {
      console.log(`  ${g.cells[0]} | ${g.cells[1]} | ${g.cells[2]} | ${g.cells[3]} | seq=${g.gameScheduleSeq} lc=${g.leagueCategory}`);
    }
  }
  await browser.close();
})();
