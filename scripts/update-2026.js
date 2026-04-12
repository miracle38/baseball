/**
 * 2026시즌 데이터 자동 업데이트
 * ksbsa.or.kr, donggu.dbsa.kr에서 최신 타자/투수/경기 스크래핑 → index.html 반영
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

async function fetchPage(browser, url) {
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);
  const text = await page.evaluate(() => document.body.innerText);
  await page.close();
  return text;
}

// WebFetch와 동일한 방식으로 타자 기록 파싱
async function scrapeBatters(browser, baseUrl, teamSeq, year) {
  const page = await browser.newPage();
  const url = `${baseUrl}/teamPage/scheduleRecord/getBatterRecord.hs?teamSeq=${teamSeq}&searchYear=${year}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const players = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const result = [];
    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 15) return;
      const nameCell = cells[0];
      const numCell = cells[1];
      if (!nameCell || !numCell) return;

      const nameLink = nameCell.querySelector('a');
      const name = nameLink ? nameLink.textContent.trim() : nameCell.textContent.trim();
      const num = parseInt(numCell.textContent.trim()) || 0;
      if (!name || /선수명|순위/.test(name)) return;

      const getVal = (idx) => parseFloat(cells[idx]?.textContent.trim()) || 0;

      result.push({
        name, num,
        G: getVal(3), PA: getVal(4), AB: getVal(5), H: getVal(6),
        '2B': getVal(7), '3B': getVal(8), HR: getVal(9),
        RBI: getVal(10), R: getVal(11), SB: getVal(12),
        BB: getVal(13), HBP: getVal(14), SO: getVal(15),
        kOBP: getVal(16), kSLG: getVal(17), kOPS: getVal(18)
      });
    });
    return result;
  });

  await page.close();
  return players;
}

async function scrapePitchers(browser, baseUrl, teamSeq, year) {
  const page = await browser.newPage();
  const url = `${baseUrl}/teamPage/scheduleRecord/getPitcherRecord.hs?teamSeq=${teamSeq}&searchYear=${year}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const pitchers = await page.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    const result = [];
    rows.forEach(row => {
      const cells = Array.from(row.querySelectorAll('td'));
      if (cells.length < 10) return;
      const nameCell = cells[0];
      if (!nameCell) return;

      const nameLink = nameCell.querySelector('a');
      const name = nameLink ? nameLink.textContent.trim() : nameCell.textContent.trim();
      const num = parseInt(cells[1]?.textContent.trim()) || 0;
      if (!name || /선수명|순위/.test(name)) return;

      const getVal = (idx) => parseFloat(cells[idx]?.textContent.trim()) || 0;

      result.push({
        name, num,
        G: getVal(3), W: getVal(4), L: getVal(5),
        SV: getVal(6), HD: getVal(7),
        IP: getVal(8), pH: getVal(9), pHR: getVal(10),
        K: getVal(11), pBB: getVal(12), pIBB: getVal(13), pHBP: getVal(14),
        R: getVal(15), ER: getVal(16)
      });
    });
    return result;
  });

  await page.close();
  return pitchers;
}

async function scrapeGames(browser, baseUrl, teamSeq, year) {
  const page = await browser.newPage();
  const url = `${baseUrl}/teamPage/main/getMain.hs?teamSeq=${teamSeq}`;
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(5000);

  const games = await page.evaluate(() => {
    const text = document.body.innerText;
    const lines = text.split('\n');
    const result = [];

    // 경기 결과 패턴 찾기
    for (let i = 0; i < lines.length; i++) {
      const dateMatch = lines[i].match(/(\d{4}\.\d{2}\.\d{2})/);
      if (!dateMatch) continue;

      const context = lines.slice(i, Math.min(i + 5, lines.length)).join(' ');
      const scoreMatch = context.match(/(\d+)\s*VS\s*(\d+)/i);
      if (!scoreMatch) continue;

      // 간단히 날짜와 스코어만 추출
      result.push({
        date: dateMatch[1].replace(/\./g, '-'),
        raw: context.substring(0, 150)
      });
    }
    return result;
  });

  await page.close();
  return games;
}

function playersToJS(players) {
  if (!players.length) return '{}';
  const items = players.map((p, i) => {
    return `p${i+1}:{name:'${p.name.replace(/'/g,"\\'")}',num:${p.num},G:${p.G},PA:${p.PA},AB:${p.AB},H:${p.H},'2B':${p['2B']},'3B':${p['3B']},HR:${p.HR},RBI:${p.RBI},R:${p.R},SB:${p.SB},BB:${p.BB},HBP:${p.HBP},SO:${p.SO},kOBP:${p.kOBP},kSLG:${p.kSLG},kOPS:${p.kOPS}}`;
  });
  return '{' + items.join(',') + '}';
}

function pitchersToJS(pitchers) {
  if (!pitchers.length) return '{}';
  const items = pitchers.map((p, i) => {
    return `pt${i+1}:{name:'${p.name.replace(/'/g,"\\'")}',num:${p.num},G:${p.G},W:${p.W},L:${p.L},SV:${p.SV},HD:${p.HD},IP:${p.IP},pH:${p.pH},pHR:${p.pHR},K:${p.K},pBB:${p.pBB},pIBB:${p.pIBB},pHBP:${p.pHBP},R:${p.R},ER:${p.ER}}`;
  });
  return '{' + items.join(',') + '}';
}

function updateEntry(html, entryId, playerJS, pitcherJS) {
  // ALL_DATA에서 해당 entry의 players:{...} 와 pitchers:{...} 를 교체
  // entryId로 해당 줄 찾기
  const idPattern = new RegExp(`id:\\s*'${entryId}'`);
  const lines = html.split('\n');

  for (let i = 0; i < lines.length; i++) {
    if (idPattern.test(lines[i])) {
      // players:{...} 교체
      if (playerJS && playerJS !== '{}') {
        lines[i] = lines[i].replace(/players:\{[^}]*(?:\{[^}]*\}[^}]*)*\}/, `players:${playerJS}`);
      }
      // pitchers:{...} 교체
      if (pitcherJS && pitcherJS !== '{}') {
        lines[i] = lines[i].replace(/pitchers:\{[^}]*(?:\{[^}]*\}[^}]*)*\}/, `pitchers:${pitcherJS}`);
      }
      console.log(`  Updated entry: ${entryId}`);
      break;
    }
  }

  return lines.join('\n');
}

async function main() {
  console.log('=== 2026 시즌 데이터 업데이트 ===');
  console.log(new Date().toISOString());

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  let updated = false;

  // 세종 2026
  try {
    console.log('\n[세종 2026]');
    const batters = await scrapeBatters(browser, 'https://www.ksbsa.or.kr', 93, 2026);
    const pitchers = await scrapePitchers(browser, 'https://www.ksbsa.or.kr', 93, 2026);
    if (batters.length > 0) {
      html = updateEntry(html, '2026_sejong', playersToJS(batters), pitchersToJS(pitchers));
      updated = true;
      console.log(`  타자 ${batters.length}명, 투수 ${pitchers.length}명`);
    }
  } catch (e) { console.error('  세종 에러:', e.message); }

  // 동구 2026
  try {
    console.log('\n[동구 2026]');
    const batters = await scrapeBatters(browser, 'https://donggu.dbsa.kr', 70, 2026);
    const pitchers = await scrapePitchers(browser, 'https://donggu.dbsa.kr', 70, 2026);
    if (batters.length > 0) {
      html = updateEntry(html, '2026_donggu', playersToJS(batters), pitchersToJS(pitchers));
      updated = true;
      console.log(`  타자 ${batters.length}명, 투수 ${pitchers.length}명`);
    }
  } catch (e) { console.error('  동구 에러:', e.message); }

  await browser.close();

  if (updated) {
    fs.writeFileSync(INDEX_FILE, html, 'utf-8');
    console.log('\n✅ index.html 업데이트 완료');
  } else {
    console.log('\n⚠️ 변경사항 없음');
  }
}

main().catch(console.error);
