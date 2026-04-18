/**
 * Phase 1 보정 스크립트 — gameone.kr 엔트리 3건의 players/pitchers 만 재수집
 * 대상: 2025_gongju, 2011_geumgang, 2010_geumgang (BB/HBP/SO 전부 0인 누락 건)
 *
 * 주의: 엔트리의 기존 header(id, year, league, record, W/L/D/G 등), games, seasonSummary 는 보존.
 *       players{}, pitchers{} 만 in-place 치환.
 *
 * 사용: NODE_PATH="D:/00. Claude/01. calendar/node_modules" node scripts/fix-gameone-bb-hbp-so.js
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const CLUB_IDX = 7734;

const TARGETS = [
  { id: '2025_gongju',   year: 2025, pattern: /금강토요|공주.*금강/ },
  // 2010-2011: 리그 옵션 자체가 없으므로 기본 '전체' 테이블(table[0]) 을 사용
  { id: '2011_geumgang', year: 2011, useAll: true },
  { id: '2010_geumgang', year: 2010, useAll: true },
];

function escStr(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

async function selectYearAndLeague(page, baseUrl, year, leagueValue) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.selectOption('select[name="season"]', String(year)).catch(() => {});
  await page.waitForTimeout(1500);
  await page.evaluate(() => { document.querySelectorAll('.game_tab li a').forEach(a => { if (a.textContent.trim() === '리그') a.click(); }); });
  await page.waitForTimeout(1200);
  await page.evaluate((v) => { const s = document.querySelectorAll('select')[1]; if (s) { s.value = v; s.dispatchEvent(new Event('change')); } }, leagueValue);
  await page.waitForTimeout(2500);
}

async function scrapeTable(page, tableIdx = 1) {
  return await page.evaluate((ti) => {
    const tbl = document.querySelectorAll('table')[ti];
    if (!tbl) return { headers: [], rows: [] };
    const ths = Array.from(tbl.querySelectorAll('thead th')).map(th => th.textContent.trim());
    const rows = [];
    tbl.querySelectorAll('tbody tr').forEach(tr => {
      const cells = Array.from(tr.children).map(c => c.textContent.trim());
      if (cells.length > 5) rows.push(cells);
    });
    return { headers: ths, rows };
  }, tableIdx);
}

async function loadYearOnly(page, baseUrl, year) {
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForTimeout(1500);
  await page.selectOption('select[name="season"]', String(year)).catch(() => {});
  await page.waitForTimeout(2500);
}

function parseHitters(headers, rows) {
  const gi = c => headers.indexOf(c);
  const v = (vals, c) => { const i = gi(c); return i >= 0 ? (parseInt(vals[i]) || 0) : 0; };
  const f = (vals, c) => { const i = gi(c); return i >= 0 ? (parseFloat(vals[i]) || 0) : 0; };
  return rows.map(vals => {
    const nameRaw = vals[gi('이름')] || '';
    const numMatch = nameRaw.match(/\((\d+)\)/);
    const name = nameRaw.replace(/\(\d+\)/, '').trim();
    const number = numMatch ? parseInt(numMatch[1]) : 0;
    if (!name) return null;
    return {
      name, number,
      G: v(vals, '게임수') || v(vals, '경기') || v(vals, '경기수'),
      PA: v(vals, '타석'), AB: v(vals, '타수'), H: v(vals, '총안타'),
      '2B': v(vals, '2루타'), '3B': v(vals, '3루타'), HR: v(vals, '홈런'),
      RBI: v(vals, '타점'), R: v(vals, '득점'), SB: v(vals, '도루'),
      BB: v(vals, '볼넷'), HBP: v(vals, '사구'), SO: v(vals, '삼진'),
      kOBP: f(vals, '출루율'), kSLG: f(vals, '장타율'), kOPS: f(vals, 'OPS')
    };
  }).filter(x => x);
}

function parsePitchers(headers, rows) {
  const gi = c => headers.indexOf(c);
  const v = (vals, c) => { const i = gi(c); return i >= 0 ? (parseInt(vals[i]) || 0) : 0; };
  const s = (vals, c) => { const i = gi(c); return i >= 0 ? vals[i] : '0'; };
  return rows.map(vals => {
    const nameRaw = vals[gi('이름')] || '';
    const numMatch = nameRaw.match(/\((\d+)\)/);
    const name = nameRaw.replace(/\(\d+\)/, '').trim();
    const number = numMatch ? parseInt(numMatch[1]) : 0;
    if (!name) return null;
    return {
      name, number,
      G: v(vals, '게임수') || v(vals, '경기수') || v(vals, '경기'),
      W: v(vals, '승'), L: v(vals, '패'), SV: v(vals, '세'), HD: v(vals, '홀드'),
      IP: s(vals, '이닝'), BF: v(vals, '타자'), NP: v(vals, '투구수'),
      pH: v(vals, '피안타'), pHR: v(vals, '피홈런'),
      K: v(vals, '탈삼진'), pBB: v(vals, '볼넷'), pIBB: v(vals, '고의4구'), pHBP: v(vals, '사구'),
      R: v(vals, '실점'), ER: v(vals, '자책점')
    };
  }).filter(x => x);
}

function buildPlayersJs(players) {
  if (!players || players.length === 0) return '{}';
  return '{' + players.map((p, i) => {
    let s = `p${i+1}:{name:'${escStr(p.name)}',number:${p.number}`;
    ['G','PA','AB','H','2B','3B','HR','RBI','R','SB','BB','HBP','SO'].forEach(k => {
      const key = /^\d/.test(k) ? `'${k}'` : k;
      s += `,${key}:${p[k]||0}`;
    });
    if (p.kOBP) s += `,kOBP:${p.kOBP}`;
    if (p.kSLG) s += `,kSLG:${p.kSLG}`;
    if (p.kOPS) s += `,kOPS:${p.kOPS}`;
    return s + '}';
  }).join(',') + '}';
}

function buildPitchersJs(pitchers) {
  if (!pitchers || pitchers.length === 0) return '{}';
  return '{' + pitchers.map((p, i) => {
    const ipVal = parseFloat(p.IP) || 0;
    let s = `pt${i+1}:{name:'${escStr(p.name)}',num:${p.number}`;
    s += `,G:${p.G||0},W:${p.W||0},L:${p.L||0},SV:${p.SV||0},HD:${p.HD||0},IP:${ipVal}`;
    s += `,pH:${p.pH||0},pHR:${p.pHR||0},K:${p.K||0},pBB:${p.pBB||0},pIBB:${p.pIBB||0},pHBP:${p.pHBP||0}`;
    s += `,R:${p.R||0},ER:${p.ER||0}`;
    return s + '}';
  }).join(',') + '}';
}

function findEntrySpan(text, entryId) {
  const re = new RegExp(`id\\s*:\\s*['"]${entryId}['"]`);
  const m = re.exec(text);
  if (!m) return null;
  let i = m.index;
  while (i > 0 && text[i] !== '{') i--;
  let depth = 1, j = i + 1;
  let inStr = false, strCh = '', esc = false;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (esc) { esc = false; j++; continue; }
    if (c === '\\' && inStr) { esc = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    j++;
  }
  return { start: i, end: j };
}

function replaceBlock(html, entryId, blockName, newContent) {
  const span = findEntrySpan(html, entryId);
  if (!span) return html;
  const entryText = html.substring(span.start, span.end);
  const blockRe = new RegExp(blockName + '\\s*:\\s*\\{');
  const bm = blockRe.exec(entryText);
  if (!bm) return html;
  let depth = 1, j = bm.index + bm[0].length;
  let inStr = false, strCh = '', esc = false;
  while (j < entryText.length && depth > 0) {
    const c = entryText[j];
    if (esc) { esc = false; j++; continue; }
    if (c === '\\' && inStr) { esc = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === '{') depth++;
    else if (c === '}') depth--;
    j++;
  }
  const newEntryText = entryText.substring(0, bm.index) + blockName + ':' + newContent + entryText.substring(j);
  return html.substring(0, span.start) + newEntryText + html.substring(span.end);
}

async function getLeagueOpts(browser, year) {
  const page = await browser.newPage();
  try {
    await page.goto(`https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(1500);
    await page.selectOption('select[name="season"]', String(year)).catch(() => {});
    await page.waitForTimeout(1500);
    await page.evaluate(() => { document.querySelectorAll('.game_tab li a').forEach(a => { if (a.textContent.trim() === '리그') a.click(); }); });
    await page.waitForTimeout(1500);
    const opts = await page.evaluate(() => {
      const s = document.querySelectorAll('select')[1];
      if (!s) return [];
      return Array.from(s.options).filter(o => o.value !== '{}').map(o => ({ text: o.textContent.trim(), value: o.value }));
    });
    return opts;
  } finally {
    await page.close();
  }
}

async function main() {
  console.log('=== Phase 1: gameone 3건 BB/HBP/SO 복구 ===\n');

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const summary = [];

  for (const tgt of TARGETS) {
    console.log(`\n--- [${tgt.id}] year=${tgt.year} ---`);

    // '전체' 테이블을 사용하는 케이스(오래된 연도 → 리그 선택 옵션 자체가 없음)
    if (tgt.useAll) {
      const page = await browser.newPage();
      try {
        await loadYearOnly(page, `https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, tgt.year);
        const hitData = await scrapeTable(page, 0);
        const hasBB = hitData.headers.includes('볼넷');
        const hasHBP = hitData.headers.includes('사구');
        const hasSO = hitData.headers.includes('삼진');
        if (!hasBB || !hasHBP || !hasSO) {
          console.log(`  [skip] 원본에 BB/HBP/SO 컬럼 부재 (BB=${hasBB}, HBP=${hasHBP}, SO=${hasSO})`);
          await page.close();
          summary.push({ id: tgt.id, status: 'source_lacks_columns', headers: hitData.headers });
          continue;
        }
        const hitters = parseHitters(hitData.headers, hitData.rows);
        console.log(`  (전체 테이블) 타자 ${hitters.length}명`);

        await loadYearOnly(page, `https://www.gameone.kr/club/info/ranking/pitcher?club_idx=${CLUB_IDX}`, tgt.year);
        const pitData = await scrapeTable(page, 0);
        const pitchers = parsePitchers(pitData.headers, pitData.rows);
        console.log(`  (전체 테이블) 투수 ${pitchers.length}명`);

        await page.close();

        if (hitters.length > 0) {
          const newHtml = replaceBlock(html, tgt.id, 'players', buildPlayersJs(hitters));
          if (newHtml !== html) { html = newHtml; console.log(`    players 치환 완료`); }
          else console.log(`    players 치환 실패`);
        }
        if (pitchers.length > 0) {
          const newHtml = replaceBlock(html, tgt.id, 'pitchers', buildPitchersJs(pitchers));
          if (newHtml !== html) { html = newHtml; console.log(`    pitchers 치환 완료`); }
          else console.log(`    pitchers 치환 실패`);
        }
        summary.push({ id: tgt.id, status: 'ok_all_tab', hitters: hitters.length, pitchers: pitchers.length });
      } catch (e) {
        console.log(`  에러: ${e.message}`);
        try { await page.close(); } catch {}
        summary.push({ id: tgt.id, status: 'error', err: e.message });
      }
      continue;
    }

    let opts;
    try { opts = await getLeagueOpts(browser, tgt.year); }
    catch (e) { console.log(`  리그 옵션 로드 실패: ${e.message}`); summary.push({ id: tgt.id, status: 'fail_option' }); continue; }

    if (!opts || opts.length === 0) {
      console.log(`  리그 옵션 없음`);
      summary.push({ id: tgt.id, status: 'no_options' }); continue;
    }
    console.log(`  리그 옵션: ${opts.map(o => o.text).join(' | ')}`);

    const matched = opts.filter(o => tgt.pattern.test(o.text));
    if (matched.length === 0) {
      console.log(`  매칭 리그 없음`);
      summary.push({ id: tgt.id, status: 'no_match' }); continue;
    }
    const opt = matched[0];
    console.log(`  선택된 리그: ${opt.text}`);

    // Check if headers include BB/HBP/SO
    const page = await browser.newPage();
    try {
      await selectYearAndLeague(page, `https://www.gameone.kr/club/info/ranking/hitter?club_idx=${CLUB_IDX}`, tgt.year, opt.value);
      const hitData = await scrapeTable(page, 1);
      console.log(`  hitter headers: ${hitData.headers.join('|')}`);
      const hasBB = hitData.headers.includes('볼넷');
      const hasHBP = hitData.headers.includes('사구');
      const hasSO = hitData.headers.includes('삼진');
      if (!hasBB || !hasHBP || !hasSO) {
        console.log(`  [skip] 원본에 BB/HBP/SO 컬럼 부재 (BB=${hasBB}, HBP=${hasHBP}, SO=${hasSO})`);
        await page.close();
        summary.push({ id: tgt.id, status: 'source_lacks_columns', headers: hitData.headers });
        continue;
      }
      const hitters = parseHitters(hitData.headers, hitData.rows);

      await selectYearAndLeague(page, `https://www.gameone.kr/club/info/ranking/pitcher?club_idx=${CLUB_IDX}`, tgt.year, opt.value);
      const pitData = await scrapeTable(page, 1);
      const pitchers = parsePitchers(pitData.headers, pitData.rows);

      await page.close();

      console.log(`  타자 ${hitters.length}명, 투수 ${pitchers.length}명`);

      if (hitters.length > 0) {
        const newHtml = replaceBlock(html, tgt.id, 'players', buildPlayersJs(hitters));
        if (newHtml !== html) {
          html = newHtml;
          console.log(`    players 치환 완료`);
        } else {
          console.log(`    players 치환 실패(매칭 안됨)`);
        }
      }
      if (pitchers.length > 0) {
        const newHtml = replaceBlock(html, tgt.id, 'pitchers', buildPitchersJs(pitchers));
        if (newHtml !== html) {
          html = newHtml;
          console.log(`    pitchers 치환 완료`);
        } else {
          console.log(`    pitchers 치환 실패(매칭 안됨)`);
        }
      }
      summary.push({ id: tgt.id, status: 'ok', hitters: hitters.length, pitchers: pitchers.length });
    } catch (e) {
      console.log(`  에러: ${e.message}`);
      summary.push({ id: tgt.id, status: 'error', err: e.message });
      try { await page.close(); } catch {}
    }
  }

  await browser.close();
  fs.writeFileSync(INDEX_FILE, html, 'utf-8');

  console.log('\n=== 결과 요약 ===');
  for (const s of summary) console.log(' ', JSON.stringify(s));
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
