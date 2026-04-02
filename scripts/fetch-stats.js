// scripts/fetch-stats.js
import fetch from 'node-fetch';
import fs from 'fs';
import path from 'path';

const YEAR = new Date().getFullYear();

async function kboPost(method) {
  const isHitter = method.toLowerCase().includes('hitter');
  const body = new URLSearchParams({
    leagueId: '1', srId: '', teamCode: 'HT',
    pageNum: '1', pageSize: '100',
    sortKey: isHitter ? 'HRA_CN' : 'ERA_CN',
    orderBy: 'DESC', searchName: '',
  });
  const res = await fetch(`https://www.koreabaseball.com/ws/Record.asmx/${method}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer': 'https://www.koreabaseball.com/Record/Player/HitterBasic/BasicRecord.aspx',
      'X-Requested-With': 'XMLHttpRequest',
      'Accept': 'application/json, text/javascript, */*; q=0.01',
      'Origin': 'https://www.koreabaseball.com',
    },
    body: body.toString(),
  });
  const raw = await res.text();
  console.log(`[${method}] status=${res.status} raw=${raw.slice(0,200)}`);
  return { status: res.status, raw };
}

async function fetchType(type) {
  const isHitter = type === 'hitter';

  // 투수 메서드명 후보 순서대로 시도
  const methods = isHitter
    ? ['GetHitterBasicRecordList']
    : ['GetPitcherBasicRecord', 'GetPitcherBasicRecordList', 'GetPitcherRecord', 'GetPitcherBasicRecordInfo'];

  let raw = null;
  for (const m of methods) {
    const r = await kboPost(m);
    if (r.status === 200 && !r.raw.includes('잘못되었습니다')) {
      raw = r.raw; break;
    }
  }
  if (!raw) throw new Error(`${type}: 작동하는 메서드 없음`);

  let data = null;
  try { data = JSON.parse(raw); } catch(e) {
    const m = raw.match(/<string[^>]*>([\s\S]*?)<\/string>/i);
    if (m) { try { data = JSON.parse(m[1]); } catch(e2) {} }
  }
  if (!data) throw new Error(`${type} 파싱 실패`);

  const arr = Array.isArray(data) ? data
    : (data.d ? (Array.isArray(data.d) ? data.d : null) : null)
    || data.list || data.data || data.result || null;

  if (!arr || !arr.length) throw new Error(`${type} 배열 없음. keys=${JSON.stringify(Object.keys(data))}`);
  console.log(`[fetch-stats] ${type} ${arr.length}명 keys=${JSON.stringify(Object.keys(arr[0]||{})).slice(0,100)}`);

  return isHitter ? arr.map(p => ({
    playerName: p.PLAYER_NAME||p.playerName||'',
    hitterGame: p.G_CN||'', hitterHra: p.HRA||'',
    hitterHit:  p.H_CN||'', hitterHr:  p.HR_CN||'',
    hitterRbi:  p.RBI_CN||'',hitterRun: p.R_CN||'',
    hitterObp:  p.OBP||'',  hitterOps: p.OPS||'',
  })).filter(p=>p.playerName)
  : arr.map(p => ({
    playerName:  p.PLAYER_NAME||p.playerName||'',
    pitcherGame: p.G_CN||'',  pitcherEra:  p.ERA||'',
    pitcherWin:  p.W_CN||'',  pitcherLose: p.L_CN||'',
    pitcherSv:   p.SV_CN||'', pitcherHld:  p.HLD_CN||'',
    pitcherIp:   p.IP||'',    pitcherKk:   p.KK_CN||'',
    pitcherWhip: p.WHIP||'',
  })).filter(p=>p.playerName);
}

async function main() {
  console.log(`[fetch-stats] ${YEAR}시즌 KIA 데이터 수집`);
  const [hitters, pitchers] = await Promise.all([fetchType('hitter'), fetchType('pitcher')]);
  const output = { updatedAt: new Date().toISOString(), season: YEAR, hitters, pitchers };
  const dir = path.resolve('public');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'kia-stats.json'), JSON.stringify(output, null, 2), 'utf-8');
  console.log(`[fetch-stats] 완료 — 타자 ${hitters.length}명, 투수 ${pitchers.length}명`);
}

main().catch(e => { console.error(e); process.exit(1); });

