/**
 * Phase 2 - 기존 ALL_DATA.rankings vs scrape_debug/rankings/*.json 비교
 * diff 가 있는 엔트리 목록을 tmp_rankings_diff.json 저장
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const DEBUG_DIR = path.join(__dirname, '..', 'scrape_debug', 'rankings');

function loadAllData() {
  const m = HTML.match(/const\s+ALL_DATA\s*=\s*\[/);
  let i = m.index + m[0].length - 1, depth = 0, inStr = false, strCh = '', prev = '';
  for (; i < HTML.length; i++) {
    const c = HTML[i];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else { if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; } else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } } }
    prev = c;
  }
  return vm.runInNewContext('(' + HTML.slice(m.index + m[0].length - 1, i) + ')');
}

const ALL_DATA = loadAllData();
const KEYS = ['rank', 'team', 'pts', 'G', 'W', 'L', 'D', 'RS', 'RA'];

function normalizeRow(r) {
  const out = {};
  for (const k of KEYS) {
    if (k === 'team') out.team = String(r.team || '').trim();
    else {
      const v = r[k];
      out[k] = (v === null || v === undefined || v === '-') ? null : (typeof v === 'number' ? v : (parseInt(v) || 0));
    }
  }
  return out;
}

function rowsByTeam(arr) {
  const m = new Map();
  for (const r of arr) m.set(String(r.team).trim(), normalizeRow(r));
  return m;
}

function compareArray(oldArr, newArr) {
  // 팀별로 비교. 순서 차이는 무시.
  const oldM = rowsByTeam(oldArr || []);
  const newM = rowsByTeam(newArr || []);
  const diffs = [];
  const allTeams = new Set([...oldM.keys(), ...newM.keys()]);
  for (const team of allTeams) {
    const o = oldM.get(team);
    const n = newM.get(team);
    if (!o) { diffs.push({ team, type: 'added', old: null, new: n }); continue; }
    if (!n) { diffs.push({ team, type: 'removed', old: o, new: null }); continue; }
    // 필드 비교 (rank, W, L, D, RS, RA, pts, G)
    const changed = {};
    for (const k of ['rank', 'W', 'L', 'D', 'RS', 'RA', 'pts', 'G']) {
      if (o[k] !== n[k]) changed[k] = [o[k], n[k]];
    }
    if (Object.keys(changed).length > 0) diffs.push({ team, type: 'changed', fields: changed });
  }
  return diffs;
}

function compareRankings(oldR, newR) {
  if (!newR) return { status: 'no_new' };
  if (Array.isArray(oldR) && Array.isArray(newR)) {
    const diffs = compareArray(oldR, newR);
    return { type: 'array', oldCount: oldR.length, newCount: newR.length, diffs };
  }
  if (!Array.isArray(oldR) && !Array.isArray(newR) && oldR && newR) {
    // both objects
    const out = {};
    const keys = new Set([...Object.keys(oldR), ...Object.keys(newR)]);
    for (const k of keys) {
      out[k] = compareArray(oldR[k] || [], newR[k] || []);
    }
    return { type: 'object', oldCount: Object.keys(oldR).length, newCount: Object.keys(newR).length, groups: out };
  }
  // 구조 변경
  return {
    type: 'structure_change',
    oldType: Array.isArray(oldR) ? 'array' : (oldR ? 'object' : 'none'),
    newType: Array.isArray(newR) ? 'array' : 'object',
    oldCount: Array.isArray(oldR) ? oldR.length : (oldR ? Object.keys(oldR).length : 0),
    newCount: Array.isArray(newR) ? newR.length : Object.keys(newR).length
  };
}

const entries = ALL_DATA.map(e => e.id);
const report = {};
let changedEntries = 0;

for (const e of ALL_DATA) {
  const debugFile = path.join(DEBUG_DIR, `${e.id}.json`);
  if (!fs.existsSync(debugFile)) {
    report[e.id] = { status: 'no_debug_file', hadRankings: !!e.rankings };
    continue;
  }
  const newR = JSON.parse(fs.readFileSync(debugFile, 'utf8'));
  const oldR = e.rankings;
  const cmp = compareRankings(oldR, newR);
  // any differences?
  let hasDiff = false;
  if (cmp.status === 'no_new') hasDiff = false;
  else if (cmp.type === 'structure_change') hasDiff = true;
  else if (cmp.type === 'array') {
    hasDiff = cmp.diffs.length > 0 || (!oldR && newR);
  } else if (cmp.type === 'object') {
    for (const ds of Object.values(cmp.groups)) {
      if (ds.length > 0) hasDiff = true;
    }
    if (!oldR) hasDiff = true;
  }
  report[e.id] = {
    status: hasDiff ? 'DIFF' : 'same',
    hadRankings: !!oldR,
    cmp
  };
  if (hasDiff) changedEntries++;
}

fs.writeFileSync(path.join(__dirname, '..', 'tmp_rankings_diff.json'), JSON.stringify(report, null, 2), 'utf8');

console.log('=== diff 요약 ===');
console.log(`총 엔트리: ${ALL_DATA.length}`);
console.log(`차이 있음: ${changedEntries}`);
console.log(`새 파일 없음: ${Object.values(report).filter(r => r.status === 'no_debug_file').length}`);
console.log(`동일: ${Object.values(report).filter(r => r.status === 'same').length}`);

console.log('\n=== 차이 엔트리 상세 ===');
for (const [id, r] of Object.entries(report)) {
  if (r.status !== 'DIFF') continue;
  const c = r.cmp;
  if (c.type === 'structure_change') {
    console.log(`\n[${id}] STRUCTURE: ${c.oldType}(${c.oldCount}) → ${c.newType}(${c.newCount})`);
  } else if (c.type === 'array') {
    console.log(`\n[${id}] ARRAY old=${c.oldCount} new=${c.newCount} diffs=${c.diffs.length}`);
    for (const d of c.diffs.slice(0, 10)) {
      if (d.type === 'added') console.log(`  + ${d.team}: ${JSON.stringify(d.new)}`);
      else if (d.type === 'removed') console.log(`  - ${d.team}: ${JSON.stringify(d.old)}`);
      else console.log(`  ~ ${d.team}: ${JSON.stringify(d.fields)}`);
    }
    if (c.diffs.length > 10) console.log(`  ... +${c.diffs.length - 10}`);
  } else if (c.type === 'object') {
    const totalDiffs = Object.values(c.groups).reduce((a, b) => a + b.length, 0);
    console.log(`\n[${id}] OBJECT groups=${c.oldCount}→${c.newCount} totalDiffs=${totalDiffs}`);
    for (const [k, ds] of Object.entries(c.groups)) {
      if (!ds.length) continue;
      console.log(`  ${k}조 (${ds.length}건):`);
      for (const d of ds.slice(0, 6)) {
        if (d.type === 'added') console.log(`    + ${d.team}: ${JSON.stringify(d.new)}`);
        else if (d.type === 'removed') console.log(`    - ${d.team}: ${JSON.stringify(d.old)}`);
        else console.log(`    ~ ${d.team}: ${JSON.stringify(d.fields)}`);
      }
      if (ds.length > 6) console.log(`    ... +${ds.length - 6}`);
    }
  }
}

console.log('\n=== new debug 없는 엔트리 ===');
for (const [id, r] of Object.entries(report)) {
  if (r.status === 'no_debug_file') console.log(`  ${id}${r.hadRankings ? ' (has rankings, skip)' : ' (null)'}`);
}
