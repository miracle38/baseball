// validate-all-data.js — index.html 의 ALL_DATA 에 대한 데이터 정합성 검증
// 사용법: node scripts/validate-all-data.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// ALL_DATA 블록 추출
const startRe = /const\s+ALL_DATA\s*=\s*\[/;
const startMatch = HTML.match(startRe);
if (!startMatch) { console.error('ALL_DATA not found'); process.exit(1); }
const startIdx = startMatch.index + startMatch[0].length - 1; // '[' 위치

// bracket matching (문자열 안의 괄호 회피)
let depth = 0, i = startIdx, inStr = false, strCh = '', prev = '';
for (; i < HTML.length; i++) {
  const c = HTML[i];
  if (inStr) {
    if (c === strCh && prev !== '\\') inStr = false;
  } else {
    if (c === '\'' || c === '"' || c === '`') { inStr = true; strCh = c; }
    else if (c === '[') depth++;
    else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
  }
  prev = c;
}
const arrText = HTML.slice(startIdx, i);

// vm 으로 평가
let ALL_DATA;
try {
  ALL_DATA = vm.runInNewContext('(' + arrText + ')');
} catch (e) {
  console.error('ALL_DATA 파싱 실패:', e.message);
  process.exit(1);
}

// 라인 번호 매핑: 각 엔트리의 id 가 나타나는 라인을 index.html 에서 찾아 기록
const idLineMap = {};
const lines = HTML.split('\n');
for (let ln = 0; ln < lines.length; ln++) {
  const m = lines[ln].match(/id:\s*'([^']+)'/);
  if (m && !idLineMap[m[1]]) idLineMap[m[1]] = ln + 1;
}

const issues = { critical: [], warning: [], info: [] };
const addI = (level, entryId, type, msg) => issues[level].push({ entryId, line: idLineMap[entryId]||'?', type, msg });

console.log('=== ALL_DATA 엔트리 수:', ALL_DATA.length);

// 검증 루프
for (const e of ALL_DATA) {
  const id = e.id;
  const gamesArr = e.games ? Object.values(e.games) : [];
  const completedGames = gamesArr.filter(g => g.result && g.result !== '예정');
  const headerG = e.G, headerW = e.W, headerL = e.L, headerD = e.D;

  // games 집계
  let aggW = 0, aggL = 0, aggD = 0;
  for (const g of completedGames) {
    if (g.result === '승') aggW++;
    else if (g.result === '패') aggL++;
    else if (g.result === '무') aggD++;
  }
  const aggG = completedGames.length;

  // header vs games 집계 비교
  if (headerG !== aggG || headerW !== aggW || headerL !== aggL || headerD !== aggD) {
    addI('warning', id, 'header_mismatch',
      `header G/W/L/D=${headerG}/${headerW}/${headerL}/${headerD} vs games 집계=${aggG}/${aggW}/${aggL}/${aggD}`);
  }

  // 게임 항목 점검
  for (const [gk, g] of Object.entries(e.games||{})) {
    const valid = ['승','패','무','예정'];
    if (!valid.includes(g.result)) addI('critical', id, 'invalid_result', `${gk}: result='${g.result}'`);
    if (g.result !== '예정') {
      if (typeof g.ourScore !== 'number' || typeof g.theirScore !== 'number') {
        addI('warning', id, 'score_not_number', `${gk}: ${g.ourScore}/${g.theirScore}`);
      } else {
        if (g.ourScore < 0 || g.theirScore < 0) addI('critical', id, 'negative_score', `${gk}: ${g.ourScore}-${g.theirScore}`);
        // 점수-결과 정합성
        const s = g.ourScore - g.theirScore;
        if (s > 0 && g.result !== '승') addI('warning', id, 'score_result_conflict', `${gk}: ${g.ourScore}-${g.theirScore} 인데 ${g.result}`);
        else if (s < 0 && g.result !== '패') addI('warning', id, 'score_result_conflict', `${gk}: ${g.ourScore}-${g.theirScore} 인데 ${g.result}`);
        else if (s === 0 && g.result !== '무') addI('warning', id, 'score_result_conflict', `${gk}: ${g.ourScore}-${g.theirScore} 인데 ${g.result}`);
      }
    }
  }

  // 타자 점검
  const players = e.players || {};
  for (const [pk, p] of Object.entries(players)) {
    const name = p.name; const num = p.number;
    // G 초과
    if (p.G > aggG && aggG > 0) addI('warning', id, 'player_G_exceeds_games', `${name}(#${num}): G=${p.G} > 엔트리 G=${aggG}`);
    // H >= 2B+3B+HR
    const extra = (p['2B']||0)+(p['3B']||0)+(p.HR||0);
    if ((p.H||0) < extra) addI('critical', id, 'H_less_than_extra', `${name}(#${num}): H=${p.H}, 2B+3B+HR=${extra}`);
    // PA >= AB+BB+HBP
    const baseIn = (p.AB||0)+(p.BB||0)+(p.HBP||0);
    if ((p.PA||0) < baseIn) addI('critical', id, 'PA_less_than_AB+BB+HBP', `${name}(#${num}): PA=${p.PA}, AB+BB+HBP=${baseIn}`);
    // 비음수
    for (const k of ['PA','AB','H','RBI','R','SB','BB','HBP','SO','2B','3B','HR']) {
      if ((p[k]||0) < 0) addI('critical', id, 'negative_stat', `${name}(#${num}): ${k}=${p[k]}`);
    }
    // 비현실적: RBI > 5*G ? or R > 5*G ?
    if (p.G > 0 && ((p.RBI||0) > 10*p.G)) addI('warning', id, 'unrealistic_rbi', `${name}(#${num}): RBI=${p.RBI}, G=${p.G}`);
    if (p.G > 0 && ((p.R||0) > 10*p.G)) addI('warning', id, 'unrealistic_r', `${name}(#${num}): R=${p.R}, G=${p.G}`);
    // AB > PA
    if ((p.AB||0) > (p.PA||0)) addI('critical', id, 'AB_exceeds_PA', `${name}(#${num}): AB=${p.AB}, PA=${p.PA}`);
    // H > AB
    if ((p.H||0) > (p.AB||0)) addI('critical', id, 'H_exceeds_AB', `${name}(#${num}): H=${p.H}, AB=${p.AB}`);
    // SO > AB (strikeouts cannot exceed AB typically, since SO is AB)
    if ((p.SO||0) > (p.AB||0)) addI('warning', id, 'SO_exceeds_AB', `${name}(#${num}): SO=${p.SO}, AB=${p.AB}`);
  }

  // 투수 점검
  const pitchers = e.pitchers || {};
  for (const [pk, p] of Object.entries(pitchers)) {
    const name = p.name; const num = p.number;
    for (const k of ['IP','pH','pHR','K','pBB','pIBB','pHBP','R','ER','W','L','SV','HD']) {
      if ((p[k]||0) < 0) addI('critical', id, 'pitcher_negative', `${name}(#${num}): ${k}=${p[k]}`);
    }
    if (p.G > aggG && aggG > 0) addI('warning', id, 'pitcher_G_exceeds_games', `${name}(#${num}): G=${p.G} > 엔트리 G=${aggG}`);
    if ((p.ER||0) > (p.R||0)) addI('warning', id, 'ER_exceeds_R', `${name}(#${num}): ER=${p.ER}, R=${p.R}`);
    // K + pBB <= 3*IP 정도 (대략)
    // pass
  }
}

// 출력
function dump(level) {
  const arr = issues[level];
  console.log(`\n=== ${level.toUpperCase()} (${arr.length}건) ===`);
  const byEntry = {};
  for (const it of arr) {
    byEntry[it.entryId] = byEntry[it.entryId] || [];
    byEntry[it.entryId].push(it);
  }
  for (const [id, arr2] of Object.entries(byEntry)) {
    console.log(`\n[${id}] (index.html:${arr2[0].line}) — ${arr2.length}건`);
    for (const it of arr2.slice(0, 8)) {
      console.log(`  - ${it.type}: ${it.msg}`);
    }
    if (arr2.length > 8) console.log(`  ... +${arr2.length-8}`);
  }
}
dump('critical');
dump('warning');

// 유형별 카운트
const typeCount = {};
for (const level of ['critical','warning']) {
  for (const it of issues[level]) {
    typeCount[`${level}:${it.type}`] = (typeCount[`${level}:${it.type}`]||0)+1;
  }
}
console.log('\n=== 유형별 합계 ===');
for (const [t,c] of Object.entries(typeCount).sort((a,b)=>b[1]-a[1])) console.log(`  ${t}: ${c}`);

console.log('\n=== 총계 ===');
console.log(`  critical: ${issues.critical.length}`);
console.log(`  warning: ${issues.warning.length}`);

// 엔트리별 header vs games 집계 요약 (header_mismatch만)
console.log('\n=== header vs games 집계 불일치 엔트리 요약 ===');
const hm = issues.warning.filter(x=>x.type==='header_mismatch');
for (const it of hm) console.log(`  [${it.entryId}] line ${it.line}: ${it.msg}`);
