export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = kst.getUTCFullYear();
  const mm = pad(kst.getUTCMonth() + 1);
  const dd = pad(kst.getUTCDate());
  const tmr = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
  const yyyy2 = tmr.getUTCFullYear(), mm2 = pad(tmr.getUTCMonth() + 1), dd2 = pad(tmr.getUTCDate());
  const ystd = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
  const yyyyY = ystd.getUTCFullYear(), mmY = pad(ystd.getUTCMonth() + 1), ddY = pad(ystd.getUTCDate());
  const todayDash = `${yyyy}-${mm}-${dd}`;
  const tmrDash   = `${yyyy2}-${mm2}-${dd2}`;
  const ystdDash  = `${yyyyY}-${mmY}-${ddY}`;
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
  };

  async function fetchSchedule(fromDate, toDate) {
    const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=kbaseball&fromDate=${fromDate}&toDate=${toDate}&size=500`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`schedule ${r.status}`);
    const data = await r.json();
    return (data?.result?.games || []).filter(g => g.categoryId === 'kbo');
  }

  async function fetchGameDetail(gameId) {
    const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=1&isHighlight=false`;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      return data?.result || null;
    } catch { return null; }
  }

  function parseLineup(lineupData) {
    if (!lineupData) return null;
    const parseBatter = (batters) => {
      if (!batters?.length) return [];
      const orderMap = {};
      batters.forEach(p => {
        const order = p.batOrder;
        if (!orderMap[order]) orderMap[order] = [];
        orderMap[order].push(p);
      });
      return Object.entries(orderMap)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([order, players]) => {
          const current = players.find(p => p.cin === 'true') || players.find(p => !p.cout) || players[players.length - 1];
          const prev = players.find(p => p.cout === 'true' && p !== current);
          return {
            order: Number(order),
            name: current.name,
            pos: current.posName || '',
            hit: current.hit || 0,
            ab: current.ab || 0,
            rbi: current.rbi || 0,
            hra: current.todayHra != null ? current.todayHra : null,
            sub: prev ? prev.name : null,
          };
        });
    };
    const parsePitcher = (pitchers) => {
      if (!pitchers?.length) return [];
      return pitchers.map(p => ({
        seqno: p.seqno,
        name: p.name,
        inn: p.inn || '0',
        er: p.er || 0,
        kk: p.kk || 0,
        bb: p.bb || 0,
        hit: p.hit || 0,
        era: p.todayEra != null ? p.todayEra : null,
      }));
    };
    const homeBatters = parseBatter(lineupData.homeLineup?.batter);
    const awayBatters = parseBatter(lineupData.awayLineup?.batter);
    if (!homeBatters.length && !awayBatters.length) return null;
    return {
      home: { batters: homeBatters, pitchers: parsePitcher(lineupData.homeLineup?.pitcher) },
      away: { batters: awayBatters, pitchers: parsePitcher(lineupData.awayLineup?.pitcher) },
    };
  }

  function convertGame(g, detail) {
    const away = mapTeam(g.awayTeamCode) || g.awayTeamName;
    const home = mapTeam(g.homeTeamCode) || g.homeTeamName;
    const sc = g.statusCode || '';
    const status = sc === 'BEFORE' ? 'SCHEDULED' : sc === 'STARTED' ? 'LIVE' : sc === 'RESULT' ? 'FINAL' : 'SCHEDULED';
    let inning = null;
    if (g.statusInfo) { const m = g.statusInfo.match(/(\d+)회/); if (m) inning = parseInt(m[1]); }
    let time = '';
    if (g.gameDateTime) { const t = g.gameDateTime.split('T')[1] || ''; const [h, mi] = t.split(':'); if (h && mi) time = `${h}:${mi}`; }
    const gameData = detail?.game || g;
    const awayInnRaw = gameData.awayTeamScoreByInning || g.awayTeamScoreByInning || [];
    const homeInnRaw = gameData.homeTeamScoreByInning || g.homeTeamScoreByInning || [];
    const awayInnings = Array(9).fill(-1);
    const homeInnings = Array(9).fill(-1);
    awayInnRaw.forEach((s, i) => { if (i < 9 && s !== '-') awayInnings[i] = Number(s); });
    homeInnRaw.forEach((s, i) => { if (i < 9 && s !== '-') homeInnings[i] = Number(s); });
    const lineup = detail ? parseLineup(detail) : null;
    return {
      date: g.gameDate || '',
      time,
      away,
      home,
      stad: g.stadium || gameData.stadium || '',
      status,
      awayScore: g.awayTeamScore != null ? Number(g.awayTeamScore) : null,
      homeScore: g.homeTeamScore != null ? Number(g.homeTeamScore) : null,
      awayInnings,
      homeInnings,
      inning,
      inningInfo: g.statusInfo || null,
      winPitcher:  (gameData.winPitcherName  || g.winPitcherName)  || null,
      losePitcher: (gameData.losePitcherName || g.losePitcherName) || null,
      awayStarter: (gameData.awayStarterName || g.awayStarterName) || null,
      homeStarter: (gameData.homeStarterName || g.homeStarterName) || null,
      awayPitcher: (gameData.awayCurrentPitcherName || g.awayCurrentPitcherName) || null,
      homePitcher: (gameData.homeCurrentPitcherName || g.homeCurrentPitcherName) || null,
      broadChannel: g.broadChannel || null,
      lineup,
      gameId: String(g.gameId || ''),
    };
  }

  try {
    const rawGames = await fetchSchedule(ystdDash, tmrDash);

    // 모든 경기 상세 조회 (SCHEDULED 포함 → 선발 라인업 확보)
    const detailMap = {};
    await Promise.all(
      rawGames.map(async g => {
        const detail = await fetchGameDetail(g.gameId);
        if (detail) detailMap[g.gameId] = detail;
      })
    );

    const allGames = rawGames.map(g => convertGame(g, detailMap[g.gameId] || null));
    const ystdGames  = allGames.filter(g => g.date === ystdDash);
    const todayGames = allGames.filter(g => g.date === todayDash);
    const tmrGames   = allGames.filter(g => g.date === tmrDash);

    return res.status(200).json({
      games: allGames,
      date: todayStr,
      yesterday: ystdGames.length,
      today: todayGames.length,
      tomorrow: tmrGames.length,
      total: allGames.length,
      note: allGames.length === 0 ? '오늘 KBO 경기 없음' : undefined,
    });
  } catch (e) {
    return res.status(200).json({ games: [], date: todayStr, error: e.message });
  }
}
