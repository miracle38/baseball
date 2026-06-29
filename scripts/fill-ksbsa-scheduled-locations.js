// dbsa 계열(ksbsa.or.kr · donggu.dbsa.kr 등 동일 플랫폼) 예정 경기의 구장 정보를
// 클릭-후-파싱 방식으로 수집해 index.html 에 반영.
// (ksbsa/dbsa 는 teamPage/scheduleRecord/getGameSchedule.hs 를 공유)
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const INDEX = path.join(__dirname, '..', 'index.html');

// 소스(entry.source) → 스케줄 사이트(base, teamSeq) 매핑. 사이트 추가 시 여기에 등록.
const SITES = [
  { test: /ksbsa\.or\.kr/i,    base: 'https://www.ksbsa.or.kr', teamSeq: 93 },
  { test: /donggu\.dbsa\.kr/i, base: 'https://donggu.dbsa.kr',   teamSeq: 70 },
];
function siteFor(source) {
  return SITES.find(s => s.test.test(source || '')) || null;
}

function escRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchMonth(page, base, teamSeq, year, month) {
  const url = base + '/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=' + teamSeq + '&thisYear=' + year + '&thisMonth=' + String(month).padStart(2, '0');
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(1500);
}

async function fetchDayAfterNav(page, base, teamSeq, year, month, day) {
  await fetchMonth(page, base, teamSeq, year, month);
  // plan/finish 가 있는 특정 일자 <a> 찾아 클릭
  const clicked = await page.evaluate((day) => {
    const tds = Array.from(document.querySelectorAll('td'));
    for (const td of tds) {
      const datePara = td.querySelector('.date');
      if (!datePara) continue;
      const n = parseInt(datePara.textContent.trim(), 10);
      if (n !== day) continue;
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
    const site = siteFor(entry.source);
    if (!site) return;
    Object.entries(entry.games || {}).forEach(([gid, g]) => {
      if (g.result === '예정' && (!g.location || g.location === '')) {
        targets.push({
          entryId: entry.id, gid, date: g.date, opponent: g.opponent,
          base: site.base, teamSeq: site.teamSeq, source: entry.source,
        });
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
        const games = await fetchDayAfterNav(page, t.base, t.teamSeq, y, m, d);
        const hit = games.find(g => {
          if (!g.opponent || !t.opponent) return false;
          return g.opponent === t.opponent || g.opponent.includes(t.opponent) || t.opponent.includes(g.opponent);
        });
        if (hit && hit.location) {
          console.log('  [' + t.source + '] ' + t.date + ' vs ' + t.opponent + ': ' + hit.location + (hit.time ? ' (' + hit.time + ')' : ''));
          updates.push(Object.assign({}, t, { newLocation: hit.location, newTime: hit.time }));
        } else {
          console.log('  [' + t.source + '] ' + t.date + ' vs ' + t.opponent + ': 구장 정보 없음 (games=' + JSON.stringify(games).substring(0, 200) + ')');
        }
      } catch (e) {
        console.log('  [' + t.source + '] ' + t.date + ' vs ' + t.opponent + ': ERR ' + e.message);
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
