// ksbsa 예정 경기의 구장 정보를 클릭-후-파싱 방식으로 수집해 index.html 반영
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const INDEX = path.join(__dirname, '..', 'index.html');

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchMonth(page, year, month) {
  // getGameSchedule 는 연/월별로 표시. 네비게이션 후 .team-match 영역에서 해당 월 전체 경기 일정 추출 가능하므로
  // 대신 각 날짜를 직접 클릭해서 .team-match 상세 영역이 업데이트되면 location 추출
  // 안정적으로는 POST 대신 URL query 로 연/월 선택 후 각 +1 일을 클릭
  const url = 'https://www.ksbsa.or.kr/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=93&thisYear=' + year + '&thisMonth=' + String(month).padStart(2, '0');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function fetchDayAfterNav(page, year, month, day) {
  await fetchMonth(page, year, month);
  // plan/finish 가 있는 특정 일자 <a> 찾아 클릭
  const clicked = await page.evaluate((day) => {
    const tds = Array.from(document.querySelectorAll('td'));
    for (const td of tds) {
      const datePara = td.querySelector('.date');
      if (!datePara) continue;
      const n = parseInt(datePara.textContent.trim(), 10);
      if (n !== day) continue;
      // has a match marker
      if (td.innerHTML.includes('plan') || td.innerHTML.includes('finish')) {
        const a = td.querySelector('a');
        if (a) { a.click(); return true; }
      }
    }
    return false;
  }, day);
  if (!clicked) return [];
  await page.waitForTimeout(1200);
  return await page.evaluate(() => {
    const results = [];
    document.querySelectorAll('.match-list .team-match').forEach(m => {
      const info = (m.querySelector('.basic-info')?.textContent || '').replace(/\s+/g, ' ').trim();
      // 공백 없이 "일16:00중앙공원" 형태도 허용
      const tm = info.match(/(\d{2}):(\d{2})\s*(.+?)\s+([^\s]+(?:리그|부|토요\S*))/);
      const time = tm ? tm[1] + ':' + tm[2] : '';
      const location = tm ? tm[3].trim() : '';
      const lNm = (m.querySelector('.l-team .team-name')?.textContent || '').trim();
      const rNm = (m.querySelector('.r-team .team-name')?.textContent || '').trim();
      if (!/와인드업/.test(lNm + rNm)) return;
      const opponent = /와인드업/.test(lNm) ? rNm : lNm;
      results.push({ time, location, opponent });
    });
    return results;
  });
}

async function main() {
  let html = fs.readFileSync(INDEX, 'utf-8');
  const match = html.match(/const ALL_DATA = (\[[\s\S]+?\n\]);/);
  if (!match) throw new Error('ALL_DATA not found');
  const ALL = eval(match[1]);

  const targets = [];
  ALL.forEach(entry => {
    if (!/ksbsa/i.test(entry.source || '')) return;
    Object.entries(entry.games || {}).forEach(([gid, g]) => {
      if (g.result === '예정' && (!g.location || g.location === '')) {
        targets.push({ entryId: entry.id, gid, date: g.date, opponent: g.opponent });
      }
    });
  });
  console.log('대상 경기 ' + targets.length + '건');
  if (targets.length === 0) return;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  try {
    const updates = [];
    for (const t of targets) {
      const [y, m, d] = t.date.split('-').map(Number);
      try {
        const games = await fetchDayAfterNav(page, y, m, d);
        const hit = games.find(g => {
          if (!g.opponent || !t.opponent) return false;
          return g.opponent === t.opponent || g.opponent.includes(t.opponent) || t.opponent.includes(g.opponent);
        });
        if (hit && hit.location) {
          console.log('  ' + t.date + ' vs ' + t.opponent + ': ' + hit.location + (hit.time ? ' (' + hit.time + ')' : ''));
          updates.push(Object.assign({}, t, { newLocation: hit.location, newTime: hit.time }));
        } else {
          console.log('  ' + t.date + ' vs ' + t.opponent + ': 구장 정보 없음 (games=' + JSON.stringify(games).substring(0, 200) + ')');
        }
      } catch (e) {
        console.log('  ' + t.date + ' vs ' + t.opponent + ': ERR ' + e.message);
      }
    }

    let changed = 0;
    for (const u of updates) {
      const safeOpp = escRegex(u.opponent);
      const gameRegex = new RegExp("(g\\d+:\\{date:'" + u.date + "'[^}]*?opponent:'" + safeOpp + "'[^}]*?location:')'", 'g');
      const before = html;
      html = html.replace(gameRegex, "$1" + u.newLocation.replace(/'/g, "\\'") + "'");
      if (html !== before) changed++;
    }
    fs.writeFileSync(INDEX, html, 'utf-8');
    console.log('업데이트 ' + changed + '건');
  } finally {
    await browser.close();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
