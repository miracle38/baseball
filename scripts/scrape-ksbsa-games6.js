/**
 * ksbsa 경기 스크래퍼 (v6)
 * - 캘린더 날짜 클릭 후 HTML 분석
 * - gameScheduleSeq 추출
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

async function main() {
  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const page = await browser.newPage();

  // 캘린더 2025년 3월로 이동
  await page.goto('https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93', {
    waitUntil: 'networkidle', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(1000);

  // POST로 2025년 3월 이동
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93';
    ['thisYear|2025', 'thisMonth|03', 'thisDay|01'].forEach(pair => {
      const [name, value] = pair.split('|');
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // 3월 1일 (경기 있는 날) 클릭
  console.log('=== 3월 1일 클릭 ===');
  await page.evaluate(() => {
    const calCells = document.querySelectorAll('td a.el-cal-item');
    for (const a of calCells) {
      const dateP = a.querySelector('.date');
      const matchP = a.querySelector('.match');
      if (dateP && matchP && parseInt(dateP.textContent.trim()) === 1 && /\+/.test(matchP.textContent)) {
        a.click();
        return;
      }
    }
  });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  // 클릭 후 전체 HTML에서 경기 정보 검색
  const clickedHtml = await page.evaluate(() => {
    return {
      url: window.location.href,
      // 경기 관련 영역 모두 수집
      allLinks: Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim().slice(0, 80),
        href: a.href
      })).filter(l => /경기|gameRecord|gameSchedule|getGame|VS|와인드업/.test(l.text + l.href)),
      // 숨겨진 요소 포함 모든 경기 정보
      bodyText: document.body.innerText.slice(0, 5000),
      // 캘린더 하단 섹션
      calBottom: document.querySelector('.schedule-detail, .game-detail, .cal-detail, .match-detail, [class*="detail"], [class*="schedule-list"]')?.innerHTML?.slice(0, 2000) || 'not found',
      // selected 날짜 확인
      selectedDate: document.querySelector('.selected, .active, .on, [class*="selected"], td.on')?.textContent?.trim()?.slice(0, 100) || 'none',
      // 모든 div의 텍스트 중 VS 또는 와인드업 포함
      gameText: Array.from(document.querySelectorAll('div, p, span, li'))
        .filter(el => /VS|와인드업/.test(el.textContent))
        .map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.trim().slice(0, 150) }))
        .slice(0, 10)
    };
  });

  console.log('URL:', clickedHtml.url);
  console.log('\n경기 관련 링크:');
  clickedHtml.allLinks.forEach(l => console.log(`  ${l.text} → ${l.href}`));
  console.log('\nVS/와인드업 포함 요소:');
  clickedHtml.gameText.forEach(g => console.log(`  [${g.tag}.${g.class}] ${g.text}`));
  console.log('\nselected 날짜:', clickedHtml.selectedDate);
  console.log('\n하단 상세:', clickedHtml.calBottom?.slice(0, 500));

  // 이번엔 2026년 4월로 가서 비교 (2026에는 경기 표시가 잘 됨)
  console.log('\n\n=== 2026년 3월 비교 ===');
  await page.evaluate(() => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93';
    ['thisYear|2026', 'thisMonth|03', 'thisDay|14'].forEach(pair => {
      const [name, value] = pair.split('|');
      const input = document.createElement('input');
      input.type = 'hidden'; input.name = name; input.value = value;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const compare = await page.evaluate(() => {
    return {
      url: window.location.href,
      allLinks: Array.from(document.querySelectorAll('a')).map(a => ({
        text: a.textContent.trim().slice(0, 80),
        href: a.href
      })).filter(l => /경기|gameRecord|gameSchedule|VS|와인드업/.test(l.text + l.href)),
      gameText: Array.from(document.querySelectorAll('div, p, span, li'))
        .filter(el => /VS|와인드업/.test(el.textContent))
        .map(el => ({ tag: el.tagName, class: el.className, text: el.textContent.trim().slice(0, 150) }))
        .slice(0, 10),
      tables: Array.from(document.querySelectorAll('table')).map((t, i) => ({
        idx: i,
        ths: Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim()).slice(0, 10),
        rows: Array.from(t.querySelectorAll('tr')).filter(r => r.querySelector('td')).length
      }))
    };
  });
  console.log('URL:', compare.url);
  console.log('\n경기 관련 링크:');
  compare.allLinks.forEach(l => console.log(`  ${l.text} → ${l.href}`));
  console.log('\nVS/와인드업 요소:');
  compare.gameText.forEach(g => console.log(`  [${g.tag}.${g.class}] ${g.text}`));
  console.log('\n테이블:');
  compare.tables.forEach(t => console.log(`  [${t.idx}] ${t.ths.slice(0,5).join(',')} (${t.rows} rows)`));

  await browser.close();
}

main().catch(err => { console.error(err); process.exit(1); });
