/**
 * Phase 3: 각 매핑된 (lig, season, group) 의 windup 로스터를 기존 ALL_DATA 엔트리에 머지
 * - 기존 entry.players 에 없는 선수만 추가
 * - 기존 entry.pitchers 에 없는 투수만 추가
 * - 기존 선수의 스탯은 덮어쓰지 않음 (덮어쓰기 이슈 복잡하므로)
 * - 기존 entry 가 사용하는 key 포맷 (`num` vs `number`, `kOBP/kSLG/kOPS` 존재 여부) 일치
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const HTML_FILE = path.join(__dirname, '..', 'index.html');
const WINDUP_FILE = path.join(__dirname, '..', 'tmp_windup_all_leagues.json');
const MAPPING_FILE = path.join(__dirname, '..', 'tmp_entry_mapping.json');
const REPORT_FILE = path.join(__dirname, '..', 'tmp_merge_report.json');

// Utility: strip "(N)" suffix from name, extract number
function parseNameNum(raw) {
  const m = raw.match(/^(.+?)\((\d*)\)\s*$/);
  if (m) return { name: m[1].trim(), number: m[2] === '' ? null : parseInt(m[2]) };
  return { name: raw.trim(), number: null };
}

function num(v) {
  if (v === '' || v == null) return 0;
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return isNaN(n) ? 0 : n;
}

function parseInning(ipRaw) {
  // "29 ⅔" or "8 ⅓" or "5" — convert to decimal
  if (!ipRaw) return 0;
  const s = String(ipRaw).trim();
  let int = 0, frac = 0;
  const parts = s.split(/\s+/);
  for (const p of parts) {
    if (/^\d+(\.\d+)?$/.test(p)) int += parseFloat(p);
    else if (p === '⅓' || p === '1/3') frac = 1/3;
    else if (p === '⅔' || p === '2/3') frac = 2/3;
  }
  return +(int + frac).toFixed(2);
}

function convertBatter(stats, allKeys) {
  const parsed = parseNameNum(stats['이름'] || '');
  const out = {};
  // Respect existing key format
  const useNumber = allKeys.includes('number');
  const useNum = allKeys.includes('num');
  out.name = parsed.name;
  if (useNumber) out.number = parsed.number == null ? 0 : parsed.number;
  else if (useNum) out.num = parsed.number == null ? 0 : parsed.number;
  out.G = num(stats['선수게임']);
  out.PA = num(stats['타석']);
  out.AB = num(stats['타수']);
  out.H = num(stats['총안타']);
  out['2B'] = num(stats['2루타']);
  out['3B'] = num(stats['3루타']);
  out.HR = num(stats['홈런']);
  out.RBI = num(stats['타점']);
  out.R = num(stats['득점']);
  out.SB = num(stats['도루']);
  out.BB = num(stats['볼넷']);
  out.HBP = num(stats['사구']);
  out.SO = num(stats['삼진']);
  if (allKeys.includes('kOBP')) out.kOBP = num(stats['출루율']);
  if (allKeys.includes('kSLG')) out.kSLG = num(stats['장타율']);
  if (allKeys.includes('kOPS')) out.kOPS = num(stats['OPS']);
  return out;
}

function convertPitcher(stats, allKeys) {
  const parsed = parseNameNum(stats['이름'] || '');
  const out = {};
  const useNumber = allKeys.includes('number');
  const useNum = allKeys.includes('num');
  out.name = parsed.name;
  if (useNumber) out.number = parsed.number == null ? 0 : parsed.number;
  else if (useNum) out.num = parsed.number == null ? 0 : parsed.number;
  out.G = num(stats['선수게임']);
  if (allKeys.includes('W')) out.W = num(stats['승']);
  if (allKeys.includes('L')) out.L = num(stats['패']);
  if (allKeys.includes('SV')) out.SV = num(stats['세이브']);
  if (allKeys.includes('HD')) out.HD = num(stats['홀드']);
  if (allKeys.includes('IP')) out.IP = parseInning(stats['이닝']);
  if (allKeys.includes('pH')) out.pH = num(stats['피안타']);
  if (allKeys.includes('pHR')) out.pHR = num(stats['피홈런']);
  if (allKeys.includes('K')) out.K = num(stats['탈삼진']);
  if (allKeys.includes('pBB')) out.pBB = num(stats['볼넷']);
  if (allKeys.includes('pIBB')) out.pIBB = num(stats['고의4구']);
  if (allKeys.includes('pHBP')) out.pHBP = num(stats['사구']);
  if (allKeys.includes('R')) out.R = num(stats['실점']);
  if (allKeys.includes('ER')) out.ER = num(stats['자책점']);
  return out;
}

function serializeObject(obj, keyOrder) {
  // Serialize obj with keys in keyOrder, values in JS literal form (no quoting of keys needed except reserved).
  // Keys starting with digit need single-quote.
  const parts = [];
  for (const k of keyOrder) {
    if (!(k in obj)) continue;
    const v = obj[k];
    const needQuote = /^\d/.test(k);
    const kStr = needQuote ? `'${k}'` : k;
    let vStr;
    if (v == null) vStr = 'null';
    else if (typeof v === 'number') vStr = String(v);
    else if (typeof v === 'string') vStr = `'${v.replace(/'/g, "\\'")}'`;
    else vStr = JSON.stringify(v);
    parts.push(`${kStr}:${vStr}`);
  }
  return '{' + parts.join(',') + '}';
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

// Find block like `players:{...}` and return inner contents + outer span in entryText
function findObjBlock(entryText, key) {
  const re = new RegExp(`\\b${key}\\s*:\\s*\\{`);
  const m = re.exec(entryText);
  if (!m) return null;
  const openIdx = entryText.indexOf('{', m.index);
  let depth = 1, i = openIdx + 1;
  let inStr = false, strCh = '';
  while (i < entryText.length && depth > 0) {
    const c = entryText[i];
    const prev = entryText[i - 1];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else {
      if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; }
      else if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) break; }
    }
    i++;
  }
  return { outerStart: m.index, outerEnd: i + 1, inner: entryText.substring(openIdx + 1, i), openIdx, closeIdx: i };
}

// Parse the inner block into entry list: [{pN, rawText}, ...]
function parsePlayerEntries(innerText) {
  const entries = [];
  let i = 0;
  while (i < innerText.length) {
    // skip whitespace and commas
    while (i < innerText.length && /[\s,]/.test(innerText[i])) i++;
    if (i >= innerText.length) break;
    // read key
    let keyStart = i;
    while (i < innerText.length && /[\w]/.test(innerText[i])) i++;
    const key = innerText.substring(keyStart, i);
    // skip spaces until ':'
    while (i < innerText.length && innerText[i] !== ':') i++;
    i++; // skip ':'
    while (i < innerText.length && /\s/.test(innerText[i])) i++;
    // read value
    let valStart = i;
    if (innerText[i] === '{') {
      let depth = 1, j = i + 1;
      let inStr = false, strCh = '';
      while (j < innerText.length && depth > 0) {
        const c = innerText[j];
        const prev = innerText[j - 1];
        if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
        else {
          if (c === "'" || c === '"') { inStr = true; strCh = c; }
          else if (c === '{') depth++;
          else if (c === '}') { depth--; if (depth === 0) break; }
        }
        j++;
      }
      entries.push({ key, valText: innerText.substring(valStart, j + 1) });
      i = j + 1;
    } else {
      // unexpected but skip
      i++;
    }
  }
  return entries;
}

// Extract keys from one player value text like "{name:'X',number:5,G:1,...}"
function extractKeysFromValText(valText) {
  // Match keys: simple pattern `key:` or `'key':`
  const keys = [];
  const re = /(?:^|\{|,)\s*(?:(['"])([^'"]+)\1|(\w+))\s*:/g;
  let m;
  while ((m = re.exec(valText)) !== null) {
    keys.push(m[2] || m[3]);
  }
  return keys;
}

// Append new entries to players block at the END (before closing `}`)
function insertIntoObjBlock(entryText, blockInfo, newEntriesStr) {
  if (!newEntriesStr) return entryText;
  const before = entryText.substring(0, blockInfo.closeIdx);
  const after = entryText.substring(blockInfo.closeIdx);
  // Inner text ends; add ',' if inner is non-empty and doesn't already end with ','
  const innerTrim = blockInfo.inner.replace(/\s+$/, '');
  const needComma = innerTrim.length > 0 && !innerTrim.endsWith(',');
  return before + (needComma ? ',' : '') + newEntriesStr + after;
}

function main() {
  const windup = JSON.parse(fs.readFileSync(WINDUP_FILE, 'utf-8'));
  const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));

  // Load ALL_DATA for cross-check
  const html0 = fs.readFileSync(HTML_FILE, 'utf-8');
  const m = html0.match(/const ALL_DATA\s*=\s*\[/);
  let arrayStart = m.index + m[0].length - 1;
  // Find end
  let i = arrayStart + 1, depth = 1, inStr = false, strCh = '';
  while (i < html0.length && depth > 0) {
    const c = html0[i]; const prev = html0[i-1];
    if (inStr) { if (c === strCh && prev !== '\\') inStr = false; }
    else { if (c === "'" || c === '"' || c === '`') { inStr = true; strCh = c; }
      else if (c === '[') depth++; else if (c === ']') { depth--; if (depth === 0) { i++; break; } }
    }
    i++;
  }
  const arrSrc = html0.substring(arrayStart, i);
  const ctx = {}; vm.createContext(ctx); vm.runInContext('var ALL_DATA = ' + arrSrc + ';', ctx);
  const dataMap = {};
  ctx.ALL_DATA.forEach(e => dataMap[e.id] = e);

  let html = html0;
  const report = [];

  // Iterate combos sorted by year descending so later changes don't affect earlier positions too much? Actually do all sequentially with re-parsing after each.
  const combos = Object.keys(mapping.mapped).sort();
  for (const combo of combos) {
    const targetId = mapping.mapped[combo];
    const entry = dataMap[targetId];
    const windupCombo = windup.data[combo];
    if (!entry || !windupCombo) continue;

    // Existing names
    const existingPlayerNames = new Set(Object.values(entry.players || {}).map(p => p.name));
    const existingPitcherNames = new Set(Object.values(entry.pitchers || {}).map(p => p.name));

    // Find entry span in current html
    const span = findEntrySpan(html, targetId);
    if (!span) { console.log(`[${targetId}] span not found`); continue; }
    let entryText = html.substring(span.start, span.end);

    // Batter merging
    const playersBlock = findObjBlock(entryText, 'players');
    let playersKeys = null;
    if (playersBlock) {
      const pEntries = parsePlayerEntries(playersBlock.inner);
      playersKeys = pEntries.length ? extractKeysFromValText(pEntries[0].valText) : ['name','number','G','PA','AB','H','2B','3B','HR','RBI','R','SB','BB','HBP','SO','kOBP','kSLG','kOPS'];
      // Determine max pN
      let maxN = 0;
      pEntries.forEach(pe => { const n = parseInt(pe.key.replace(/^p/, '')); if (!isNaN(n) && n > maxN) maxN = n; });

      const added = [];
      const newParts = [];
      windupCombo.batters.forEach(b => {
        const parsed = parseNameNum(b.name);
        if (existingPlayerNames.has(parsed.name)) return;
        // Also avoid dup within this combo (shouldn't happen)
        if (added.includes(parsed.name)) return;
        const obj = convertBatter(b.stats, playersKeys);
        const sstr = serializeObject(obj, playersKeys);
        maxN++;
        newParts.push(`p${maxN}:${sstr}`);
        added.push(parsed.name);
        existingPlayerNames.add(parsed.name);
      });
      if (newParts.length) {
        const combined = newParts.join(',');
        entryText = insertIntoObjBlock(entryText, playersBlock, combined);
        report.push({ combo, targetId, type: 'batter', added });
        console.log(`[${targetId}] batter += ${added.length}: ${added.join(', ')}`);
      }
    }

    // Pitcher merging
    const pitchersBlock = findObjBlock(entryText, 'pitchers');
    let pitchersKeys = null;
    if (pitchersBlock) {
      const pEntries = parsePlayerEntries(pitchersBlock.inner);
      pitchersKeys = pEntries.length ? extractKeysFromValText(pEntries[0].valText) : ['name','num','G','W','L','SV','HD','IP','pH','pHR','K','pBB','pIBB','pHBP','R','ER'];
      let maxN = 0;
      pEntries.forEach(pe => { const n = parseInt(pe.key.replace(/^pt/, '')); if (!isNaN(n) && n > maxN) maxN = n; });

      const added = [];
      const newParts = [];
      windupCombo.pitchers.forEach(b => {
        const parsed = parseNameNum(b.name);
        if (existingPitcherNames.has(parsed.name)) return;
        if (added.includes(parsed.name)) return;
        const obj = convertPitcher(b.stats, pitchersKeys);
        const sstr = serializeObject(obj, pitchersKeys);
        maxN++;
        newParts.push(`pt${maxN}:${sstr}`);
        added.push(parsed.name);
        existingPitcherNames.add(parsed.name);
      });
      if (newParts.length) {
        const combined = newParts.join(',');
        entryText = insertIntoObjBlock(entryText, pitchersBlock, combined);
        report.push({ combo, targetId, type: 'pitcher', added });
        console.log(`[${targetId}] pitcher += ${added.length}: ${added.join(', ')}`);
      }
    }

    // Commit back to html
    if (entryText !== html.substring(span.start, span.end)) {
      html = html.substring(0, span.start) + entryText + html.substring(span.end);
    }
  }

  fs.writeFileSync(HTML_FILE, html, 'utf-8');
  fs.writeFileSync(REPORT_FILE, JSON.stringify(report, null, 2), 'utf-8');

  // Summary
  const totals = {};
  report.forEach(r => {
    if (!totals[r.targetId]) totals[r.targetId] = { batters: 0, pitchers: 0 };
    if (r.type === 'batter') totals[r.targetId].batters = r.added.length;
    else totals[r.targetId].pitchers = r.added.length;
  });
  console.log('\n=== SUMMARY ===');
  Object.keys(totals).sort().forEach(id => {
    const t = totals[id];
    console.log(`  ${id}: +${t.batters || 0} batters, +${t.pitchers || 0} pitchers`);
  });
}

main();
