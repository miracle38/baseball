const fs = require('fs');
const path = require('path');

const RAW_DIR = path.join(__dirname, '..', 'tmp_games');

function parseGames(rawGames, host) {
  const out = [];
  for (const r of rawGames) {
    const cells = r.cells;
    let dateStr = '', time = '';
    for (const c of cells) {
      const m = c.match(/(\d{4})[-./](\d{2})[-./](\d{2})\s*(\d{2}:\d{2})?/);
      if (m) { dateStr = `${m[1]}-${m[2]}-${m[3]}`; time = m[4] || ''; break; }
    }
    if (!dateStr) continue;

    let lName = '', lScore = 0, rName = '', rScore = 0;
    let matchCell = '';
    for (const c of cells) {
      if (/와인드업/.test(c) && /\d+/.test(c)) { matchCell = c; break; }
    }
    if (matchCell) {
      let txt = matchCell.replace(/\s+(콜드승|콜드패|몰수승|몰수패|기권승|기권패|추첨승|추첨패)\s*$/, '').trim();
      let m = txt.match(/^(.+?)\s+(\d+)\s+VS\s+(\d+)\s+(.+?)$/);
      if (!m) m = txt.match(/^(.+?)\s+(\d+)\s*(?:vs|:|-)\s*(\d+)\s+(.+?)$/i);
      if (m) {
        lName = m[1].trim(); lScore = parseInt(m[2]); rScore = parseInt(m[3]); rName = m[4].trim();
      }
    }

    const isWindupL = /와인드업/.test(lName);
    const isWindupR = /와인드업/.test(rName);
    if (!isWindupL && !isWindupR) continue;

    const opponent = isWindupL ? rName : lName;
    const ourScore = isWindupL ? lScore : rScore;
    const theirScore = isWindupL ? rScore : lScore;
    let result = '무';
    if (ourScore > theirScore) result = '승';
    else if (ourScore < theirScore) result = '패';

    let location = '';
    for (const c of cells) {
      if (/(?:야구장|공원|운동장|그라운드|경기장|구장)/.test(c) && c.length < 50) { location = c.trim(); break; }
    }
    const leagueCat = r.leagueCategory || 'NORMAL';
    const boxScoreUrl = r.gameScheduleSeq
      ? `${host}/schedule/getGameRecord.hs?gameScheduleSeq=${r.gameScheduleSeq}&leagueCategory=${leagueCat}`
      : '';
    out.push({
      date: dateStr, time, opponent, ourScore, theirScore, result,
      location,
      gameScheduleSeq: r.gameScheduleSeq, leagueCategory: leagueCat, boxScoreUrl,
      isForfeit: /(몰수|기권|추첨)/.test(matchCell)
    });
  }
  return out;
}

const HOSTS = {
  '2024_daedeok': 'https://daedeokgu.dbsa.kr',
  '2023_daedeok': 'https://daedeokgu.dbsa.kr',
  '2023_sejong': 'https://www.ksbsa.or.kr',
};

for (const id of ['2024_daedeok', '2023_daedeok', '2023_sejong']) {
  const raw = JSON.parse(fs.readFileSync(path.join(RAW_DIR, `raw_${id}.json`), 'utf-8'));
  const parsed = parseGames(raw, HOSTS[id]);
  parsed.sort((a, b) => a.date.localeCompare(b.date));
  fs.writeFileSync(path.join(RAW_DIR, `tmp_games_${id}.json`), JSON.stringify(parsed, null, 2), 'utf-8');
  console.log(`\n[${id}] ${parsed.length}경기`);
  parsed.forEach(p => console.log(`  ${p.date} vs ${p.opponent} ${p.ourScore}-${p.theirScore} ${p.result}${p.isForfeit?' [forfeit]':''} seq=${p.gameScheduleSeq}`));
}
