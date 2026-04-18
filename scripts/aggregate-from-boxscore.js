/**
 * Phase 3 보정 스크립트 — 시장기/교류전 4개 엔트리의 players/pitchers 를
 * games{} 내 boxScore 의 우리팀 batters/pitchers 합산으로 생성.
 *
 * 대상 엔트리: 2025_sejong_cup1, 2025_sejong_cup2, 2023_sejong_po, 2023_sejong_inter
 *
 * 판정 규칙:
 *   각 game.boxScore 에 대해:
 *     - awayTeam 또는 homeTeam 에 '와인드업' 포함되어야 유효한 우리팀 게임.
 *     - 우리팀 = 와인드업 측 (away 또는 home).
 *     - awayBatters / homeBatters / awayPitchers / homePitchers 는 그대로 사용.
 *   유효하지 않으면 스킵 + 보고.
 *
 * 집계 필드:
 *   타자: G(출장게임수, 1=참여,0=불참), PA, AB, H, 2B(없음-세부는 없음), 3B(없음), HR(없음), RBI, R, SB, BB(없음 from basic), HBP(없음), SO(없음)
 *
 *   주의: ksbsa 박스스코어의 타자 테이블에는 2B/3B/HR/BB/HBP/SO 가 개별 컬럼으로는 없음.
 *       있는 필드는 PA, AB, H, RBI, R, SB, AVG. 따라서 집계값도 그 범위로 제한한다.
 *       2B/3B/HR/BB/HBP/SO 는 0 으로 채움(미집계).
 *
 *   투수: G, W(decision=승), L(decision=패), SV, HD, IP, pH, pHR, K, pBB, pIBB, pHBP, R, ER
 *       ksbsa 투수 테이블 필드: role, decision, IP, BF, NP, AB, H, HR, BB, SO, R, ER, ERA
 *       매핑: IP→IP(float), pH→H, pHR→HR, K→SO, pBB→BB, pHBP→0(없음), R→R, ER→ER
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const INDEX_FILE = path.join(__dirname, '..', 'index.html');

const TARGETS = ['2025_sejong_cup1', '2025_sejong_cup2', '2023_sejong_po', '2023_sejong_inter'];

function loadAllData() {
  const HTML = fs.readFileSync(INDEX_FILE, 'utf8');
  const sr = /const\s+ALL_DATA\s*=\s*\[/;
  const sm = HTML.match(sr);
  const startIdx = sm.index + sm[0].length - 1;
  let depth = 0, i = startIdx, inStr = false, strCh = '', prev = '';
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else { if (c === '\'' || c === '"' || c === '`') { inStr = true; strCh = c; }
      else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } } }
    prev = c;
  }
  return { HTML, DATA: vm.runInNewContext('(' + HTML.slice(startIdx, i) + ')') };
}

function escStr(s) { return (s || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

function aggregateEntry(entry) {
  const playerMap = new Map();
  const pitcherMap = new Map();
  const skipNotes = [];
  let gamesUsed = 0, gamesSkipped = 0;

  for (const [gk, g] of Object.entries(entry.games || {})) {
    const bs = g.boxScore;
    if (!bs) {
      skipNotes.push(`${gk}: boxScore 없음`);
      gamesSkipped++; continue;
    }
    const awayIsUs = /와인드업/.test(bs.awayTeam || '');
    const homeIsUs = /와인드업/.test(bs.homeTeam || '');
    if (!awayIsUs && !homeIsUs) {
      skipNotes.push(`${gk}: ${bs.awayTeam} vs ${bs.homeTeam} (우리팀 아님)`);
      gamesSkipped++; continue;
    }
    const ourBatters = awayIsUs ? (bs.awayBatters || []) : (bs.homeBatters || []);
    const ourPitchers = awayIsUs ? (bs.awayPitchers || []) : (bs.homePitchers || []);
    if (ourBatters.length === 0 && ourPitchers.length === 0) {
      skipNotes.push(`${gk}: batters/pitchers 비어있음(기록없음)`);
      gamesSkipped++; continue;
    }
    gamesUsed++;

    // Batter 집계
    for (const b of ourBatters) {
      const key = `${b.name}#${b.number || 0}`;
      if (!playerMap.has(key)) {
        playerMap.set(key, {
          name: b.name, number: b.number || 0, G: 0, PA: 0, AB: 0, H: 0,
          '2B': 0, '3B': 0, HR: 0, RBI: 0, R: 0, SB: 0, BB: 0, HBP: 0, SO: 0,
          _games: new Set()
        });
      }
      const p = playerMap.get(key);
      p._games.add(gk);
      p.PA += (b.PA || 0);
      p.AB += (b.AB || 0);
      p.H += (b.H || 0);
      p.RBI += (b.RBI || 0);
      p.R += (b.R || 0);
      p.SB += (b.SB || 0);
      // 2B/3B/HR/BB/HBP/SO 개별 필드 없음 → 미집계(0 유지)
    }

    // Pitcher 집계
    for (const pt of ourPitchers) {
      const key = `${pt.name}#${pt.number || 0}`;
      if (!pitcherMap.has(key)) {
        pitcherMap.set(key, {
          name: pt.name, num: pt.number || 0, G: 0, W: 0, L: 0, SV: 0, HD: 0,
          IP: 0, pH: 0, pHR: 0, K: 0, pBB: 0, pIBB: 0, pHBP: 0, R: 0, ER: 0,
          _games: new Set()
        });
      }
      const p = pitcherMap.get(key);
      p._games.add(gk);
      if (pt.decision === '승') p.W++;
      else if (pt.decision === '패') p.L++;
      else if (pt.decision === '세') p.SV++;
      else if (pt.decision === '홀드' || pt.decision === '홀') p.HD++;
      p.IP += parseFloat(pt.IP) || 0;
      p.pH += (pt.H || 0);
      p.pHR += (pt.HR || 0);
      p.K += (pt.SO || 0);
      p.pBB += (pt.BB || 0);
      // IBB/HBP: 박스스코어에 컬럼 없음
      p.R += (pt.R || 0);
      p.ER += (pt.ER || 0);
    }
  }

  // G 채우기
  for (const p of playerMap.values()) { p.G = p._games.size; delete p._games; }
  for (const p of pitcherMap.values()) { p.G = p._games.size; delete p._games; }

  return {
    players: Array.from(playerMap.values()),
    pitchers: Array.from(pitcherMap.values()),
    gamesUsed, gamesSkipped, skipNotes
  };
}

function buildPlayersJs(players) {
  if (!players || players.length === 0) return '{}';
  return '{' + players.map((p, i) => {
    let s = `p${i+1}:{name:'${escStr(p.name)}',number:${p.number}`;
    ['G','PA','AB','H','2B','3B','HR','RBI','R','SB','BB','HBP','SO'].forEach(k => {
      const key = /^\d/.test(k) ? `'${k}'` : k;
      s += `,${key}:${p[k]||0}`;
    });
    return s + '}';
  }).join(',') + '}';
}

function buildPitchersJs(pitchers) {
  if (!pitchers || pitchers.length === 0) return '{}';
  return '{' + pitchers.map((p, i) => {
    // IP은 float로 저장 (소수는 야구 이닝 관례지만 기존 코드와 동일하게 float)
    const ipVal = Math.round(p.IP * 100) / 100;
    let s = `pt${i+1}:{name:'${escStr(p.name)}',num:${p.num}`;
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
  if (!span) return { html, ok: false };
  const entryText = html.substring(span.start, span.end);
  const blockRe = new RegExp(blockName + '\\s*:\\s*\\{');
  const bm = blockRe.exec(entryText);
  if (!bm) return { html, ok: false };
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
  return { html: html.substring(0, span.start) + newEntryText + html.substring(span.end), ok: true };
}

function main() {
  const { DATA } = loadAllData();
  let html = fs.readFileSync(INDEX_FILE, 'utf-8');

  console.log('=== Phase 3: box score 집계 ===');
  const report = [];

  for (const entryId of TARGETS) {
    const entry = DATA.find(e => e.id === entryId);
    if (!entry) { console.log(`\n[${entryId}] 엔트리 없음`); report.push({ id: entryId, status: 'not_found' }); continue; }

    const { players, pitchers, gamesUsed, gamesSkipped, skipNotes } = aggregateEntry(entry);
    console.log(`\n[${entryId}] gamesUsed=${gamesUsed}, gamesSkipped=${gamesSkipped}`);
    for (const n of skipNotes) console.log(`    - ${n}`);
    console.log(`    → 집계 결과: 타자 ${players.length}명, 투수 ${pitchers.length}명`);

    if (players.length > 0 || pitchers.length > 0) {
      // players 치환
      const r1 = replaceBlock(html, entryId, 'players', buildPlayersJs(players));
      if (r1.ok) { html = r1.html; console.log(`    ✓ players 치환`); }
      else console.log(`    ✗ players 치환 실패`);
      const r2 = replaceBlock(html, entryId, 'pitchers', buildPitchersJs(pitchers));
      if (r2.ok) { html = r2.html; console.log(`    ✓ pitchers 치환`); }
      else console.log(`    ✗ pitchers 치환 실패`);
      report.push({ id: entryId, status: 'ok', players: players.length, pitchers: pitchers.length, gamesUsed, gamesSkipped });
    } else {
      report.push({ id: entryId, status: 'no_data', gamesUsed, gamesSkipped, skipNotes });
    }
  }

  fs.writeFileSync(INDEX_FILE, html, 'utf-8');
  console.log('\n=== 요약 ===');
  for (const r of report) console.log(' ', JSON.stringify(r));
}

main();
