const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // getMain에서 경기 결과 구조 조사
  await page.goto('https://www.ksbsa.or.kr/teamPage/main/getMain.hs?teamSeq=93', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const info = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const result = [];
    tables.forEach((t, idx) => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().replace(/\s+/g, ' '));
      const rows = Array.from(t.querySelectorAll('tbody tr'));
      const sampleRows = rows.slice(0, 3).map(r => Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim().replace(/\s+/g, ' ')));
      result.push({ idx, ths, rowCount: rows.length, sampleRows });
    });
    return result;
  });

  console.log(JSON.stringify(info, null, 2));

  // 경기일정/결과 별도 URL 체크
  console.log('\n===== getGameRecord =====');
  await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchYear=2026', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);
  const info2 = await page.evaluate(() => {
    const tables = document.querySelectorAll('table');
    const result = [];
    tables.forEach((t, idx) => {
      const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().replace(/\s+/g, ' '));
      const rows = Array.from(t.querySelectorAll('tbody tr'));
      const sampleRows = rows.slice(0, 3).map(r => Array.from(r.querySelectorAll('td')).map(td => td.textContent.trim().replace(/\s+/g, ' ')));
      result.push({ idx, ths, rowCount: rows.length, sampleRows });
    });
    return result;
  });
  console.log(JSON.stringify(info2, null, 2));

  await browser.close();
})();
