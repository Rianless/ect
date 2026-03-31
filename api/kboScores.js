export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const pad = n => String(n).padStart(2, '0');
  const requestedDate = String(req?.query?.date || '').trim();
  const isRequestedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate);
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = pad(kst.getUTCMonth() + 1);
  const dd = pad(kst.getUTCDate());
  const tmr = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
  const yyyy2 = tmr.getUTCFullYear(), mm2 = pad(tmr.getUTCMonth() + 1), dd2 = pad(tmr.getUTCDate());

  const todayDash = isRequestedDate ? requestedDate : `${yyyy}-${mm}-${dd}`;
  const tmrDash   = isRequestedDate ? requestedDate : `${yyyy2}-${mm2}-${dd2}`;
  const todayStr  = `${yyyy}${mm}${dd}`;

  const TEAM_CODE = {
    'HT':'KIA','KT':'KT','LG':'LG','SK':'SSG','NC':'NC',
    'OB':'두산','LT':'롯데','SS':'삼성','HH':'한화','WO':'키움',
  };
  const mapTeam = code => TEAM_CODE[code] || code;

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
    'Referer': 'https://m.sports.naver.com/',
    'Accept': 'application/json',
    'Origin': 'https://m.sports.naver.com',
  };

  async function fetchSchedule(fromDate, toDate) {
    const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=kbaseball&fromDate=${fromDate}&toDate=${toDate}&size=500`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`schedule ${r.status}`);
    const data = await r.json();
    return (data?.result?.games || []).filter(g => g.categoryId === 'kbo');
  }

  async function fetchTextRelay(gameId, inning) {
    const inn = inning || 1;
    const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/text-relay?inning=${inn}&isHighlight=false`;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      return data?.result || null;
    } catch { return null; }
  }

  async function fetchGameDetail(gameId, inning) {
    const inn = inning || 1;
    const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=${inn}&isHighlight=false`;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      return data?.result || null;
    } catch { return null; }
  }

  function parseBatters(batters) {
    if (!batters?.length) return [];
    const orderMap = {};
    batters.forEach(p => {
      const o = p.batOrder;
      if (!orderMap[o]) orderMap[o] = [];
      orderMap[o].push(p);
    });
    return Object.entries(orderMap)
      .sort(([a],[b]) => Number(a)-Number(b))
      .map(([order, players]) => {
        const current = players.find(p => p.cin==='true') || players.find(p => !p.cout) || players[players.length-1];
        const replaced = players.find(p => p.cout==='true' && p !== current);
        const starterForPos = replaced || current;
        return {
          order: Number(order),
          name: current.name,
          pos: current.posName || '',
          hit: current.hit || 0,
          ab: current.ab || 0,
          rbi: current.rbi || 0,
          sub: replaced?.name || null,
          starterName: starterForPos?.name || current.name,
          starterPos: starterForPos?.posName || current.posName || '',
        };
      });
  }

  function parsePitchers(pitchers) {
    if (!pitchers?.length) return [];
    return pitchers.map(p => ({
      seqno: p.seqno,
      name: p.name,
      inn: p.inn || '0',
      er: p.er || 0,
      kk: p.kk || 0,
      bb: p.bb || 0,
    }));
  }

  // Helper function to recursively find textRelays
  function findTextRelaysRecursive(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      // If it's an array and elements look like relay items
      if (obj.length > 0 && (obj[0].title || obj[0].text || obj[0].type)) {
        return obj;
      }
      return null;
    }

    // Check common keys first
    if (obj.textRelays) return obj.textRelays;
    if (obj.relays) return obj.relays;
    if (obj.list) return obj.list;

    // Recursively search in nested objects
    for (const key in obj) {
      const found = findTextRelaysRecursive(obj[key]);
      if (found) return found;
    }
    return null;
  }

  function buildLineup(detail) {
    if (!detail) return null;
    const td = detail.textRelayData || detail;
    const home = td.homeLineup || detail.homeLineup;
    const away = td.awayLineup || detail.awayLineup;
    if (!home && !away) return null;

    const pcodeMap = {};
    [...(home?.batter||[]), ...(home?.pitcher||[])].forEach(p => { if(p.pcode) pcodeMap[p.pcode] = p.name; });
    [...(away?.batter||[]), ...(away?.pitcher||[])].forEach(p => { if(p.pcode) pcodeMap[p.pcode] = p.name; });

    const buildOrderMap = (batters) => {
      const om = {};
      (batters||[]).forEach(p => {
        const o = p.batOrder;
        if (!om[o]) om[o] = [];
        om[o].push(p);
      });
      const result = {};
      Object.entries(om).forEach(([o, ps]) => {
        const cur = ps.find(p=>p.cin==='true') || ps[ps.length-1];
        result[o] = cur.name;
      });
      return result;
    };
    const homeOrderMap = buildOrderMap(home?.batter);
    const awayOrderMap = buildOrderMap(away?.batter);

    return {
      home: { batters: parseBatters(home?.batter), pitchers: parsePitchers(home?.pitcher) },
      away: { batters: parseBatters(away?.batter), pitchers: parsePitchers(away?.pitcher) },
      pcodeMap, homeOrderMap, awayOrderMap,
    };
  }

  function convertGame(g, detail) {
    const away = mapTeam(g.awayTeamCode) || g.awayTeamName;
    const home = mapTeam(g.homeTeamCode) || g.homeTeamName;
    const sc = g.statusCode || '';
    const status = sc==='BEFORE'?'SCHEDULED': sc==='STARTED'?'LIVE': sc==='RESULT'?'FINAL':'SCHEDULED';

    let inning = null;
    if (g.statusInfo) { const m = g.statusInfo.match(/(\d+)회/); if(m) inning=parseInt(m[1]); }

    let time = '';
    if (g.gameDateTime) {
      const t = g.gameDateTime.split('T')[1] || '';
      const [h, mi] = t.split(':');
      if (h && mi) time = `${h}:${mi}`;
    }

    const gameData = detail?.game || g;
    const awayInnRaw = gameData.awayTeamScoreByInning || g.awayTeamScoreByInning || [];
    const homeInnRaw = gameData.homeTeamScoreByInning || g.homeTeamScoreByInning || [];

    const awayInnings = Array(9).fill(-1);
    const homeInnings = Array(9).fill(-1);
    awayInnRaw.forEach((s,i)=>{ if(i<9 && s!=='-') awayInnings[i]=Number(s); });
    homeInnRaw.forEach((s,i)=>{ if(i<9 && s!=='-') homeInnings[i]=Number(s); });

    const lu = buildLineup(detail);
    
    // textRelayData에서 중계 텍스트 데이터 추출 (재귀적 탐색)
    const textRelaysData = findTextRelaysRecursive(detail) || [];

    const td = detail?.textRelayData || detail || {};

    return {
      date: g.gameDate || '',
      time, away, home,
      stad: g.stadium || gameData.stadium || '',
      status,
      awayScore: g.awayTeamScore!=null ? Number(g.awayTeamScore) : null,
      homeScore: g.homeTeamScore!=null ? Number(g.homeTeamScore) : null,
      awayInnings, homeInnings, inning,
      inningInfo: g.statusInfo || null,
      winPitcher:  gameData.winPitcherName  || g.winPitcherName  || null,
      losePitcher: gameData.losePitcherName || g.losePitcherName || null,
      awayStarter: gameData.awayStarterName || g.awayStarterName || null,
      homeStarter: gameData.homeStarterName || g.homeStarterName || null,
      awayPitcher: gameData.awayCurrentPitcherName || g.awayCurrentPitcherName || null,
      homePitcher: gameData.homeCurrentPitcherName || g.homeCurrentPitcherName || null,
      awayHit:      g.awayTeamRheb?.[1] ?? gameData.awayTeamHit ?? g.awayTeamHit ?? null,
      homeHit:      g.homeTeamRheb?.[1] ?? gameData.homeTeamHit ?? g.homeTeamHit ?? null,
      awayError:    g.awayTeamRheb?.[2] ?? gameData.awayTeamError ?? g.awayTeamError ?? null,
      homeError:    g.homeTeamRheb?.[2] ?? gameData.homeTeamError ?? g.homeTeamError ?? null,
      awayBallFour: g.awayTeamRheb?.[3] ?? gameData.awayTeamBallFour ?? g.awayTeamBallFour ?? null,
      homeBallFour: g.homeTeamRheb?.[3] ?? gameData.homeTeamBallFour ?? g.homeTeamBallFour ?? null,
      broadChannel: g.broadChannel || null,
      lineup: lu,
      currentGameState: (() => {
        const cgs = detail?.currentGameState || td?.currentGameState || null;
        if (!cgs) return null;
        const pcodeMap = lu?.pcodeMap || {};
        const info = g.statusInfo || "";
        const isTop = info.includes("초");
        const atkOrderMap = isTop ? (lu?.awayOrderMap || {}) : (lu?.homeOrderMap || {});
        const baseToName = (val) => (!val || val === "0") ? null : (atkOrderMap[val] || null);
        return {
          ...cgs,
          pitcherName: pcodeMap[cgs.pitcher] || null,
          batterName: pcodeMap[cgs.batter] || null,
          base1Name: baseToName(cgs.base1),
          base2Name: baseToName(cgs.base2),
          base3Name: baseToName(cgs.base3),
        };
      })(),
      textRelays: textRelaysData,
      gameId: String(g.gameId || ""),
    };
  }

  try {
    const rawGames = await fetchSchedule(todayDash, tmrDash);
    const liveOrFinal = rawGames.filter(g => g.statusCode==='BEFORE' || g.statusCode==='STARTED' || g.statusCode==='RESULT');
    const detailMap = {};
    const requestedInning = req?.query?.inning ? parseInt(req.query.inning) : null;

    await Promise.all(
      liveOrFinal.map(async g => {
        let inn = 1;
        if (requestedInning) {
          inn = requestedInning;
        } else if (g.statusCode === 'RESULT') {
          inn = 9;
        } else if (g.statusCode === 'STARTED' && g.statusInfo) {
          const m = g.statusInfo.match(/(\d+)회/);
          if (m) inn = parseInt(m[1]);
        }
        let detail = null;
        if (g.statusCode === 'RESULT') {
          detail = await fetchTextRelay(g.gameId, inn);
        }
        if (!detail) {
          detail = await fetchGameDetail(g.gameId, inn);
        }
        if (detail) detailMap[g.gameId] = detail;
      })
    );

    const allGames = rawGames.map(g => convertGame(g, detailMap[g.gameId] || null));
    const todayGames = allGames.filter(g => g.date === todayDash);
    const tmrGames   = allGames.filter(g => g.date === tmrDash);

    return res.status(200).json({
      games: allGames,
      date: todayStr,
      today: todayGames.length,
      tomorrow: tmrGames.length,
      total: allGames.length,
      note: allGames.length===0 ? '오늘 KBO 경기 없음' : undefined,
    });
  } catch(e) {
    return res.status(200).json({ games:[], date:todayStr, error: e.message });
  }
}
