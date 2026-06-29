/**
 * 와인드업 야구 전체 스크래퍼 (2025 + 2026)
 * - ksbsa.or.kr (세종, teamSeq=93): 2025, 2026
 * - donggu.dbsa.kr (동구, teamSeq=70): 2026
 * - gameone.kr (club_idx=7734): 2025 금강토요리그
 *
 * index.html의 ALL_DATA 항목을 재스크래핑한 최신 데이터로 교체합니다.
 * players/pitchers/games 블록을 balance-match 방식으로 안전하게 교체.
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug');
if (!fs.existsSync(DEBUG_DIR)) fs.mkdirSync(DEBUG_DIR);

// ===== TARGETS =====
const TARGETS = [
  { id: '2026_sejong',  kind: 'dbsa',   base: 'https://www.ksbsa.or.kr',  teamSeq: 93, year: 2026 },
  { id: '2026_donggu',  kind: 'dbsa',   base: 'https://donggu.dbsa.kr',   teamSeq: 70, year: 2026 },
  { id: '2025_sejong',  kind: 'dbsa',   base: 'https://www.ksbsa.or.kr',  teamSeq: 93, year: 2025 },
  { id: '2025_gongju',  kind: 'gameone', clubIdx: 7734, year: 2025, leagueMatch: /금강토요/ }
];

const CUR_YEAR = new Date().getFullYear();

// ===== DBSA 계열 스크래핑 =====
async function scrapeDbsaBatters(browser, base, teamSeq, year) {
  const page = await browser.newPage();
  const url = `${base}/teamPage/scheduleRecord/getBatterRecord.hs?teamSeq=${teamSeq}&searchYear=${year}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const players = await page.evaluate(() => {
      // DBSA 계열 타자 테이블 레이아웃:
      // 0:순위  1:"이름 (번호)"  2:AVG  3:G  4:PA  5:AB  6:H
      // 7:2B  8:3B  9:"HR (G홈런)"  10:RBI  11:R  12:SB  13:BB  14:HBP  15:SO
      const tables = document.querySelectorAll('table');
      let targetRows = null;
      tables.forEach(t => {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().split(/\s/)[0]);
        // "순위" 와 "선수명"이 모두 있고 컬럼이 15개 이상인 테이블 선택
        if (ths.includes('순위') && ths.some(h => /선수명/.test(h)) && ths.length >= 15) {
          targetRows = t.querySelectorAll('tbody tr');
        }
      });
      if (!targetRows) targetRows = document.querySelectorAll('table tbody tr');

      const out = [];
      const txt = (el) => {
        if (!el) return '';
        const t = el.textContent;
        return (t == null ? '' : String(t)).trim();
      };
      const numOnly = (s) => {
        const m = (s || '').match(/-?[\d.]+/);
        return m ? parseFloat(m[0]) : 0;
      };
      targetRows.forEach(row => {
        try {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 15) return;
          // 이름 셀 (cells[1])에서 "이름 (번호)" 분리
          const nameRaw = txt(cells[1]);
          const nm = nameRaw.match(/^(.+?)\s*\((\d+)\)/);
          const name = nm ? nm[1].trim() : nameRaw;
          const num = nm ? parseInt(nm[2]) : 0;
          if (!name || /선수명|순위|합계|TOTAL/i.test(name)) return;
          out.push({
            name, num,
            G: numOnly(txt(cells[3])),
            PA: numOnly(txt(cells[4])),
            AB: numOnly(txt(cells[5])),
            H: numOnly(txt(cells[6])),
            '2B': numOnly(txt(cells[7])),
            '3B': numOnly(txt(cells[8])),
            HR: numOnly(txt(cells[9])),
            RBI: numOnly(txt(cells[10])),
            R: numOnly(txt(cells[11])),
            SB: numOnly(txt(cells[12])),
            BB: numOnly(txt(cells[13])),
            HBP: numOnly(txt(cells[14])),
            SO: numOnly(txt(cells[15])),
            kOBP: 0, kSLG: 0, kOPS: 0
          });
        } catch (e) { /* skip bad row */ }
      });
      return out;
    });
    return players;
  } finally { await page.close(); }
}

async function scrapeDbsaPitchers(browser, base, teamSeq, year) {
  const page = await browser.newPage();
  const url = `${base}/teamPage/scheduleRecord/getPitcherRecord.hs?teamSeq=${teamSeq}&searchYear=${year}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const pitchers = await page.evaluate(() => {
      // DBSA 계열 투수 테이블 레이아웃:
      // 0:순위  1:"이름 (번호)"  2:ERA  3:G  4:W  5:L  6:SV  7:IP
      // 8:피안타  9:피홈런  10:BB  11:IBB  12:HBP  13:K  14:R  15:ER
      const tables = document.querySelectorAll('table');
      let targetRows = null;
      tables.forEach(t => {
        const ths = Array.from(t.querySelectorAll('th')).map(th => th.textContent.trim().split(/\s/)[0]);
        if (ths.includes('순위') && ths.some(h => /선수명/.test(h)) && ths.length >= 10) {
          targetRows = t.querySelectorAll('tbody tr');
        }
      });
      if (!targetRows) targetRows = document.querySelectorAll('table tbody tr');

      const out = [];
      const txt = (el) => {
        if (!el) return '';
        const t = el.textContent;
        return (t == null ? '' : String(t)).trim();
      };
      const numOnly = (s) => {
        const m = (s || '').match(/-?[\d.]+/);
        return m ? parseFloat(m[0]) : 0;
      };
      targetRows.forEach(row => {
        try {
          const cells = Array.from(row.querySelectorAll('td'));
          if (cells.length < 10) return;
          const nameRaw = txt(cells[1]);
          const nm = nameRaw.match(/^(.+?)\s*\((\d+)\)/);
          const name = nm ? nm[1].trim() : nameRaw;
          const num = nm ? parseInt(nm[2]) : 0;
          if (!name || /선수명|순위|합계|TOTAL/i.test(name)) return;
          out.push({
            name, num,
            G: numOnly(txt(cells[3])),
            W: numOnly(txt(cells[4])),
            L: numOnly(txt(cells[5])),
            SV: numOnly(txt(cells[6])),
            HD: 0,
            IP: numOnly(txt(cells[7])),
            pH: numOnly(txt(cells[8])),
            pHR: numOnly(txt(cells[9])),
            pBB: numOnly(txt(cells[10])),
            pIBB: numOnly(txt(cells[11])),
            pHBP: numOnly(txt(cells[12])),
            K: numOnly(txt(cells[13])),
            R: numOnly(txt(cells[14])),
            ER: numOnly(txt(cells[15]))
          });
        } catch (e) { /* skip bad row */ }
      });
      return out;
    });
    return pitchers;
  } finally { await page.close(); }
}

// 월별 일정 캘린더(getGameSchedule)에서 와인드업 전 경기(점수/구장/결과) 수집.
// getMain(최근만) / getGameRecord(박스스코어 등록분만)가 놓치는 경기까지 전부 잡는 완전 소스.
async function scrapeDbsaCalendarGames(browser, base, teamSeq, year, fromMonth = 3, toMonth = 11) {
  const page = await browser.newPage();
  const games = [];
  try {
    for (let mo = fromMonth; mo <= toMonth; mo++) {
      const url = `${base}/teamPage/scheduleRecord/getGameSchedule.hs?teamSeq=${teamSeq}&thisYear=${year}&thisMonth=${String(mo).padStart(2, '0')}`;
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(900);
      const days = await page.evaluate(() => {
        const ds = [];
        document.querySelectorAll('td').forEach(td => {
          const dp = td.querySelector('.date'); if (!dp) return;
          if (td.innerHTML.includes('plan') || td.innerHTML.includes('finish')) {
            const n = parseInt(dp.textContent.trim(), 10); if (!isNaN(n)) ds.push(n);
          }
        });
        return [...new Set(ds)];
      });
      for (const d of days) {
       try {
        const ok = await page.evaluate((d) => {
          const tds = [...document.querySelectorAll('td')];
          for (const td of tds) {
            const dp = td.querySelector('.date'); if (!dp) continue;
            if (parseInt(dp.textContent.trim(), 10) !== d) continue;
            if (td.innerHTML.includes('plan') || td.innerHTML.includes('finish')) {
              const a = td.querySelector('a'); if (a) { a.click(); return true; }
            }
          }
          return false;
        }, d);
        if (!ok) continue;
        // 클릭이 네비게이션을 유발할 수 있으므로 안정화 대기 (race 로 컨텍스트 파괴 방지)
        await page.waitForLoadState('domcontentloaded').catch(() => {});
        await page.waitForSelector('.match-list .team-match', { timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        const readDay = () => page.evaluate(() => {
          const out = [];
          document.querySelectorAll('.match-list .team-match').forEach(m => {
            const lName = (m.querySelector('.l-team .team-name')?.textContent || '').trim();
            const rName = (m.querySelector('.r-team .team-name')?.textContent || '').trim();
            if (!/와인드업/.test(lName + rName)) return;
            const lScore = (m.querySelector('.l-team .score')?.textContent || '').trim();
            const rScore = (m.querySelector('.r-team .score')?.textContent || '').trim();
            const md = (m.querySelector('.match-date')?.textContent || '').replace(/\s+/g, ' ').trim();
            const finished = /경기종료/.test(m.textContent || '');
            const detail = m.querySelector('.btn-match-detail')?.closest('a')?.getAttribute('href') || '';
            out.push({ lName, rName, lScore, rScore, md, finished, detail });
          });
          return out;
        });
        let dayGames = [];
        try { dayGames = await readDay(); }
        catch { await page.waitForTimeout(800); try { dayGames = await readDay(); } catch { dayGames = []; } }
        for (const g of dayGames) {
          const dm = g.md.match(/(\d{4})년\s*(\d{2})월\s*(\d{2})일/);
          if (!dm) continue;
          const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
          const tmt = g.md.match(/(\d{2}):(\d{2})/);
          const time = tmt ? `${tmt[1]}:${tmt[2]}` : '';
          const location = g.md.replace(/\d{4}년\s*\d{2}월\s*\d{2}일/, '').replace(/\d{2}:\d{2}/, '').trim();
          const isWindupL = /와인드업/.test(g.lName);
          const opponent = isWindupL ? g.rName : g.lName;
          const ls = parseInt(g.lScore), rs = parseInt(g.rScore);
          let ourScore = null, theirScore = null, result = '예정';
          if (g.finished && !isNaN(ls) && !isNaN(rs)) {
            ourScore = isWindupL ? ls : rs;
            theirScore = isWindupL ? rs : ls;
            result = ourScore > theirScore ? '승' : ourScore < theirScore ? '패' : '무';
          }
          const boxScoreUrl = g.detail ? (g.detail.startsWith('http') ? g.detail : base + g.detail) : '';
          games.push({ date, time, opponent, ourScore, theirScore, result, location, boxScoreUrl });
        }
       } catch (e) { /* 이 날짜 스킵하고 계속 */ }
        // 다음 날짜를 위해 달력 재로드 (클릭으로 페이지가 바뀌었을 수 있음)
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
  } finally { await page.close(); }
  return games;
}

async function scrapeDbsaRecentGames(browser, base, teamSeq, year) {
  // 경기 수집 (date+opponent 로 중복 제거, 캘린더가 가장 완전하므로 우선):
  // 0) getGameSchedule 월별 캘린더 (현재 시즌) — 점수/구장 포함 전 경기
  // 1) getMain.hs 의 .team-match (스코어+박스스코어)
  // 2) getGameRecord.hs 의 경기기록 TR 행
  // 3) getMain.hs 상단 일정 테이블 (예정 경기)
  const all = [];
  // 0) 현재 시즌은 캘린더로 전 경기 수집 (getMain/getGameRecord 가 놓치는 3월 경기 등 보강).
  //    배열 앞쪽에 넣어 중복 제거 시 캘린더의 점수/결과가 우선되도록 함.
  if (year >= CUR_YEAR) {
    try {
      const fromCal = await scrapeDbsaCalendarGames(browser, base, teamSeq, year);
      all.push(...fromCal);
      console.log(`    캘린더 경기 ${fromCal.length}건 수집`);
    } catch (e) {
      console.warn('    ⚠️ 캘린더 스크랩 실패(기존 소스로 진행):', e.message);
    }
  }
  const page = await browser.newPage();
  try {
    // 1) getMain.hs .team-match (과거 경기 + 박스스코어)
    await page.goto(`${base}/teamPage/main/getMain.hs?teamSeq=${teamSeq}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(4000);

    const fromMain = await page.evaluate(({ yr, baseUrl }) => {
      const out = [];
      // 1a) .team-match 과거 경기
      document.querySelectorAll('.team-match').forEach(tm => {
        try {
          const dateText = tm.querySelector('.date')?.textContent.trim() || '';
          const dm = dateText.match(/(\d{4})\.(\d{2})\.(\d{2})/);
          if (!dm) return;
          if (parseInt(dm[1]) !== yr) return;
          const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
          const tm2 = dateText.match(/(\d{2}):(\d{2})/);
          const time = tm2 ? `${tm2[1]}:${tm2[2]}` : '';
          const lName = tm.querySelector('.l-team .team-name')?.textContent.trim() || '';
          const rName = tm.querySelector('.r-team .team-name')?.textContent.trim() || '';
          const lPoint = tm.querySelector('.l-team .point')?.textContent.trim() || '';
          const rPoint = tm.querySelector('.r-team .point')?.textContent.trim() || '';
          const isWindupL = /와인드업/.test(lName);
          const ourScore = parseInt(isWindupL ? lPoint : rPoint);
          const theirScore = parseInt(isWindupL ? rPoint : lPoint);
          const opponent = isWindupL ? rName : lName;
          let result = '예정';
          if (!isNaN(ourScore) && !isNaN(theirScore)) {
            if (ourScore > theirScore) result = '승';
            else if (ourScore < theirScore) result = '패';
            else result = '무';
          }
          const place = tm.querySelector('.stadium-info .place')?.textContent.trim() || '';
          const boxLink = tm.querySelector('.stadium-info a[href*=gameScheduleSeq]');
          let boxScoreUrl = '';
          if (boxLink) {
            const href = boxLink.getAttribute('href') || '';
            boxScoreUrl = href.startsWith('http') ? href : (baseUrl + href);
          }
          out.push({
            date, time, opponent,
            ourScore: isNaN(ourScore) ? null : ourScore,
            theirScore: isNaN(theirScore) ? null : theirScore,
            result, location: place, boxScoreUrl
          });
        } catch(e) {}
      });

      // 1b) 상단 일정 테이블의 예정 경기 (ksbsa 스타일)
      document.querySelectorAll('table tbody tr').forEach(tr => {
        try {
          const cells = Array.from(tr.children).map(c => c.textContent.trim().replace(/\s+/g,' '));
          if (cells.length < 4) return;
          const dm = cells[0].match(/(\d{4})-(\d{2})-(\d{2})/);
          if (!dm) return;
          if (parseInt(dm[1]) !== yr) return;
          const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
          const tm = cells[0].match(/(\d{2}):(\d{2})/);
          const time = tm ? `${tm[1]}:${tm[2]}` : '';
          const team1 = cells[1];
          const vsText = cells[2];
          const team2 = cells[3];
          const sm = vsText.match(/(\d+)\s*VS\s*(\d+)/i);
          const isWindupL = /와인드업/.test(team1);
          const opponent = isWindupL ? team2 : team1;
          if (!/와인드업/.test(team1+team2)) return;
          let ourScore = null, theirScore = null, result = '예정';
          if (sm) {
            const a = parseInt(sm[1]), b = parseInt(sm[2]);
            ourScore = isWindupL ? a : b;
            theirScore = isWindupL ? b : a;
            if (ourScore > theirScore) result = '승';
            else if (ourScore < theirScore) result = '패';
            else result = '무';
          }
          out.push({ date, time, opponent, ourScore, theirScore, result, location: '', boxScoreUrl: '' });
        } catch(e) {}
      });
      return out;
    }, { yr: year, baseUrl: base });
    all.push(...fromMain);

    // 2) getGameRecord.hs의 경기기록 링크 (donggu 스타일)
    await page.goto(`${base}/teamPage/scheduleRecord/getGameRecord.hs?teamSeq=${teamSeq}&searchYear=${year}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(3000);
    const fromRecord = await page.evaluate(({ yr, baseUrl }) => {
      const out = [];
      // 테이블 행 중 경기기록 링크가 있는 행만 파싱
      document.querySelectorAll('table tbody tr').forEach(tr => {
        try {
          const a = tr.querySelector('a[href*=gameScheduleSeq]');
          if (!a) return;
          const cells = Array.from(tr.children).map(c => c.textContent.trim().replace(/\s+/g,' '));
          if (cells.length < 4) return;
          // cells[0]: 날짜/시간, cells[1]: 리그, cells[2]: 장소, cells[3]: 게임, cells[4]: 경기기록
          const dm = cells[0].match(/(\d{4})-(\d{2})-(\d{2})/);
          if (!dm) return;
          if (parseInt(dm[1]) !== yr) return;
          const date = `${dm[1]}-${dm[2]}-${dm[3]}`;
          const tm = cells[0].match(/(\d{2}):(\d{2})/);
          const time = tm ? `${tm[1]}:${tm[2]}` : '';
          const location = cells[2] || '';
          const gameText = cells[3] || '';
          const gm = gameText.match(/^(.+?)\s+(\d+)\s*VS\s*(\d+)\s+(.+?)$/);
          if (!gm) return;
          const team1 = gm[1].trim();
          const score1 = parseInt(gm[2]);
          const score2 = parseInt(gm[3]);
          const team2 = gm[4].trim();
          const isWindupL = /와인드업/.test(team1);
          const opponent = isWindupL ? team2 : team1;
          const ourScore = isWindupL ? score1 : score2;
          const theirScore = isWindupL ? score2 : score1;
          let result = '무';
          if (ourScore > theirScore) result = '승';
          else if (ourScore < theirScore) result = '패';
          const href = a.getAttribute('href') || '';
          const boxScoreUrl = href.startsWith('http') ? href : (baseUrl + href);
          out.push({ date, time, opponent, ourScore, theirScore, result, location, boxScoreUrl });
        } catch(e) {}
      });
      return out;
    }, { yr: year, baseUrl: base });
    all.push(...fromRecord);

    // 중복 제거: date+opponent 키, boxScoreUrl 있는 쪽 우선
    const map = new Map();
    all.forEach(g => {
      const key = g.date + '|' + g.opponent;
      const existing = map.get(key);
      if (!existing) map.set(key, g);
      else {
        // 누락된 필드만 채워 넣고 boxScoreUrl 은 있는 쪽 우선
        if (!existing.time && g.time) existing.time = g.time;
        if (!existing.location && g.location) existing.location = g.location;
        if (!existing.boxScoreUrl && g.boxScoreUrl) {
          existing.boxScoreUrl = g.boxScoreUrl;
        }
      }
    });
    const merged = Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
    return merged;
  } finally { await page.close(); }
}

async function scrapeDbsaGames(browser, base, teamSeq, year) {
  const page = await browser.newPage();
  // getMain.hs의 '경기결과' 탭에서 경기 목록 파싱
  const url = `${base}/teamPage/main/getMain.hs?teamSeq=${teamSeq}`;
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(5000);
    const games = await page.evaluate((yr) => {
      const out = [];
      const rows = document.querySelectorAll('table tr');
      rows.forEach(tr => {
        try {
          const text = (tr.textContent || '').replace(/\s+/g, ' ').trim();
          const m = text.match(/(\d{4})[-.](\d{2})[-.](\d{2}).*?(\d+)\s*:\s*(\d+)/);
          if (!m) return;
          const y = parseInt(m[1]);
          if (y !== yr) return;
          const date = `${m[1]}-${m[2]}-${m[3]}`;
          const tm = text.match(/(\d{2}):(\d{2})/);
          const time = tm ? `${tm[1]}:${tm[2]}` : '';
          const a = parseInt(m[4]);
          const b = parseInt(m[5]);
          const windupLeft = /와인드업\s*\d+\s*:/.test(text) || /^와인드업/.test(text);
          const ourScore = windupLeft ? a : b;
          const theirScore = windupLeft ? b : a;
          // 상대팀: 요일 다음부터 숫자 앞까지
          let opponent = '';
          const opMatch = text.match(/(?:토|일|월|화|수|목|금)\s+(.+?)\s+\d+\s*:/);
          if (opMatch && opMatch[1]) opponent = opMatch[1].trim().replace(/^와인드업\s*/, '');
          let result = '무';
          if (ourScore > theirScore) result = '승';
          else if (ourScore < theirScore) result = '패';
          out.push({ date, time, opponent, ourScore, theirScore, result, location: '' });
        } catch (e) { /* skip bad row */ }
      });
      // 날짜순 정렬
      out.sort((a, b) => a.date.localeCompare(b.date));
      return out;
    }, year);
    return games;
  } finally { await page.close(); }
}

// ===== gameone 스크래핑 =====
async function getGameoneLeagueOption(browser, clubIdx, year, leagueMatch) {
  const page = await browser.newPage();
  try {
    await page.goto(`https://www.gameone.kr/club/info/ranking/hitter?club_idx=${clubIdx}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(2000);
    await page.selectOption('select:first-of-type', String(year)).catch(() => {});
    await page.waitForTimeout(3000);
    // 리그 탭 클릭
    await page.evaluate(() => {
      document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
        if (t.textContent.trim() === '리그') t.click();
      });
    });
    await page.waitForTimeout(2000);
    const opts = await page.evaluate(() => {
      const selects = document.querySelectorAll('select');
      const arr = [];
      selects.forEach(s => {
        Array.from(s.options).forEach(o => {
          try {
            const val = JSON.parse(o.value);
            if (val.lig_idx) arr.push({ text: o.textContent.trim(), value: o.value });
          } catch(e) {}
        });
      });
      return arr;
    });
    const found = opts.find(o => leagueMatch.test(o.text));
    return found || null;
  } finally { await page.close(); }
}

async function scrapeGameoneLeague(browser, clubIdx, year, leagueOpt) {
  // 타자
  const bp = await browser.newPage();
  await bp.goto(`https://www.gameone.kr/club/info/ranking/hitter?club_idx=${clubIdx}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await bp.waitForTimeout(2000);
  await bp.selectOption('select:first-of-type', String(year)).catch(() => {});
  await bp.waitForTimeout(2000);
  if (leagueOpt) {
    await bp.evaluate(() => {
      document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
        if (t.textContent.trim() === '리그') t.click();
      });
    });
    await bp.waitForTimeout(1500);
    await bp.evaluate((val) => {
      document.querySelectorAll('select').forEach(s => {
        Array.from(s.options).forEach(o => {
          if (o.value === val) { s.value = val; s.dispatchEvent(new Event('change')); }
        });
      });
    }, leagueOpt.value);
    await bp.waitForTimeout(3000);
  }
  const bText = await bp.evaluate(() => document.body.innerText);
  await bp.close();

  const sMatch = bText.match(/(\d+)게임\s*승률\s*:\s*([\d.]+)%\s*\(\s*(\d+)승(\d+)패(\d+)무/);
  const summary = sMatch ? { G: +sMatch[1], W: +sMatch[3], L: +sMatch[4], D: +sMatch[5] } : null;

  const bLines = bText.split('\n').filter(l => /^\d+\t/.test(l.trim()));
  const bHalf = bLines.slice(0, Math.ceil(bLines.length / 2));
  const batters = [];
  for (const line of bHalf) {
    const p = line.split('\t');
    if (p.length < 15) continue;
    const nm = p[1].match(/(.+?)\((\d+)\)/);
    if (!nm) continue;
    batters.push({
      name: nm[1], num: parseInt(nm[2]),
      G: +p[3]||0, PA: +p[4]||0, AB: +p[5]||0,
      H: +p[7]||0, '2B': +p[9]||0, '3B': +p[10]||0, HR: +p[11]||0,
      RBI: +p[13]||0, R: +p[6]||0, SB: +p[14]||0,
      BB: 0, HBP: 0, SO: 0
    });
  }

  // 투수
  const pp = await browser.newPage();
  await pp.goto(`https://www.gameone.kr/club/info/ranking/pitcher?club_idx=${clubIdx}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await pp.waitForTimeout(2000);
  await pp.selectOption('select:first-of-type', String(year)).catch(() => {});
  await pp.waitForTimeout(2000);
  if (leagueOpt) {
    await pp.evaluate(() => {
      document.querySelectorAll('.game_tab li a, [class*=tab] li a').forEach(t => {
        if (t.textContent.trim() === '리그') t.click();
      });
    });
    await pp.waitForTimeout(1500);
    await pp.evaluate((val) => {
      document.querySelectorAll('select').forEach(s => {
        Array.from(s.options).forEach(o => {
          if (o.value === val) { s.value = val; s.dispatchEvent(new Event('change')); }
        });
      });
    }, leagueOpt.value);
    await pp.waitForTimeout(3000);
  }
  const pText = await pp.evaluate(() => document.body.innerText);
  await pp.close();

  const pLines = pText.split('\n').filter(l => /^\d+\t/.test(l.trim()));
  const pHalf = pLines.slice(0, Math.ceil(pLines.length / 2));
  const pitchers = [];
  for (const line of pHalf) {
    const p = line.split('\t');
    if (p.length < 15) continue;
    const nm = p[1].match(/(.+?)\((\d+)\)/);
    if (!nm) continue;
    pitchers.push({
      name: nm[1], num: parseInt(nm[2]),
      G: +p[3]||0, W: +p[4]||0, L: +p[5]||0,
      SV: +p[6]||0, HD: +p[7]||0,
      IP: +p[11]||0, pH: +p[12]||0, pHR: 0,
      K: +p[17]||0, pBB: +p[16]||0, pIBB: 0, pHBP: 0,
      R: +p[21]||0, ER: +p[22]||0
    });
  }

  return { batters, pitchers, summary };
}

// ===== JS 리터럴 직렬화 =====
function batterToJs(p, i) {
  // GHR(그라운드 홈런) 은 외부 스크래핑 소스에 없는 수동 입력 필드.
  // 기존 값이 있으면(>0) 그대로 보존, 0/없음 이면 생략하여 데이터 부풀리기 방지.
  const ghrPart = (p.GHR && p.GHR > 0) ? `,GHR:${p.GHR}` : '';
  return `p${i+1}:{name:'${p.name.replace(/'/g,"\\'")}',number:${p.num},G:${p.G},PA:${p.PA},AB:${p.AB},H:${p.H},'2B':${p['2B']},'3B':${p['3B']},HR:${p.HR}${ghrPart},RBI:${p.RBI},R:${p.R},SB:${p.SB},BB:${p.BB},HBP:${p.HBP},SO:${p.SO},kOBP:${p.kOBP||0},kSLG:${p.kSLG||0},kOPS:${p.kOPS||0}}`;
}

// 기존 entryText 의 players 블록에서 name|number → GHR 매핑 추출 (보존용)
function extractExistingGHR(entryText) {
  const map = new Map();
  // players:{...} 블록 안쪽만 검사하기엔 부담스러우니 entryText 전체에서 player 객체 패턴 매칭.
  // name 다음에 number 가 오고 같은 객체 안에 GHR 이 있는 경우만 매칭.
  const re = /name:'([^']+)',number:(\d+)[^}]*?GHR:(\d+)/g;
  let m;
  while ((m = re.exec(entryText)) !== null) {
    map.set(`${m[1]}|${m[2]}`, parseInt(m[3], 10));
  }
  return map;
}
// 기존 entryText 의 games 블록에서 date|opponent → location 매핑 추출 (보존용).
// 예정 경기 구장은 fill-ksbsa-scheduled-locations.js 가 채워넣는데, 일반 스크랩은
// 예정 경기 location 을 '' 로 만들므로, 비어있을 때 기존 값을 살려 덮어쓰기를 막는다.
function extractExistingLocations(entryText) {
  const map = new Map();
  const re = /date:'((?:[^'\\]|\\.)*)'[^}]*?opponent:'((?:[^'\\]|\\.)*)'[^}]*?location:'((?:[^'\\]|\\.)*)'/g;
  let m;
  while ((m = re.exec(entryText)) !== null) {
    const date = m[1].replace(/\\'/g, "'");
    const opponent = m[2].replace(/\\'/g, "'");
    const location = m[3].replace(/\\'/g, "'");
    if (location) map.set(`${date}|${opponent}`, location);
  }
  return map;
}
// 기존 games 블록을 객체로 파싱 (date|opponent → 전체 게임 객체). 완료 경기 보존용.
function extractExistingGames(entryText) {
  const map = new Map();
  const gi = entryText.indexOf('games:');
  if (gi < 0) return map;
  let i = entryText.indexOf('{', gi);
  if (i < 0) return map;
  let depth = 0, j = i;
  for (; j < entryText.length; j++) {
    const c = entryText[j];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) { j++; break; } }
  }
  try {
    const obj = eval('(' + entryText.slice(i, j) + ')');
    Object.values(obj).forEach(g => {
      if (g && g.date && g.opponent) map.set(`${g.date}|${g.opponent}`, g);
    });
  } catch { /* 파싱 실패 시 보존 생략 */ }
  return map;
}
function pitcherToJs(p, i) {
  return `pt${i+1}:{name:'${p.name.replace(/'/g,"\\'")}',number:${p.num},G:${p.G},W:${p.W},L:${p.L},SV:${p.SV},HD:${p.HD},IP:${p.IP},pH:${p.pH},pHR:${p.pHR||0},K:${p.K},pBB:${p.pBB},pIBB:${p.pIBB||0},pHBP:${p.pHBP||0},R:${p.R},ER:${p.ER}}`;
}
function gameToJs(g, i) {
  const opp = (g.opponent||'').replace(/'/g,"\\'");
  const loc = (g.location||'').replace(/'/g,"\\'");
  const osc = g.ourScore == null ? 'null' : g.ourScore;
  const tsc = g.theirScore == null ? 'null' : g.theirScore;
  const time = g.time ? `,time:'${g.time.replace(/'/g,"\\'")}'` : '';
  const box = g.boxScoreUrl ? `,boxScoreUrl:'${g.boxScoreUrl.replace(/'/g,"\\'")}'` : '';
  // boxScore(이닝별 상세)는 별도 스크래퍼가 채우는 무거운 객체. 재구성 시 잃지 않도록
  // 있으면 JSON 으로 그대로 직렬화해 보존 (eval/JSON 모두 파싱 가능).
  const bs = g.boxScore ? `,boxScore:${JSON.stringify(g.boxScore)}` : '';
  return `g${i+1}:{date:'${g.date}'${time},opponent:'${opp}',ourScore:${osc},theirScore:${tsc},result:'${g.result}',location:'${loc}'${box}${bs}}`;
}

function playersBlock(batters) {
  if (!batters || !batters.length) return '{}';
  return '{' + batters.map((p,i) => batterToJs(p,i)).join(',') + '}';
}
function pitchersBlock(pitchers) {
  if (!pitchers || !pitchers.length) return '{}';
  return '{' + pitchers.map((p,i) => pitcherToJs(p,i)).join(',') + '}';
}
function gamesBlock(games) {
  if (!games || !games.length) return '{}';
  return '{' + games.map((g,i) => gameToJs(g,i)).join(',') + '}';
}

// ===== balance-match {} 치환 =====
function replaceBalanced(text, key, startIdx, replacement) {
  // text에서 startIdx 이후의 "key:{...}"를 찾아서 { } 균형맞춰 치환
  const re = new RegExp(`${key}\\s*:\\s*\\{`, 'g');
  re.lastIndex = startIdx;
  const m = re.exec(text);
  if (!m) return null;
  const openIdx = m.index + m[0].length - 1; // { position
  let depth = 1;
  let inStr = false;
  let strCh = '';
  let esc = false;
  for (let i = openIdx + 1; i < text.length; i++) {
    const c = text[i];
    if (esc) { esc = false; continue; }
    if (c === '\\' && inStr) { esc = true; continue; }
    if (inStr) {
      if (c === strCh) inStr = false;
      continue;
    }
    if (c === "'" || c === '"') { inStr = true; strCh = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const before = text.substring(0, m.index);
        const after = text.substring(i + 1);
        return before + `${key}:${replacement}` + after;
      }
    }
  }
  return null;
}

function findEntrySpan(text, entryId) {
  const re = new RegExp(`id\\s*:\\s*['"]${entryId}['"]`);
  const m = re.exec(text);
  if (!m) return null;
  // 엔트리의 열린 { 로 거슬러 올라가기
  let i = m.index;
  while (i > 0 && text[i] !== '{') i--;
  // 균형 매칭으로 닫는 } 찾기
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
  return { start: i, end: j }; // j는 닫는 } 다음 위치
}

function updateEntryInHtml(html, entryId, data) {
  const span = findEntrySpan(html, entryId);
  if (!span) {
    console.warn(`  [${entryId}] 엔트리 못 찾음`);
    return html;
  }
  let entryText = html.substring(span.start, span.end);

  if (data.players) {
    // 기존 entry 의 GHR 값 보존 — 외부 소스에는 그라운드 홈런 정보가 없으므로
    // 매번 스크래핑 시 덮어쓰지 않도록 player name+number 키로 merge.
    const existingGHR = extractExistingGHR(entryText);
    if (existingGHR.size > 0) {
      data.players.forEach(p => {
        const key = `${p.name}|${p.num}`;
        if (existingGHR.has(key)) p.GHR = existingGHR.get(key);
      });
    }
    const newText = replaceBalanced(entryText, 'players', 0, playersBlock(data.players));
    if (newText) entryText = newText;
  }
  if (data.pitchers) {
    const newText = replaceBalanced(entryText, 'pitchers', 0, pitchersBlock(data.pitchers));
    if (newText) entryText = newText;
  }
  if (data.games && data.games.length > 0) {
    // 기존에 채워진 예정 경기 구장 보존 — 새 스크랩이 location:'' 로 덮어쓰지 않도록
    const existingLoc = extractExistingLocations(entryText);
    if (existingLoc.size > 0) {
      data.games.forEach(g => {
        if (!g.location) {
          const k = `${g.date}|${g.opponent}`;
          if (existingLoc.has(k)) g.location = existingLoc.get(k);
        }
      });
    }
    // 완료 경기 보존 — 이번 스크랩이 놓친 기존 완료 경기를 잃지 않도록 병합 (소스 일시 누락 방어)
    const existingGames = extractExistingGames(entryText);
    if (existingGames.size > 0) {
      // 기존 boxScore(상세)·boxScoreUrl 보존 — 캘린더 재구성이 상세를 날리지 않도록
      data.games.forEach(g => {
        const ex = existingGames.get(`${g.date}|${g.opponent}`);
        if (!ex) return;
        if (!g.boxScore && ex.boxScore) g.boxScore = ex.boxScore;
        if (!g.boxScoreUrl && ex.boxScoreUrl) g.boxScoreUrl = ex.boxScoreUrl;
      });
      const haveKeys = new Set(data.games.map(g => `${g.date}|${g.opponent}`));
      existingGames.forEach((g, k) => {
        if (!haveKeys.has(k) && g.result && g.result !== '예정') data.games.push(g);
      });
    }
    data.games.sort((a, b) => (a.date || '').localeCompare(b.date || ''));
    const newText = replaceBalanced(entryText, 'games', 0, gamesBlock(data.games));
    if (newText) entryText = newText;
  }
  // W/L/D/G 업데이트 (summary가 있을 때만)
  if (data.summary) {
    const { W, L, D, G } = data.summary;
    entryText = entryText.replace(/\bW\s*:\s*\d+/, `W:${W}`)
                         .replace(/\bL\s*:\s*\d+/, `L:${L}`)
                         .replace(/\bD\s*:\s*\d+/, `D:${D}`)
                         .replace(/\bG\s*:\s*\d+/, `G:${G}`);
    const recordNew = `${W}승 ${L}패${D ? ' ' + D + '무' : ''}`;
    entryText = entryText.replace(/record\s*:\s*'[^']*'/, `record:'${recordNew}'`);
  }

  return html.substring(0, span.start) + entryText + html.substring(span.end);
}

// ===== 메인 =====
async function main() {
  console.log('=== 와인드업 전체 스크래핑 시작 ===');
  console.log(new Date().toISOString());

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const originalHtml = html;
  const summary = [];

  for (const t of TARGETS) {
    console.log(`\n[${t.id}]`);
    try {
      let data = {};
      if (t.kind === 'dbsa') {
        const batters  = await scrapeDbsaBatters(browser, t.base, t.teamSeq, t.year);
        const pitchers = await scrapeDbsaPitchers(browser, t.base, t.teamSeq, t.year);
        const games    = await scrapeDbsaRecentGames(browser, t.base, t.teamSeq, t.year);
        console.log(`  타자 ${batters.length}, 투수 ${pitchers.length}, 경기 ${games.length} (박스스코어 ${games.filter(g => g.boxScoreUrl).length})`);
        data = { players: batters, pitchers, games, summary: null };
      } else if (t.kind === 'gameone') {
        const leagueOpt = await getGameoneLeagueOption(browser, t.clubIdx, t.year, t.leagueMatch);
        if (!leagueOpt) {
          console.warn(`  리그 옵션 못 찾음 (${t.leagueMatch})`);
          continue;
        }
        console.log(`  리그: ${leagueOpt.text}`);
        const { batters, pitchers, summary: s } = await scrapeGameoneLeague(browser, t.clubIdx, t.year, leagueOpt);
        console.log(`  타자 ${batters.length}, 투수 ${pitchers.length}, 기록 ${s ? s.W+'W'+s.L+'L'+s.D+'D' : 'n/a'}`);
        data = { players: batters, pitchers, games: null, summary: s };
      }

      // 디버그 백업
      fs.writeFileSync(path.join(DEBUG_DIR, `${t.id}.json`), JSON.stringify(data, null, 2), 'utf-8');

      // 빈 데이터면 스킵 (사이트 오류로 데이터 못 가져오면 기존 유지)
      if ((!data.players || data.players.length === 0) && (!data.pitchers || data.pitchers.length === 0)) {
        console.warn(`  ⚠️ 스크래핑 실패 - 기존 데이터 유지`);
        summary.push(`${t.id}: 실패`);
        continue;
      }

      html = updateEntryInHtml(html, t.id, data);
      summary.push(`${t.id}: 타자 ${data.players?.length||0} / 투수 ${data.pitchers?.length||0} / 경기 ${data.games?.length||0}`);
    } catch (e) {
      console.error(`  에러: ${e.message}`);
      summary.push(`${t.id}: 에러 ${e.message}`);
    }
  }

  await browser.close();

  if (html !== originalHtml) {
    fs.writeFileSync(INDEX_FILE, html, 'utf-8');
    console.log('\n✅ index.html 업데이트 완료');
  } else {
    console.log('\n⚠️ 변경사항 없음');
  }

  console.log('\n=== 요약 ===');
  summary.forEach(s => console.log('  ' + s));
}

main().catch(err => { console.error(err); process.exit(1); });
