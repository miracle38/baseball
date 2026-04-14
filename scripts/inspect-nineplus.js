const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // "대전나인플러스" 팀 검색
  console.log('=== 대전나인플러스 검색 ===');
  await page.goto('https://www.gameone.kr/search/team?keyword=%EB%8C%80%EC%A0%84%EB%82%98%EC%9D%B8%ED%94%8C%EB%9F%AC%EC%8A%A4', { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(4000);
  const result = await page.evaluate(() => {
    // 검색 결과 팀 카드 찾기
    const items = [];
    document.querySelectorAll('a[href*="club_idx"]').forEach(a => {
      const ctx = a.closest('li,div.team,div.card,tr,.search_item') || a.parentElement;
      const text = ctx ? ctx.textContent.trim().replace(/\s+/g, ' ').slice(0, 150) : a.textContent.trim();
      if (text && !items.some(x => x.href === a.href)) {
        items.push({ text, href: a.href });
      }
    });
    return items.slice(0, 20);
  });
  console.log(JSON.stringify(result, null, 2));

  // 대전 토요금강 리그의 참가팀 목록 (2016) - 기록실/팀 검색
  console.log('\n=== 2016 lig_idx=113 참가팀 전체 - 다른 URL 시도 ===');
  // 등록팀 현황 URL 패턴
  for (const url of [
    'https://www.gameone.kr/league/info/team?lig_idx=113&season=2016',
    'https://www.gameone.kr/league/reg/team?lig_idx=113&season=2016',
    'https://www.gameone.kr/league/record/content/rank?lig_idx=113&group_code=41&season=2016',
    'https://www.gameone.kr/league/record/content/rank?lig_idx=113&group=41&part=1&season=2016',
    'https://www.gameone.kr/league/record/content/rank?lig_idx=113&group=41&season=2016'
  ]) {
    try {
      await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
      await page.waitForTimeout(2000);
      const teams = await page.evaluate(() => {
        const tbls = document.querySelectorAll('table');
        return Array.from(tbls).map(t => ({
          rowCount: t.querySelectorAll('tbody tr').length,
          teams: Array.from(t.querySelectorAll('tbody tr')).map(r => {
            const cells = Array.from(r.querySelectorAll('td')).map(c => c.textContent.trim());
            return cells.slice(0, 6).join(' | ');
          }).filter(x => x && x !== '' && x.length > 2)
        }));
      });
      console.log(`\n${url}`);
      console.log(JSON.stringify(teams, null, 2));
    } catch(e) { console.log(url, 'ERR', e.message); }
  }

  await browser.close();
})();
