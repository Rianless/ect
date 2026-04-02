// scripts/fetch-stats.js
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const YEAR = new Date().getFullYear();

async function fetchNaver(tab) {
  // 네이버 스포츠 선수 기록 API — GitHub Actions 서버에서는 접근 가능
  const url = `https://api-gw.sports.naver.com/stats/kbo/player-stats?seasonCode=${YEAR}&tab=${tab}&teamCode=HT&page=1&pageSize=100`;
  console.log(`[naver] ${tab} 요청`);
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Referer': 'https://sports.naver.com/kbaseball/record/index',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'ko-KR,ko;q=0.9',
      'Origin': 'https://sports.naver.com',
    }
  });
  console.log(`[naver] ${tab} status=${res.status}`);
  if (!res.ok) throw new Error(`naver ${tab} → ${res.status}`);
  const data = await res.json();
  const r = data?.result || {};
  const arr = r.seasonPlayerStats || r.playerList || r.players || r.list || null;
  if (!arr) throw new Error(`${tab} 배열 없음. keys=${JSON.stringify(Object.keys(r))}`);
  console.log(`[naver] ${tab} ${arr.length}명 keys=${JSON.stringify(Object.keys(arr[0]||{})).slice(0,120)}`);
  return arr;
}

async function main() {
  console.log(`[fetch-stats] ${YEAR}시즌 KIA 데이터 수집`);
  const [rawHitters, rawPitchers] = await Promise.all([
    fetchNaver('hitter'),
    fetchNaver('pitcher'),
  ]);

  const hitters = rawHitters.map(p => ({
    playerName: p.playerName || p.PLAYER_NAME || '',
    hitterGame: p.hitterGame || p.G_CN || '',
    hitterHra:  p.hitterHra  || p.HRA  || '',
    hitterHit:  p.hitterHit  || p.H_CN || '',
    hitterHr:   p.hitterHr   || p.HR_CN|| '',
    hitterRbi:  p.hitterRbi  || p.RBI_CN||'',
    hitterRun:  p.hitterRun  || p.R_CN || '',
    hitterObp:  p.hitterObp  || p.OBP  || '',
    hitterOps:  p.hitterOps  || p.OPS  || '',
  })).filter(p => p.playerName);

  const pitchers = rawPitchers.map(p => ({
    playerName:  p.playerName  || p.PLAYER_NAME || '',
    pitcherGame: p.pitcherGame || p.G_CN  || '',
    pitcherEra:  p.pitcherEra  || p.ERA   || '',
    pitcherWin:  p.pitcherWin  || p.W_CN  || '',
    pitcherLose: p.pitcherLose || p.L_CN  || '',
    pitcherSv:   p.pitcherSv   || p.SV_CN || '',
    pitcherHld:  p.pitcherHld  || p.HLD_CN|| '',
    pitcherIp:   p.pitcherIp   || p.IP    || '',
    pitcherKk:   p.pitcherKk   || p.KK_CN || '',
    pitcherWhip: p.pitcherWhip || p.WHIP  || '',
  })).filter(p => p.playerName);

  const output = { updatedAt: new Date().toISOString(), season: YEAR, hitters, pitchers };
  const dir = path.resolve('public');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kia-stats.json'), JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[fetch-stats] 완료 — 타자 ${hitters.length}명, 투수 ${pitchers.length}명`);
}

main().catch(e => { console.error(e); process.exit(1); });
