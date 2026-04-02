// scripts/fetch-stats.js
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const YEAR = new Date().getFullYear();

async function fetchKBOAjax(type) {
  const isHitter = type === 'hitter';
  // KBO 공식 사이트 내부 Ajax 엔드포인트
  const method = isHitter ? 'GetHitterBasicRecordList' : 'GetPitcherBasicRecordList';
  const url = `https://www.koreabaseball.com/ws/Record.asmx/${method}`;
  
  const body = new URLSearchParams({
    leagueId: '1',
    srId: '',
    teamCode: 'HT',
    pageNum: '1',
    pageSize: '100',
    sortKey: isHitter ? 'HRA_CN' : 'ERA_CN',
    orderBy: 'DESC',
    searchName: '',
  });

  console.log(`[fetch-stats] ${type} ajax 요청`);
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': isHitter
        ? 'https://www.koreabaseball.com/Record/Player/HitterBasic/BasicRecord.aspx'
        : 'https://www.koreabaseball.com/Record/Player/PitcherBasic/BasicRecord.aspx',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': 'https://www.koreabaseball.com',
    },
    body: body.toString(),
  });

  console.log(`[fetch-stats] ${type} status: ${res.status}`);
  const raw = await res.text();
  console.log(`[fetch-stats] ${type} raw(300): ${raw.slice(0, 300)}`);

  // JSON 파싱 시도
  let data = null;
  try { data = JSON.parse(raw); } catch(e) {
    // XML 래핑 제거 후 재시도
    const m = raw.match(/<string[^>]*>([\s\S]*?)<\/string>/i);
    if (m) { try { data = JSON.parse(m[1]); } catch(e2) {} }
  }

  if (!data) throw new Error(`${type} 파싱 실패: ${raw.slice(0, 100)}`);

  const arr = Array.isArray(data) ? data
    : (data.d ? (Array.isArray(data.d) ? data.d : null) : null)
    || data.list || data.data || data.result || null;

  if (!arr) throw new Error(`${type} 배열 없음. keys: ${JSON.stringify(Object.keys(data))}`);

  console.log(`[fetch-stats] ${type} 선수 ${arr.length}명, 첫번째 키: ${JSON.stringify(Object.keys(arr[0]||{}))}`);

  return isHitter ? arr.map(p => ({
    playerName: p.PLAYER_NAME || p.playerName || '',
    hitterGame:  p.G_CN    || '',
    hitterHra:   p.HRA     || '',
    hitterHit:   p.H_CN    || '',
    hitterHr:    p.HR_CN   || '',
    hitterRbi:   p.RBI_CN  || '',
    hitterRun:   p.R_CN    || '',
    hitterObp:   p.OBP     || '',
    hitterOps:   p.OPS     || '',
  })).filter(p => p.playerName)
  : arr.map(p => ({
    playerName:  p.PLAYER_NAME || p.playerName || '',
    pitcherGame: p.G_CN    || '',
    pitcherEra:  p.ERA     || '',
    pitcherWin:  p.W_CN    || '',
    pitcherLose: p.L_CN    || '',
    pitcherSv:   p.SV_CN   || '',
    pitcherHld:  p.HLD_CN  || '',
    pitcherIp:   p.IP      || '',
    pitcherKk:   p.KK_CN   || '',
    pitcherWhip: p.WHIP    || '',
  })).filter(p => p.playerName);
}

async function main() {
  console.log(`[fetch-stats] ${YEAR}시즌 KIA 데이터 수집 시작`);

  const [hitters, pitchers] = await Promise.all([
    fetchKBOAjax('hitter'),
    fetchKBOAjax('pitcher'),
  ]);

  const output = {
    updatedAt: new Date().toISOString(),
    season: YEAR,
    hitters,
    pitchers,
  };

  const dir = path.resolve('public');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kia-stats.json'), JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[fetch-stats] 저장 완료 — 타자 ${hitters.length}명, 투수 ${pitchers.length}명`);
}

main().catch(e => { console.error(e); process.exit(1); });
