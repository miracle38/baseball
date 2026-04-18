/**
 * 잔여 3건 엔트리 games{} 재수집
 *   - 2024_daedeok: daedeokgu.dbsa.kr, teamSeq=24, 2024
 *   - 2023_sejong : ksbsa.or.kr     , teamSeq=93, 2023 (세종 토요리그 NORMAL 만)
 *   - 2023_daedeok: daedeokgu.dbsa.kr, teamSeq=24, 2023
 *
 * 기존 games{} 의 boxScore 는 새로 수집된 동일 date+opponent 매칭으로 보존하고,
 * 새 게임의 boxScoreUrl 을 저장. 스탯(players/pitchers) 은 건드리지 않음.
 */
const { chromium } = require('D:/00. Claude/01. calendar/node_modules/playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'fix_remaining');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR, { recursive: true });

const TMP_DIR = path.join(__dirname, '..', 'tmp_games');
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });

const ALL_TARGETS = [
  { entryId: '2024_daedeok', host: 'https://daedeokgu.dbsa.kr', teamSeq: 24, year: 2024, leagueFilter: null },
  { entryId: '2023_sejong',  host: 'https://www.ksbsa.or.kr',    teamSeq: 93, year: 2023, leagueFilter: 'sejong_normal' },
  { entryId: '2023_daedeok', host: 'https://daedeokgu.dbsa.kr', teamSeq: 24, year: 2023, leagueFilter: null },
];
const ONLY = (process.argv[2] || '').split(',').filter(Boolean);
const TARGETS = ONLY.length ? ALL_TARGETS.filter(t => ONLY.includes(t.entryId)) : ALL_TARGETS;
const DRY_RUN = process.argv.includes('--dry');

// ==================== HTML span helpers ====================
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

function findBalancedBlockAfter(text, startIdx) {
  const openChar = text[startIdx];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 1, j = startIdx + 1;
  let inStr = false, strCh = '', esc = false;
  while (j < text.length && depth > 0) {
    const c = text[j];
    if (esc) { esc = false; j++; continue; }
    if (c === '\\' && inStr) { esc = true; j++; continue; }
    if (inStr) { if (c === strCh) inStr = false; j++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; j++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) depth--;
    j++;
  }
  return { start: startIdx, end: j };
}

function extractExistingGames(html, entryId) {
  const span = findEntrySpan(html, entryId);
  if (!span) return { games: [], span: null };
  const entryText = html.substring(span.start, span.end);
  const gRe = /games\s*:\s*\{/;
  const gm = gRe.exec(entryText);
  if (!gm) return { games: [], span };
  const braceStart = gm.index + gm[0].length - 1;
  const gSpan = findBalancedBlockAfter(entryText, braceStart);
  const gamesText = entryText.substring(gSpan.start, gSpan.end);
  const games = [];
  let i = 1;
  while (i < gamesText.length - 1) {
    while (i < gamesText.length - 1 && /[\s,]/.test(gamesText[i])) i++;
    if (i >= gamesText.length - 1) break;
    const kMatch = /^g\d+\s*:\s*\{/.exec(gamesText.substring(i));
    if (!kMatch) break;
    const keyName = /^g\d+/.exec(kMatch[0])[0];
    const objStart = i + kMatch[0].length - 1;
    const objSpan = findBalancedBlockAfter(gamesText, objStart);
    const objText = gamesText.substring(objStart, objSpan.end);

    const dateM = /date:'([^']*)'/.exec(objText);
    const oppM = /opponent:'([^']*)'/.exec(objText);
    const osM = /ourScore:(-?\d+)/.exec(objText);
    const tsM = /theirScore:(-?\d+)/.exec(objText);
    const rsM = /result:'([^']*)'/.exec(objText);
    const locM = /location:'([^']*)'/.exec(objText);
    const urlM = /boxScoreUrl:'([^']*)'/.exec(objText);
    // Extract boxScore block text (preserve as-is)
    let boxScoreText = null;
    const bsM = /boxScore\s*:\s*\{/.exec(objText);
    if (bsM) {
      const bsBraceStart = bsM.index + bsM[0].length - 1;
      const bsSpan = findBalancedBlockAfter(objText, bsBraceStart);
      boxScoreText = objText.substring(bsSpan.start, bsSpan.end);
    }
    games.push({
      key: keyName,
      date: dateM ? dateM[1] : '',
      opponent: oppM ? oppM[1] : '',
      ourScore: osM ? parseInt(osM[1]) : 0,
      theirScore: tsM ? parseInt(tsM[1]) : 0,
      result: rsM ? rsM[1] : '',
      location: locM ? locM[1] : '',
      boxScoreUrl: urlM ? urlM[1] : '',
      boxScoreText: boxScoreText,
      rawObjText: objText
    });
    i = objSpan.end;
  }
  return { games, span, entryText };
}

function replaceGamesBlock(html, entryId, newGamesJs) {
  const span = findEntrySpan(html, entryId);
  if (!span) return { html, ok: false };
  const entryText = html.substring(span.start, span.end);
  const re = /games\s*:\s*\{/;
  const m = re.exec(entryText);
  if (!m) return { html, ok: false };
  const braceStart = m.index + m[0].length - 1;
  const gSpan = findBalancedBlockAfter(entryText, braceStart);
  const newEntryText = entryText.substring(0, m.index) + 'games:' + newGamesJs + entryText.substring(gSpan.end);
  return { html: html.substring(0, span.start) + newEntryText + html.substring(span.end), ok: true };
}

// ==================== Calendar navigation ====================
async function navigateToMonth(page, host, teamSeq, year, month) {
  await page.evaluate(({ host, teamSeq, yr, mo }) => {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `${host}/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=${teamSeq}`;
    [['thisYear', yr], ['thisMonth', String(mo).padStart(2, '0')], ['thisDay', '01']].forEach(([n, v]) => {
      const i = document.createElement('input'); i.type = 'hidden'; i.name = n; i.value = v; form.appendChild(i);
    });
    document.body.appendChild(form);
    form.submit();
  }, { host, teamSeq, yr: String(year), mo: month });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1200);
}

async function getGameDates(page) {
  return await page.evaluate(() => {
    const dates = [];
    document.querySelectorAll('td a.el-cal-item').forEach(a => {
      const dateP = a.querySelector('.date');
      const matchP = a.querySelector('.match');
      if (dateP && matchP && /\+\d/.test(matchP.textContent)) {
        dates.push(parseInt(dateP.textContent.trim()));
      }
    });
    return dates;
  });
}

async function clickDateAndGetGames(page, day) {
  await page.evaluate(({ day }) => {
    const calCells = document.querySelectorAll('td a.el-cal-item');
    for (const a of calCells) {
      const d = a.querySelector('.date');
      if (d && parseInt(d.textContent.trim()) === day) { a.click(); return; }
    }
  }, { day });
  await page.waitForNavigation({ waitUntil: 'networkidle', timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(1200);
  return await page.evaluate(() => {
    const games = [];
    const matchWrap = document.querySelector('.match-list-wrap');
    if (!matchWrap) return games;
    const matchLists = matchWrap.querySelectorAll('.match-list');
    matchLists.forEach(ml => {
      const teamMatch = ml.querySelector('.team-match');
      if (!teamMatch) return;
      const fullText = ml.textContent.replace(/\s+/g, ' ').trim();
      const dateMatch = fullText.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일\s*(\d{2}:\d{2})/);
      const date = dateMatch ? `${dateMatch[1]}-${dateMatch[2]}-${dateMatch[3]}` : '';
      const time = dateMatch ? dateMatch[4] : '';
      const lTeam = teamMatch.querySelector('.l-team');
      const rTeam = teamMatch.querySelector('.r-team');
      const getTeam = (el) => {
        if (!el) return { name: '', score: 0 };
        const info = el.querySelector('.team-info');
        const name = info ? info.textContent.trim().replace(/\d+$/, '').trim() : el.textContent.replace(/\d+/g, '').trim();
        const scoreEl = el.querySelector('.team-score, .score');
        let score = 0;
        if (scoreEl) score = parseInt(scoreEl.textContent.trim()) || 0;
        else { const nums = el.textContent.match(/(\d+)\s*$/); score = nums ? parseInt(nums[1]) : 0; }
        return { name, score };
      };
      const L = getTeam(lTeam), R = getTeam(rTeam);
      let league = '';
      const leagueEl = ml.querySelector('.league-name, .match-league');
      if (leagueEl) league = leagueEl.textContent.trim();
      else {
        const leagueMatch = fullText.match(/(토요리그\s*-\s*[^\s,]+|인터리그\s*-\s*[^\s,]+|시장기\s*-\s*[^\s,]+|협회장기\s*-\s*[^\s,]+|플레이오프[^\s,]*|PO[^\s,]*)/);
        if (leagueMatch) league = leagueMatch[1];
      }
      let location = '';
      const locMatch = fullText.match(/([\w\s가-힣()]+(?:야구장|공원|운동장|그라운드|경기장|구장))/);
      if (locMatch) location = locMatch[1].trim();
      let gameScheduleSeq = null;
      let leagueCategory = null;
      const detailLink = ml.querySelector('a[href*="gameScheduleSeq"]');
      if (detailLink) {
        const sm = detailLink.href.match(/gameScheduleSeq=(\d+)/);
        if (sm) gameScheduleSeq = sm[1];
        const lc = detailLink.href.match(/leagueCategory=([A-Z_]+)/);
        if (lc) leagueCategory = lc[1];
      }
      games.push({
        date, time, location, league,
        lName: L.name, lScore: L.score, rName: R.name, rScore: R.score,
        gameScheduleSeq, leagueCategory,
        rawText: fullText.slice(0, 300)
      });
    });
    return games;
  });
}

// ==================== Main ====================
async function scrapeTarget(page, target) {
  const { entryId, host, teamSeq, year, leagueFilter } = target;
  console.log(`\n===== ${entryId} (${host}, teamSeq=${teamSeq}, year=${year}) =====`);

  await page.goto(`${host}/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=${teamSeq}`, {
    waitUntil: 'networkidle', timeout: 20000
  }).catch(() => {});
  await page.waitForTimeout(1000);

  const collected = [];
  for (const month of [3, 4, 5, 6, 7, 8, 9, 10, 11]) {
    console.log(`--- ${year}년 ${month}월 ---`);
    await navigateToMonth(page, host, teamSeq, year, month);
    const days = await getGameDates(page);
    if (days.length === 0) { console.log('  경기 없음'); continue; }
    console.log(`  날짜: ${days.join(', ')}`);
    for (const day of days) {
      await navigateToMonth(page, host, teamSeq, year, month);
      await page.waitForTimeout(400);
      const games = await clickDateAndGetGames(page, day);
      for (const g of games) {
        const isWindupL = /와인드업/.test(g.lName);
        const isWindupR = /와인드업/.test(g.rName);
        if (!isWindupL && !isWindupR) continue;
        // Debug raw league metadata
        console.log(`    [RAW] ${g.date} lg="${(g.league||'').slice(0,60)}" lc=${g.leagueCategory} raw="${(g.rawText||'').slice(0,140)}"`);

        // 2023_sejong: 세종 토요리그 정규 — 인터리그 / PO 만 제외. URL의 leagueCategory
        // 은 신뢰성이 떨어짐(정규경기도 INTER 로 나옴). rawText 에 "토요4부(인터리그)"
        // 포함될 때만 인터리그로 간주. 플레이오프는 league 필드가 "PO" 로 나옴.
        if (leagueFilter === 'sejong_normal') {
          const rawT = g.rawText || '';
          const leagueT = g.league || '';
          const isInter = /토요4부\(인터리그\)/.test(rawT);
          const isPO = /^PO$/i.test(leagueT.trim()) || /플레이오프/.test(rawT);
          if (isInter) { console.log(`    [SKIP-인터] ${g.date} seq=${g.gameScheduleSeq}`); continue; }
          if (isPO) { console.log(`    [SKIP-PO] ${g.date} seq=${g.gameScheduleSeq}`); continue; }
        }

        const opponent = isWindupL ? g.rName : g.lName;
        const ourScore = isWindupL ? g.lScore : g.rScore;
        const theirScore = isWindupL ? g.rScore : g.lScore;
        let result = '무';
        if (ourScore > theirScore) result = '승';
        else if (ourScore < theirScore) result = '패';
        const leagueCat = g.leagueCategory || 'NORMAL';
        const boxScoreUrl = g.gameScheduleSeq
          ? `${host}/schedule/getGameRecord.hs?gameScheduleSeq=${g.gameScheduleSeq}&leagueCategory=${leagueCat}`
          : '';
        console.log(`    ${g.date} vs ${opponent} ${ourScore}-${theirScore} ${result} seq=${g.gameScheduleSeq} lc=${leagueCat} lg=${g.league}`);
        collected.push({
          date: g.date, opponent, ourScore, theirScore, result,
          location: g.location || '',
          league: g.league || '',
          gameScheduleSeq: g.gameScheduleSeq,
          leagueCategory: leagueCat,
          boxScoreUrl
        });
      }
    }
  }
  collected.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(path.join(TMP_DIR, `tmp_games_${entryId}.json`), JSON.stringify(collected, null, 2), 'utf-8');
  console.log(`\n[${entryId}] 총 ${collected.length} 경기 수집`);
  return collected;
}

function buildMergedGames(existingGames, collectedGames) {
  // Key by date + opponent (normalized)
  const norm = (s) => (s || '').replace(/\s+/g, '').trim();
  const existingByKey = {};
  existingGames.forEach(g => {
    const k = `${g.date}|${norm(g.opponent)}`;
    existingByKey[k] = g;
  });

  const merged = collectedGames.map(cg => {
    const k = `${cg.date}|${norm(cg.opponent)}`;
    const prev = existingByKey[k];
    return {
      date: cg.date,
      opponent: cg.opponent,
      ourScore: cg.ourScore,
      theirScore: cg.theirScore,
      result: cg.result,
      location: cg.location || (prev ? prev.location : ''),
      boxScoreUrl: cg.boxScoreUrl || (prev ? prev.boxScoreUrl : ''),
      boxScoreText: prev ? prev.boxScoreText : null,
      _hadPrev: !!prev
    };
  });

  return merged;
}

function esc(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function mergedGamesToJs(merged) {
  if (!merged.length) return '{}';
  return '{' + merged.map((g, i) => {
    const opp = esc(g.opponent);
    const loc = esc(g.location);
    const url = esc(g.boxScoreUrl || '');
    const urlStr = url ? `,boxScoreUrl:'${url}'` : '';
    const bsStr = g.boxScoreText ? `,boxScore:${g.boxScoreText}` : '';
    return `g${i+1}:{date:'${g.date}',opponent:'${opp}',ourScore:${g.ourScore},theirScore:${g.theirScore},result:'${g.result}',location:'${loc}'${urlStr}${bsStr}}`;
  }).join(',') + '}';
}

async function main() {
  console.log('=== 잔여 games 보정 스크립트 시작 ===');

  const browser = await chromium.launch({ headless: true, args: ['--ignore-certificate-errors'] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();

  const results = {};

  for (const target of TARGETS) {
    try {
      const collected = await scrapeTarget(page, target);
      results[target.entryId] = collected;
    } catch (e) {
      console.error(`[${target.entryId}] 에러:`, e.message);
      results[target.entryId] = null;
    }
  }

  await browser.close();

  // Now apply to index.html
  console.log('\n\n===== index.html 업데이트 =====');
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  const summary = [];

  for (const target of TARGETS) {
    const collected = results[target.entryId];
    if (!collected || !collected.length) {
      console.log(`\n[${target.entryId}] skip — 수집 실패 or 0경기`);
      summary.push({ entryId: target.entryId, status: 'skip', before: null, after: null });
      continue;
    }

    const { games: existing } = extractExistingGames(html, target.entryId);
    const merged = buildMergedGames(existing, collected);
    console.log(`\n[${target.entryId}] before: ${existing.length}경기, after: ${merged.length}경기`);

    // Diagnostic: which are new?
    const existingKeys = new Set(existing.map(g => `${g.date}|${g.opponent.replace(/\s+/g,'')}`));
    const newOnes = merged.filter(m => !existingKeys.has(`${m.date}|${m.opponent.replace(/\s+/g,'')}`));
    newOnes.forEach(n => console.log(`   [NEW] ${n.date} vs ${n.opponent} ${n.ourScore}-${n.theirScore} ${n.result}`));
    const existingSet = new Set(existing.map(e => `${e.date}|${e.opponent.replace(/\s+/g,'')}`));
    const collectedSet = new Set(merged.map(m => `${m.date}|${m.opponent.replace(/\s+/g,'')}`));
    const removed = existing.filter(e => !collectedSet.has(`${e.date}|${e.opponent.replace(/\s+/g,'')}`));
    removed.forEach(r => console.log(`   [REMOVED?] ${r.date} vs ${r.opponent} ${r.ourScore}-${r.theirScore} ${r.result}`));

    const gjs = mergedGamesToJs(merged);
    const r = replaceGamesBlock(html, target.entryId, gjs);
    if (r.ok) {
      html = r.html;
      console.log(`   -> games 블록 치환 완료`);
    } else {
      console.log(`   !! games 블록 치환 실패`);
    }

    summary.push({
      entryId: target.entryId,
      status: 'ok',
      before: existing.length,
      after: merged.length,
      newCount: newOnes.length,
      removedCount: removed.length,
      boxScorePreserved: merged.filter(m => m.boxScoreText).length
    });
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] index.html 는 저장하지 않음');
  } else {
    fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  }
  console.log('\n\n===== 요약 =====');
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(e => { console.error(e); process.exit(1); });
