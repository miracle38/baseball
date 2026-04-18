// spotcheck-gameone.js — index.html 의 특정 gameone 엔트리 타자 기록과 원본 랭킹 페이지 diff
// 사용법: node scripts/spotcheck-gameone.js 2025_gongju
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs'); const path = require('path'); const vm = require('vm');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const CLUB_IDX = 7734;
const targetId = process.argv[2] || '2025_gongju';

const LEAGUE_MATCHERS = {
  '2025_gongju':         { pattern: /금강토요|공주.*금강/ },
  '2015_daejeon_geumgang': { pattern: /토요금강|대전.*금강/ },
  '2010_geumgang':       { pattern: /금강|대전/ }
};

function parseAllData() {
  const HTML = fs.readFileSync(INDEX_FILE, 'utf8');
  const startRe = /const\s+ALL_DATA\s*=\s*\[/;
  const sm = HTML.match(startRe);
  const startIdx = sm.index + sm[0].length - 1;
  let depth = 0, i = startIdx, inStr = false, strCh = '', prev = '';
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else { if (c === '\'' || c === '"' || c === '`') { inStr = true; strCh = c; }
      else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } } }
    prev = c;
  }
  return vm.runInNewContext('(' + HTML.slice(startIdx, i) + ')');
}

async function scrapeLeague(browser, year, leagueValue, pageType) {
  const page = await browser.newPage();
  await page.goto(`https://www.gameone.kr/club/info/ranking/${pageType}?club_idx=${CLUB_IDX}`, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.selectOption('select[name="season"]', String(year)).catch(()=>{});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('.game_tab li a').forEach(a => { if (a.textContent.trim() === '리그') a.click(); }); });
  await page.waitForTimeout(1200);
  await page.evaluate((v) => { const s = document.querySelectorAll('select')[1]; if (s) { s.value=v; s.dispatchEvent(new Event('change')); } }, leagueValue);
  await page.waitForTimeout(2500);
  const data = await page.evaluate(() => {
    const tbl = document.querySelectorAll('table')[1];
    if (!tbl) return { headers: [], rows: [] };
    const ths = Array.from(tbl.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const rows = [];
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.children).map(c => c.textContent.trim());
      if (cells.length > 5) rows.push(cells);
    });
    return { headers: ths, rows };
  });
  await page.close();
  return data;
}

function parseHitters(headers, rows) {
  const gi = c => headers.indexOf(c);
  const v = (vals, c) => { const i = gi(c); return i >= 0 ? (parseInt(vals[i])||0) : 0; };
  return rows.map(vals => {
    const nameRaw = vals[gi('이름')] || '';
    const numMatch = nameRaw.match(/\((\d+)\)/);
    const name = nameRaw.replace(/\(\d+\)/, '').trim();
    const number = numMatch ? parseInt(numMatch[1]) : 0;
    if (!name) return null;
    return { name, number, G:v(vals,'게임수')||v(vals,'경기')||v(vals,'경기수'),
      PA:v(vals,'타석'), AB:v(vals,'타수'), H:v(vals,'총안타'),
      '2B':v(vals,'2루타'), '3B':v(vals,'3루타'), HR:v(vals,'홈런'),
      RBI:v(vals,'타점'), R:v(vals,'득점'), SB:v(vals,'도루'),
      BB:v(vals,'볼넷'), HBP:v(vals,'사구'), SO:v(vals,'삼진') };
  }).filter(x=>x);
}

(async () => {
  const DATA = parseAllData();
  const entry = DATA.find(e => e.id === targetId);
  if (!entry) { console.error('엔트리 없음:', targetId); process.exit(1); }

  console.log(`=== 스팟체크: ${targetId} ===`);
  console.log(`source: ${entry.source}, year: ${entry.year}, league: ${entry.league}`);
  const localPlayers = Object.values(entry.players);
  console.log(`index.html 내 타자 수: ${localPlayers.length}`);

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors','--no-sandbox'] });
  // Get league options
  const p = await browser.newPage();
  await p.goto(`https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, { waitUntil: 'networkidle', timeout: 45000 });
  await p.waitForTimeout(1500);
  await p.selectOption('select[name="season"]', String(entry.year)).catch(()=>{});
  await p.waitForTimeout(1500);
  await p.evaluate(() => { document.querySelectorAll('.game_tab li a').forEach(a => { if (a.textContent.trim() === '리그') a.click(); }); });
  await p.waitForTimeout(1500);
  const opts = await p.evaluate(() => {
    const s = document.querySelectorAll('select')[1];
    if (!s) return [];
    return Array.from(s.options).filter(o => o.value !== '{}').map(o => ({ text:o.textContent.trim(), value:o.value }));
  });
  await p.close();
  console.log('리그 옵션:', opts.map(o=>o.text).join(' | '));
  const matcher = LEAGUE_MATCHERS[targetId];
  const match = opts.find(o => matcher && matcher.pattern.test(o.text));
  if (!match) { console.error('매칭 리그 없음'); await browser.close(); process.exit(2); }
  console.log('선택된 리그:', match.text);

  const hitData = await scrapeLeague(browser, entry.year, match.value, 'hitter');
  const remote = parseHitters(hitData.headers, hitData.rows);
  await browser.close();

  console.log(`gameone 원본 타자 수: ${remote.length}`);
  console.log('\n=== diff 결과 ===');
  // 상위 몇 명만 비교
  const pickTop = 6;
  const sortedLocal = [...localPlayers].sort((a,b)=>(b.PA||0)-(a.PA||0)).slice(0, pickTop);
  const keys = ['G','PA','AB','H','2B','3B','HR','RBI','R','SB','BB','HBP','SO'];
  let totalDiff = 0, cmpCount = 0;
  for (const l of sortedLocal) {
    const r = remote.find(x => x.name === l.name && (x.number === l.number || !l.number || !x.number));
    if (!r) { console.log(`  [${l.name}(#${l.number})] 원본 미발견`); continue; }
    const diffs = [];
    for (const k of keys) {
      const lv = l[k]||0, rv = r[k]||0;
      if (lv !== rv) { diffs.push(`${k}:${lv}→${rv}`); totalDiff++; }
      cmpCount++;
    }
    console.log(`  [${l.name}(#${l.number})] ${diffs.length===0?'일치':diffs.join(', ')}`);
  }
  console.log(`\n비교 필드 수: ${cmpCount}, 불일치: ${totalDiff}`);
})();
