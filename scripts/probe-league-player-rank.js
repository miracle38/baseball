/**
 * gameone.kr 리그 전체 선수 랭킹 URL 패턴 찾기
 * 타자/투수 명단을 리그 단위로 조회할 수 있는 경로 탐색
 */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });
  const page = await browser.newPage();

  // 1. 리그 메인 페이지에서 탭/링크 탐색
  console.log('=== 1. league home lig_idx=113 (대전야구소프트볼협회) ===');
  await page.goto('https://www.gameone.kr/league/?lig_idx=113', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const links = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a'))
      .map(a => ({ text: a.textContent.trim(), href: a.href }))
      .filter(x => x.text && x.href && /rank|record|선수|랭킹|타자|투수/i.test(x.text + x.href))
      .slice(0, 40);
  });
  console.log(JSON.stringify(links, null, 2));

  // 2. 팀랭킹 페이지 iframe 구조 확인
  console.log('\n=== 2. team rank iframe page ===');
  await page.goto('https://www.gameone.kr/league/record/rank?lig_idx=113', { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  const iframes = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('iframe')).map(f => ({ name: f.name, src: f.src, id: f.id }));
  });
  console.log('iframes:', JSON.stringify(iframes, null, 2));

  // 3. 페이지 전체 tab 구조
  const tabs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('a, button, .tab, [role=tab]'))
      .map(el => ({ text: el.textContent.trim().slice(0, 30), href: el.href || '', class: el.className }))
      .filter(x => x.text && (/타자|투수|랭킹|선수|기록|수비/i.test(x.text) || /rank/i.test(x.href)))
      .slice(0, 40);
  });
  console.log('\ntabs:', JSON.stringify(tabs, null, 2));

  // 4. URL 후보 직접 테스트
  console.log('\n=== 4. URL 후보 테스트 ===');
  const candidates = [
    'https://www.gameone.kr/league/record/content/hitter?lig_idx=113&season=2016&group_code=41',
    'https://www.gameone.kr/league/record/hitter?lig_idx=113&season=2016&group_code=41',
    'https://www.gameone.kr/league/record/pitcher?lig_idx=113&season=2016&group_code=41',
    'https://www.gameone.kr/league/record/content/pitcher?lig_idx=113&season=2016&group_code=41',
    'https://www.gameone.kr/league/ranking/hitter?lig_idx=113&season=2016&group_code=41',
    'https://www.gameone.kr/league/ranking?lig_idx=113&season=2016',
    'https://www.gameone.kr/league/info/ranking/hitter?lig_idx=113&season=2016&group_code=41',
    'https://www.gameone.kr/series/ranking/hitter?lig_idx=113&season=2016',
    'https://www.gameone.kr/league/record/content/player?lig_idx=113&season=2016&group_code=41',
    'https://www.gameone.kr/league/record/content/batter?lig_idx=113&season=2016&group_code=41',
  ];
  for (const url of candidates) {
    try {
      const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(1500);
      const r = await page.evaluate(() => {
        const tbls = document.querySelectorAll('table');
        const firstTbl = tbls[0];
        const ths = firstTbl ? Array.from(firstTbl.querySelectorAll('th')).map(t => t.textContent.trim()) : [];
        const rows = firstTbl ? firstTbl.querySelectorAll('tbody tr').length : 0;
        const bodyLen = document.body.innerText.length;
        const err = /찾을 수 없|존재하지 않|404|없습니다/.test(document.body.innerText);
        return { title: document.title.slice(0, 60), bodyLen, tblCount: tbls.length, ths: ths.slice(0, 12), rows, err };
      });
      console.log(`  ${url}`);
      console.log(`    →`, JSON.stringify(r).slice(0, 300));
    } catch (e) {
      console.log(`  ${url} ERR:`, e.message.slice(0, 80));
    }
  }

  await browser.close();
})();
