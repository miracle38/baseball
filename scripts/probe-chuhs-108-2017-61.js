const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  const page = await browser.newPage();
  const url = `https://www.gameone.kr/league/record/content/batter?lig_idx=108&season=2017&group_code=61`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);
  const data = await page.evaluate(() => {
    const tables = Array.from(document.querySelectorAll('table'));
    // Find biggest table
    let best = null;
    let bestCnt = 0;
    tables.forEach(tbl => {
      const ths = tbl.querySelector('thead') ? Array.from(tbl.querySelector('thead').querySelectorAll('th')).map(t=>t.textContent.trim()) : [];
      if (ths.length > bestCnt) { bestCnt = ths.length; best = { tbl, ths }; }
    });
    if (!best) return null;
    const rows = Array.from(best.tbl.tBodies[0].querySelectorAll('tr'));
    const teamIdx = best.ths.indexOf('팀명');
    const nameIdx = best.ths.indexOf('이름');
    const result = rows.map(tr => {
      const cells = Array.from(tr.children).map(c => c.textContent.trim());
      return { name: cells[nameIdx], team: cells[teamIdx] };
    });
    return { count: rows.length, chuhs: result.filter(r => r.name && r.name.includes('추혜승')), windup: result.filter(r => r.team && r.team.replace(/\s+/g,'').includes('와인드업')), headers: best.ths };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})();
