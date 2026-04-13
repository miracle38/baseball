/**
 * 와인드업 개별 경기 스크래퍼 (schedule/table)
 * - 연도별 https://www.gameone.kr/club/info/schedule/table?club_idx=7734&season=YYYY
 * - 모든 경기의 날짜/분류/스코어 파싱
 * - 분류(리그명)로 엔트리에 매칭해서 games{} + seasonSummary(RS/RA) 주입
 * - 순위 스크래퍼 다음에 실행 (seasonSummary 덮어쓰기)
 */
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');
const CLUB_IDX = 7734;

// 엔트리 id → 분류 텍스트 매칭 (실제 gameone 분류 문자열 기준)
// 공백/괄호 유의. RegExp 또는 {pattern, exclude}
const CATEGORY_MATCHERS = {
  // 2025
  '2025_gongju':          /금강토요/,
  // 2022: "토요4부" / "토요4부(B조)" / "토요4부(후반기)..."
  '2022_daedeok':         /^토요4부\(B조\)$/,
  '2022_sejong_1':        /^토요4부$/,
  '2022_sejong_2':        /후반기/,
  // 2021: "토요 4부" / "토요4부" / "평일 4부(후반기)" / "토요 4부(후반기)..."
  '2021_daedeok':         /^토요4부$|^토요4부\(A조\)$/,
  '2021_sejong_1':        /^토요\s4부$/,
  '2021_sejong_weekday':  /평일\s*4부/,
  '2021_sejong_2':        /토요\s*4부\(후반기\)/,
  // 2020: "토요4부" / "토요3부"
  '2020_daejeon':         /^토요3부$/,
  '2020_sejong':          /^토요4부$/,
  // 2019: "토요3부(B조)" / "토요 4부"
  '2019_daejeon':         /토요3부/,
  '2019_sejong':          /토요\s*4부/,
  // 2018: "토요3부리그(토요3부A조)" / "토요리그"
  '2018_donggu':          /^토요리그$/,
  '2018_daejeon':         /토요3부리그/,
  // 2017: 국민 토요나눔, 토요어울, 대전 토요3부
  '2017_kukmin_nanum':    /토요\s*나눔/,
  '2017_kukmin_eoul':     /토요\s*어울/,
  '2017_daejeon':         { pattern: /토요3부/, exclude: /나눔|어울/ },
  // 2016: 대덕구 토요3부B, 대전 토요금강
  '2016_daedeok':         /토요\s*3부\s*B/,
  '2016_daejeon_geumgang':{ pattern: /토요금강/, exclude: /일요/ },
  // 2015: 동구 태백기, 대전 토요금강기
  '2015_donggu_taebaek':  /태백|동구|^한밭리그$/,
  '2015_daejeon_geumgang':/토요금강/,
  // 2014: 추계 토요금강, 명품리그
  '2014_kukmin_chugye':   /추계/,
  '2014_myeongpum':       /명품/,
  // 2013: 추계, 명품
  '2013_kukmin_chugye':   /추계/,
  '2013_myeongpum':       /명품/,
  // 2012: 추계, 대전 토요리그
  '2012_kukmin_chugye':   /추계/,
  '2012_daejeon':         { pattern: /대전|토요/, exclude: /추계/ },
  // 2011, 2010: 전체 금강
  '2011_geumgang':        /./,
  '2010_geumgang':        /./
};

async function scrapeSeasonGames(browser, year) {
  const page = await browser.newPage();
  try {
    const allGames = [];
    let maxPage = 1;
    for (let p = 1; p <= maxPage; p++) {
      const url = `https://www.gameone.kr/club/info/schedule/table?season=${year}&club_idx=${CLUB_IDX}&game_type=0&lig_idx=0&group=0&month=0&page=${p}`;
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      if (p === 1) {
        // 마지막 페이지 번호 추출
        maxPage = await page.evaluate(() => {
          const links = Array.from(document.querySelectorAll('a'));
          const pageNums = links
            .map(a => {
              const m = a.href.match(/[?&]page=(\d+)/);
              return m ? parseInt(m[1]) : 0;
            })
            .filter(n => n > 0);
          return pageNums.length > 0 ? Math.max(...pageNums) : 1;
        });
      }

      const pageGames = await page.evaluate(() => {
        const out = [];
        const tables = document.querySelectorAll('table');
        tables.forEach(t => {
          t.querySelectorAll('tbody tr').forEach(tr => {
            const cells = Array.from(tr.children).map(c => c.textContent.trim().replace(/\s+/g, ' '));
            if (cells.length < 4) return;
            if (cells[0] === '일시' || cells[1] === '분류') return;
            const dateTime = cells[0];
            const category = cells[1];
            const stadium = cells[2];
            const game = cells[3];
            const result = cells[4] || '';
            const dm = dateTime.match(/(\d{1,2})월\s*(\d{1,2})일/);
            if (!dm) return;
            const month = dm[1].padStart(2, '0');
            const day = dm[2].padStart(2, '0');
            out.push({ dateTime, month, day, category, stadium, game, result });
          });
        });
        return out;
      });
      allGames.push(...pageGames);
    }
    return allGames;
  } finally { await page.close(); }
}

function parseGameString(gameStr, year, month, day) {
  // "팀A 숫자 팀B 숫자" 또는 "팀A 숫자 팀B 콜드승 숫자" / "팀A 몰수승 숫자 팀B 숫자" 등
  const windupIdx = gameStr.indexOf('와인드업');
  if (windupIdx < 0) return null;

  // 숫자 토큰 위치 찾기
  const tokens = gameStr.split(/\s+/);
  let windupTokenIdx = -1;
  tokens.forEach((t, i) => { if (t === '와인드업') windupTokenIdx = i; });
  if (windupTokenIdx < 0) return null;

  // 숫자 토큰들을 위치 기록
  const numToken = (s) => /^\d+$/.test(s);

  // 와인드업 오른쪽에 붙은 승리형 키워드 (콜드승, 몰수승, 포기승 등) 처리
  let windupKeyword = '';
  let windupScoreIdx = -1;
  for (let i = windupTokenIdx + 1; i < tokens.length; i++) {
    if (/^(콜드승|콜드패|몰수승|포기승|몰수패)$/.test(tokens[i])) {
      windupKeyword = tokens[i];
      continue;
    }
    if (numToken(tokens[i])) { windupScoreIdx = i; break; }
  }

  // 상대편 점수는 게임 문자열의 나머지 숫자
  let opponentScoreIdx = -1;
  for (let i = 0; i < tokens.length; i++) {
    if (i !== windupScoreIdx && numToken(tokens[i])) {
      // 앞뒤 맥락에 와인드업 아닌 팀 이름이 있는지 확인 (첫 숫자 토큰 선택)
      opponentScoreIdx = i;
      break;
    }
  }

  if (windupScoreIdx < 0 || opponentScoreIdx < 0) return null;

  const windupScore = parseInt(tokens[windupScoreIdx]);
  const opponentScore = parseInt(tokens[opponentScoreIdx]);

  // 상대팀 이름 추출: 와인드업 / 와인드업 스코어 / 상대 스코어 경계
  // 쉽게: 와인드업 토큰 제외 + 와인드업 스코어 제외 + 키워드(콜드승 등) 제외 + 상대 스코어 제외
  const opponentTokens = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i === windupTokenIdx || i === windupScoreIdx || i === opponentScoreIdx) continue;
    if (/^(콜드승|콜드패|몰수승|포기승|몰수패)$/.test(tokens[i])) continue;
    opponentTokens.push(tokens[i]);
  }
  const opponent = opponentTokens.join(' ').trim();

  let result = '무';
  if (windupScore > opponentScore) result = '승';
  else if (windupScore < opponentScore) result = '패';

  return {
    date: `${year}-${month}-${day}`,
    opponent,
    ourScore: windupScore,
    theirScore: opponentScore,
    result,
    keyword: windupKeyword || null
  };
}

function matchesCategory(matcher, categoryText) {
  if (matcher instanceof RegExp) return matcher.test(categoryText);
  if (typeof matcher === 'object' && matcher.pattern) {
    if (matcher.exclude && matcher.exclude.test(categoryText)) return false;
    return matcher.pattern.test(categoryText);
  }
  return false;
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

function replaceField(text, fieldRe, newValue) {
  const m = fieldRe.exec(text);
  if (!m) return null;
  const startIdx = m.index + m[0].length - 1;
  const openChar = text[startIdx];
  if (openChar !== '{' && openChar !== '[') {
    // 단순 값 (null, 숫자, 문자열)
    // 종료까지 (콤마 또는 닫는 } 까지)
    let k = m.index + m[0].length;
    while (k < text.length && !/[,}]/.test(text[k])) k++;
    return text.substring(0, m.index) + newValue + text.substring(k);
  }
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 1, k = startIdx + 1;
  let inStr = false, strCh = '', esc = false;
  while (k < text.length && depth > 0) {
    const c = text[k];
    if (esc) { esc = false; k++; continue; }
    if (c === '\\' && inStr) { esc = true; k++; continue; }
    if (inStr) { if (c === strCh) inStr = false; k++; continue; }
    if (c === "'" || c === '"') { inStr = true; strCh = c; k++; continue; }
    if (c === openChar) depth++;
    else if (c === closeChar) depth--;
    k++;
  }
  return text.substring(0, m.index) + newValue + text.substring(k);
}

function gamesToJs(games) {
  if (!games || !games.length) return '{}';
  return '{' + games.map((g, i) => {
    const opp = (g.opponent || '').replace(/'/g, "\\'").replace(/\(/g, '(').replace(/\)/g, ')');
    const loc = (g.location || '').replace(/'/g, "\\'");
    return `g${i+1}:{date:'${g.date}',opponent:'${opp}',ourScore:${g.ourScore},theirScore:${g.theirScore},result:'${g.result}',location:'${loc}'}`;
  }).join(',') + '}';
}

function seasonSummaryToJs(s) {
  return `{rank:${s.rank||0},G:${s.G},W:${s.W},L:${s.L},D:${s.D},RS:${s.RS},RA:${s.RA}}`;
}

function updateEntry(html, entryId, games, seasonSummary) {
  const span = findEntrySpan(html, entryId);
  if (!span) { console.warn(`  [${entryId}] 엔트리 못 찾음`); return html; }
  let entryText = html.substring(span.start, span.end);

  // games 교체
  if (games) {
    const gjs = gamesToJs(games);
    const r = replaceField(entryText, /games\s*:\s*(\{|null|\[)/, `games:${gjs}`);
    if (r) entryText = r;
  }

  // seasonSummary 교체/삽입
  if (seasonSummary) {
    const sjs = seasonSummaryToJs(seasonSummary);
    const r = replaceField(entryText, /seasonSummary\s*:\s*(\{|null)/, `seasonSummary:${sjs}`);
    if (r) entryText = r;
    else {
      // 없으면 추가
      const ptr = entryText.match(/,?\s*(rankings|players)\s*:/);
      if (ptr) {
        entryText = entryText.substring(0, ptr.index) + `, seasonSummary:${sjs}` + entryText.substring(ptr.index);
      }
    }
  }

  return html.substring(0, span.start) + entryText + html.substring(span.end);
}

async function main() {
  console.log('=== 경기 전수 스크래퍼 ===');

  let html = fs.readFileSync(INDEX_FILE, 'utf-8');
  const m = html.match(/const ALL_DATA = (\[[\s\S]*?\n\]);/);
  if (!m) { console.error('ALL_DATA 못 찾음'); process.exit(1); }
  let DATA; eval('DATA = ' + m[1]);

  // gameone 소스 엔트리만 대상
  const targets = DATA.filter(e => e.source === 'gameone.kr');
  const years = [...new Set(targets.map(e => e.year))].sort();
  console.log(`연도: ${years.join(', ')}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--ignore-certificate-errors', '--no-sandbox']
  });

  const debugDir = path.join(__dirname, '..', 'scrape_debug', 'games');
  if (!fs.existsSync(debugDir)) fs.mkdirSync(debugDir, { recursive: true });

  const summary = [];

  for (const year of years) {
    console.log(`\n=== ${year} ===`);
    let rawGames;
    try { rawGames = await scrapeSeasonGames(browser, year); }
    catch(e) { console.warn(`  스케줄 조회 실패: ${e.message}`); continue; }
    console.log(`  ${rawGames.length}개 행`);

    // 이번 년도의 엔트리들
    const yearEntries = targets.filter(e => e.year === year);

    // 각 게임을 엔트리에 매칭
    const byEntry = {};
    yearEntries.forEach(e => byEntry[e.id] = []);

    for (const g of rawGames) {
      const parsed = parseGameString(g.game, year, g.month, g.day);
      if (!parsed) continue;
      // location은 stadium
      parsed.location = g.stadium;

      // 엔트리 매칭 (가장 구체적인 매처 먼저: exclude 있는 것 우선)
      let matched = null;
      for (const e of yearEntries) {
        const matcher = CATEGORY_MATCHERS[e.id];
        if (matcher && matchesCategory(matcher, g.category)) {
          matched = e;
          break;
        }
      }
      if (!matched) continue;
      byEntry[matched.id].push({ ...parsed, category: g.category });
    }

    fs.writeFileSync(path.join(debugDir, `${year}.json`), JSON.stringify(byEntry, null, 2), 'utf-8');

    // 각 엔트리에 반영
    for (const entry of yearEntries) {
      const games = byEntry[entry.id];
      if (!games || games.length === 0) {
        summary.push(`${entry.id}: 매칭 게임 0`);
        continue;
      }

      // 날짜순 정렬 (최신순)
      games.sort((a, b) => b.date.localeCompare(a.date));

      // RS/RA 합산 (득점/실점은 게임 스코어 합산이 정확)
      let RS=0, RA=0, gW=0, gL=0, gD=0;
      games.forEach(g => {
        if (g.result === '승') gW++;
        else if (g.result === '패') gL++;
        else gD++;
        RS += g.ourScore;
        RA += g.theirScore;
      });

      // W/L/D/G는 ① 기존 seasonSummary(순위 탭에서 온 공식 기록) 우선,
      // ② 없으면 게임 합산치, ③ 없으면 entry.W/L/D/G
      let rank, W, L, D, G;
      if (entry.seasonSummary && entry.seasonSummary.W != null) {
        rank = entry.seasonSummary.rank;
        W = entry.seasonSummary.W;
        L = entry.seasonSummary.L;
        D = entry.seasonSummary.D;
        G = entry.seasonSummary.G;
      } else if (entry.W != null) {
        rank = 0;
        W = entry.W; L = entry.L || 0; D = entry.D || 0; G = entry.G || (W+L+D);
      } else {
        rank = 0; W = gW; L = gL; D = gD; G = games.length;
      }

      const ss = { rank, G, W, L, D, RS, RA };

      html = updateEntry(html, entry.id, games, ss);
      console.log(`  [${entry.id}]: ${G}경기 ${W}-${L}-${D} RS${RS}/RA${RA}`);
      summary.push(`${entry.id}: ${G}경기 ${W}-${L}-${D} RS${RS}/RA${RA}`);
    }
  }

  await browser.close();

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log('\n✅ 완료');
  console.log('\n=== 요약 ===');
  summary.forEach(s => console.log('  ' + s));
}

main().catch(err => { console.error(err); process.exit(1); });
