/**
 * ksbsa 2023 — 전체 기록 페이지 외에 다른 방법으로도 경기 시도
 *   1) 경기일정(캘린더) — 이미 시도함
 *   2) 경기기록 (leagueSeq 별로)
 *   3) 팀 메인 홈 → 최근 경기들
 *   4) 선수기록 페이지의 "경기수별" 리스트?
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  // Main page
  const mainUrl = 'https://www.ksbsa.or.kr/teamPage/main/getMain.hs?teamSeq=93';
  await page.goto(mainUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(2000);
  const info = await page.evaluate(() => {
    // Find all links with gameScheduleSeq
    const links = Array.from(document.querySelectorAll('a[href*="gameScheduleSeq"]')).map(a => ({ text: a.textContent.replace(/\s+/g,' ').trim().slice(0, 100), href: a.href }));
    // All tabs / calendar references
    const sections = Array.from(document.querySelectorAll('section, .tab-content, .board-list')).map(s => s.textContent.replace(/\s+/g,' ').trim().slice(0, 300));
    return { links, sectionsCount: sections.length };
  });
  console.log('main page links:', JSON.stringify(info.links, null, 2).slice(0, 2000));

  // Try "경기 일정" page with year filter — the calendar only shows one month
  // Try the "경기 기록" page: we already know it returns 13 rows for 2023.
  // Let's test direct GET with all params
  const testUrls = [
    'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchLeagueSeq=&searchStartGameDate=2023-01-01&searchEndGameDate=2023-12-31&rowSize=300',
    'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=93&searchStartGameDate=2023-01-01&searchEndGameDate=2023-12-31&rowSize=300',
  ];
  for (const u of testUrls) {
    await page.goto(u, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(1500);
    const c = await page.evaluate(() => {
      const tables = Array.from(document.querySelectorAll('table'));
      let target = null;
      for (const t of tables) {
        const ths = Array.from(t.querySelectorAll('th')).map(x => x.textContent.trim()).join('|');
        if (/경기일시/.test(ths) && /장소/.test(ths)) { target = t; break; }
      }
      if (!target) return { ok: false, tablesCount: tables.length };
      const rows = Array.from(target.querySelectorAll('tbody tr, tr'));
      return { ok: true, rowCount: rows.filter(tr => /\d{4}[-.]\d{2}[-.]\d{2}/.test(tr.textContent)).length };
    });
    console.log(`\n${u}\n => ${JSON.stringify(c)}`);
  }

  await browser.close();
})();
