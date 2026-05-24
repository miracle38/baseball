/**
 * 모바일 뷰포트로 배포된 사이트를 열고 경기 기록 탭의 HR 뱃지 표시 확인.
 * 스크린샷을 scrape_debug/ 에 저장.
 */
const { chromium, devices } = require('playwright');
const path = require('path');
const fs = require('fs');

const OUT_DIR = path.join(__dirname, '..', 'scrape_debug', 'screenshots');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  // iPhone 14 Pro viewport (실제 모바일 환경 시뮬레이션)
  const iPhone = devices['iPhone 14 Pro'] || { viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };
  const ctx = await browser.newContext({ ...iPhone, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // 캐시 회피 위해 ts 쿼리
  const url = `https://miracle38.github.io/baseball/?_t=${Date.now()}`;
  console.log('GET ' + url);
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(2000);

  // 게임 기록 탭으로 이동
  console.log('Switch to game records tab');
  await page.evaluate(() => {
    const tab = document.querySelector('.nav-tab[data-tab="games"]');
    if (tab) tab.click();
  });
  await page.waitForTimeout(1500);

  // HR 뱃지가 보이는 위치까지 스크롤
  const hasHrBadge = await page.evaluate(() => {
    const badges = document.querySelectorAll('.hr-badge');
    if (badges.length === 0) return { found: false, count: 0 };
    // 첫번째 뱃지 행이 보이도록 스크롤
    badges[0].scrollIntoView({ block: 'center', behavior: 'instant' });
    return { found: true, count: badges.length };
  });
  await page.waitForTimeout(800);

  console.log('HR 뱃지 개수:', hasHrBadge.count);

  // 전체 화면 스크린샷
  const full = path.join(OUT_DIR, 'mobile-games-hr-full.png');
  await page.screenshot({ path: full, fullPage: false });
  console.log('Saved:', full);

  // HR 뱃지 클로즈업 (실제 px 위치 + 주변 영역만)
  if (hasHrBadge.found) {
    const closeup = path.join(OUT_DIR, 'mobile-games-hr-closeup.png');
    const badgeBox = await page.evaluate(() => {
      const b = document.querySelector('.hr-badge');
      if (!b) return null;
      const r = b.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    });
    if (badgeBox) {
      // 뱃지 주변 240x80 영역
      const cx = Math.max(0, badgeBox.x - 80);
      const cy = Math.max(0, badgeBox.y - 30);
      const cw = Math.min(393 - cx, 280);
      const ch = Math.min(852 - cy, 80);
      await page.screenshot({ path: closeup, clip: { x: cx, y: cy, width: cw, height: ch } });
      console.log('Closeup saved:', closeup);
      console.log('Badge box:', badgeBox);
    }
  }

  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
