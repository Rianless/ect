// scripts/fetch-stats.js
import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const YEAR = new Date().getFullYear();

async function fetchKBO(type) {
  const isHitter = type === 'hitter';
  // KBO 공식 선수 기록 페이지 (서버사이드 렌더링 — Actions에서는 접근 가능)
  const url = isHitter
    ? `https://www.koreabaseball.com/Record/Player/HitterBasic/BasicRecord.aspx?leagueId=1&teamCode=HT&sort=HRA_CN`
    : `https://www.koreabaseball.com/Record/Player/PitcherBasic/BasicRecord.aspx?leagueId=1&teamCode=HT&sort=ERA_CN`;

  console.log(`[fetch-stats] ${type} URL: ${url}`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://www.koreabaseball.com/',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'ko-KR,ko;q=0.9',
    }
  });

  console.log(`[fetch-stats] ${type} status: ${res.status}`);
  if (!res.ok) throw new Error(`KBO ${type} → ${res.status}`);

  const html = await res.text();
  const $ = cheerio.load(html);
  const players = [];

  // KBO 공식 사이트는 서버사이드 렌더링 — tbody에 데이터 있음
  $('div.record_result table tbody tr').each((_, row) => {
    const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 5) return;
    const name = cells[1];
    if (!name || name === '선수명') return;

    if (isHitter) {
      players.push({
        playerName: name,
        hitterGame: cells[2]  || '',
        hitterHra:  cells[4]  || '',
        hitterHit:  cells[8]  || '',
        hitterHr:   cells[11] || '',
        hitterRbi:  cells[12] || '',
        hitterRun:  cells[10] || '',
        hitterObp:  cells[14] || '',
        hitterOps:  cells[16] || '',
      });
    } else {
      players.push({
        playerName:  name,
        pitcherGame: cells[2]  || '',
        pitcherEra:  cells[4]  || '',
        pitcherWin:  cells[5]  || '',
        pitcherLose: cells[6]  || '',
        pitcherSv:   cells[7]  || '',
        pitcherHld:  cells[8]  || '',
        pitcherIp:   cells[10] || '',
        pitcherKk:   cells[15] || '',
        pitcherWhip: cells[18] || '',
      });
    }
  });

  console.log(`[fetch-stats] ${type} parsed: ${players.length}명`);

  // 파싱 실패시 테이블 구조 디버그
  if (players.length === 0) {
    const tbodyHtml = $('div.record_result table tbody').html() || '';
    console.log(`[fetch-stats] tbody preview: ${tbodyHtml.slice(0, 300)}`);
  }

  return players;
}

async function main() {
  console.log(`[fetch-stats] ${YEAR}시즌 KIA 데이터 수집 시작`);

  const [hitters, pitchers] = await Promise.all([
    fetchKBO('hitter'),
    fetchKBO('pitcher'),
  ]);

  const output = {
    updatedAt: new Date().toISOString(),
    season: YEAR,
    hitters,
    pitchers,
  };

  const dir = path.resolve('public');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'kia-stats.json'),
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log(`[fetch-stats] 저장 완료 — 타자 ${hitters.length}명, 투수 ${pitchers.length}명`);
}

main().catch(e => { console.error(e); process.exit(1); });
