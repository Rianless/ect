// scripts/fetch-stats.js
// GitHub Actions에서 실행 — 스탯티즈에서 KIA 선수 데이터 수집

import fetch from 'node-fetch';
import * as cheerio from 'cheerio';
import fs from 'fs';
import path from 'path';

const YEAR = new Date().getFullYear();

async function fetchStatiz(type) {
  // type: 'HRA_CN' (타자), 'ERA_CN' (투수)
  const isHitter = type === 'HRA_CN';
  const teamParam = encodeURIComponent('KIA 타이거즈');
  const url = `https://www.statiz.co.kr/stat.php?opt=0&sopt=0&re=0&ys=${YEAR}&ye=${YEAR}&se=0&te=${teamParam}&tm=&ty=0&qu=auto&po=0&as=&ae=&hi=&un=&pl=&da=1&o1=${type}&o2=&de=1&lr=0&tr=&cv=&ml=1&sn=50&si=&cn=50`;

  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.statiz.co.kr/',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Cookie': 'statiz_lang=ko',
    }
  });

  if (!res.ok) throw new Error(`statiz ${type} → ${res.status}`);
  const html = await res.text();
  const $ = cheerio.load(html);
  const players = [];

  $('tbody tr').each((_, row) => {
    const cells = $(row).find('td').map((_, td) => $(td).text().trim()).get();
    if (cells.length < 5) return;

    const name = cells[1];
    if (!name || /^\d+$/.test(name) || name === '선수') return;

    if (isHitter) {
      players.push({
        playerName: name,
        hitterGame: cells[3] || '',
        hitterHra:  cells[16] || '',  // AVG
        hitterHit:  cells[6]  || '',  // H
        hitterHr:   cells[9]  || '',  // HR
        hitterRbi:  cells[11] || '',  // RBI
        hitterRun:  cells[10] || '',  // R
        hitterObp:  cells[17] || '',  // OBP
        hitterOps:  cells[19] || '',  // OPS
      });
    } else {
      players.push({
        playerName:  name,
        pitcherGame: cells[3]  || '',
        pitcherWin:  cells[4]  || '',  // W
        pitcherLose: cells[5]  || '',  // L
        pitcherSv:   cells[6]  || '',  // SV
        pitcherHld:  cells[7]  || '',  // HLD
        pitcherIp:   cells[8]  || '',  // IP
        pitcherKk:   cells[13] || '',  // SO
        pitcherEra:  cells[14] || '',  // ERA
        pitcherWhip: cells[15] || '',  // WHIP
      });
    }
  });

  return players;
}

async function main() {
  console.log(`[fetch-stats] ${YEAR}시즌 KIA 데이터 수집 시작`);

  const [hitters, pitchers] = await Promise.all([
    fetchStatiz('HRA_CN'),
    fetchStatiz('ERA_CN'),
  ]);

  console.log(`[fetch-stats] 타자 ${hitters.length}명, 투수 ${pitchers.length}명`);

  const output = {
    updatedAt: new Date().toISOString(),
    season: YEAR,
    hitters,
    pitchers,
  };

  // public/ 폴더 없으면 생성
  const dir = path.resolve('public');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(
    path.join(dir, 'kia-stats.json'),
    JSON.stringify(output, null, 2),
    'utf-8'
  );
  console.log('[fetch-stats] public/kia-stats.json 저장 완료');
}

main().catch(e => { console.error(e); process.exit(1); });
