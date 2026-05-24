/**
 * gameone.kr 의 club ranking 페이지에서 연도별 리그 드롭다운 옵션을 덤프.
 * 사용:  node scripts/inspect-gameone-league-options.js 2025
 */
const { chromium } = require('playwright');

const CLUB_IDX = 7734;

async function getLeagueOptionsForYear(browser, year) {
  const page = await browser.newPage();

  // navigation 추적
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) console.log(`  [nav] → ${frame.url()}`);
  });
  page.on('close', () => console.log(`  [page closed]`));

  try {
    const url = `https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}&season=${year}`;
    console.log(`  GET ${url}`);
    await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);

    // 현재 select 상태
    const initial = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      return Array.from(selects).map((s, idx) => ({
        idx,
        name: s.name,
        id: s.id,
        optCount: s.options.length,
        opts: Array.from(s.options).map(o => ({ value: o.value, text: o.textContent.trim() }))
      }));
    });
    console.log(`  초기 select 수: ${initial.length}`);
    initial.forEach(s => {
      console.log(`    [${s.idx}] name="${s.name}" 옵션=${s.optCount}`);
      s.opts.slice(0, 8).forEach(o => console.log(`        ${o.value.substring(0,60)} | ${o.text}`));
      if (s.opts.length > 8) console.log(`        ... +${s.opts.length - 8}`);
    });

    // 리그 탭 시도
    console.log(`  리그 탭 클릭 시도...`);
    const tabClicked = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.game_tab li a, [class*=tab] li a');
      const found = [];
      tabs.forEach(t => found.push(t.textContent.trim()));
      const ligTab = Array.from(tabs).find(t => t.textContent.trim() === '리그');
      if (ligTab) { ligTab.click(); return { tabs: found, clicked: true }; }
      return { tabs: found, clicked: false };
    });
    console.log(`  탭들: ${tabClicked.tabs.join(', ')} (클릭=${tabClicked.clicked})`);
    await page.waitForTimeout(3000);

    // 클릭 후 select 상태
    const after = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      return Array.from(selects).map((s, idx) => ({
        idx,
        name: s.name,
        id: s.id,
        optCount: s.options.length,
        opts: Array.from(s.options).map(o => ({ value: o.value, text: o.textContent.trim() }))
      }));
    });
    console.log(`  클릭 후 select 수: ${after.length}`);
    after.forEach(s => {
      if (s.optCount > 1) {
        console.log(`    [${s.idx}] name="${s.name}" 옵션=${s.optCount}`);
        s.opts.slice(0, 30).forEach(o => console.log(`        ${o.value.substring(0,100)} | ${o.text}`));
      }
    });
  } catch (e) {
    console.log(`  EXCEPTION: ${e.message}`);
  } finally {
    try { await page.close(); } catch (e) {}
  }
}

async function main() {
  const years = process.argv.slice(2);
  if (years.length === 0) {
    console.error('사용: node scripts/inspect-gameone-league-options.js <연도1> [연도2] ...');
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors', '--no-sandbox'] });
  try {
    for (const y of years) {
      console.log(`\n=== ${y} ===`);
      await getLeagueOptionsForYear(browser, y);
    }
  } finally {
    await browser.close();
  }
}

main().catch(err => { console.error(err); process.exit(1); });
