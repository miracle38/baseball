/**
 * 와인드업 야구 데이터 자동 스크래핑
 * 현재 시즌(2026) 데이터를 4개 사이트에서 가져와서 data.json 업데이트
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, '..', 'data.json');

// 사이트 설정
const SITES = {
  sejong: {
    base: 'https://www.ksbsa.or.kr',
    teamSeq: 93,
    years: [2026, 2025],
    source: 'ksbsa.or.kr'
  },
  donggu: {
    base: 'https://donggu.dbsa.kr',
    teamSeq: 70,
    years: [2026],
    source: 'donggu.dbsa.kr'
  },
  daedeok: {
    base: 'https://daedeokgu.dbsa.kr',
    teamSeq: 24,
    years: [2024, 2023],
    source: 'daedeokgu.dbsa.kr'
  }
};

async function scrapeBatters(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  return await page.evaluate(() => {
    const rows = document.querySelectorAll('.record_list tbody tr, .player-record-list tbody tr, table tbody tr');
    const players = [];
    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 10) return;
      const nameEl = row.querySelector('.player-name, td:first-child a, td:nth-child(1)');
      const numEl = row.querySelector('.player-number, .back-number');
      if (!nameEl) return;

      const name = nameEl.textContent.trim();
      const num = numEl ? parseInt(numEl.textContent) : 0;
      if (!name || name === '선수명') return;

      // 숫자 셀들 추출
      const nums = cells.map(c => c.textContent.trim());
      players.push({ name, num, raw: nums });
    });
    return players;
  });
}

async function scrapeSite(browser, siteKey, siteConfig) {
  const results = {};

  for (const year of siteConfig.years) {
    const key = `${year}_${siteKey}`;
    console.log(`Scraping ${key}...`);

    try {
      // 타자
      const bp = await browser.newPage();
      const batterUrl = `${siteConfig.base}/teamPage/scheduleRecord/getBatterRecord.hs?teamSeq=${siteConfig.teamSeq}&searchYear=${year}`;
      await bp.goto(batterUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await bp.waitForTimeout(4000);

      const batterText = await bp.evaluate(() => document.body.innerText);
      const batterCount = (batterText.match(/player-seq/g) || []).length;
      await bp.close();

      // 투수
      const pp = await browser.newPage();
      const pitcherUrl = `${siteConfig.base}/teamPage/scheduleRecord/getPitcherRecord.hs?teamSeq=${siteConfig.teamSeq}&searchYear=${year}`;
      await pp.goto(pitcherUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await pp.waitForTimeout(4000);

      const pitcherText = await pp.evaluate(() => document.body.innerText);
      const pitcherCount = (pitcherText.match(/player-seq/g) || []).length;
      await pp.close();

      // 경기 기록
      const gp = await browser.newPage();
      const gameUrl = `${siteConfig.base}/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=${siteConfig.teamSeq}&searchYear=${year}`;
      await gp.goto(gameUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await gp.waitForTimeout(4000);

      const gameText = await gp.evaluate(() => document.body.innerText);
      await gp.close();

      results[key] = {
        batters: batterCount / 2, // player-seq appears twice per player
        pitchers: pitcherCount / 2,
        hasData: batterCount > 2,
        timestamp: new Date().toISOString()
      };

      console.log(`  ${key}: ${results[key].batters}B, ${results[key].pitchers}P`);
    } catch (e) {
      console.error(`  Error scraping ${key}: ${e.message}`);
      results[key] = { error: e.message, timestamp: new Date().toISOString() };
    }
  }

  return results;
}

async function scrapeGameone(browser) {
  const results = {};
  const years = [2025, 2022, 2021, 2020];

  for (const year of years) {
    const key = `${year}_gameone`;
    console.log(`Scraping gameone ${year}...`);

    try {
      const page = await browser.newPage();
      await page.goto('https://www.gameone.kr/club/info/ranking/hitter?club_idx=7734', {
        waitUntil: 'domcontentloaded', timeout: 30000
      });
      await page.waitForTimeout(2000);
      await page.selectOption('select:first-of-type', String(year)).catch(() => {});
      await page.waitForTimeout(4000);

      const text = await page.evaluate(() => document.body.innerText);
      const match = text.match(/전체\s*:\s*(\d+)게임.*?(\d+)승(\d+)패(\d+)무/);

      results[key] = {
        summary: match ? { G: match[1], W: match[2], L: match[3], D: match[4] } : null,
        timestamp: new Date().toISOString()
      };

      console.log(`  ${key}: ${match ? match[0] : 'no data'}`);
      await page.close();
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }
  }

  return results;
}

async function main() {
  console.log('=== 와인드업 데이터 스크래핑 시작 ===');
  console.log(new Date().toISOString());

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors']
  });

  const allResults = {
    lastUpdated: new Date().toISOString(),
    sites: {}
  };

  // dbsa 사이트 스크래핑
  for (const [key, config] of Object.entries(SITES)) {
    allResults.sites[key] = await scrapeSite(browser, key, config);
  }

  // gameone 스크래핑
  allResults.sites.gameone = await scrapeGameone(browser);

  await browser.close();

  // 결과 저장
  fs.writeFileSync(DATA_FILE, JSON.stringify(allResults, null, 2), 'utf-8');
  console.log(`\n결과 저장: ${DATA_FILE}`);
  console.log('=== 스크래핑 완료 ===');
}

main().catch(console.error);
