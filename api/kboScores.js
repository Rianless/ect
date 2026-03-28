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

  const todayDash = `${yyyy}-${mm}-${dd}`;
  const tmrDash   = `${yyyy2}-${mm2}-${dd2}`;
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

  // ── 경기 목록 가져오기 ──
  async function fetchSchedule(fromDate, toDate) {
    const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=kbaseball&fromDate=${fromDate}&toDate=${toDate}&size=500`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`schedule ${r.status}`);
    const data = await r.json();
    return (data?.result?.games || []).filter(g => g.categoryId === 'kbo');
  }

  // ── 게임 상세(라인업 + 이닝스코어) 가져오기 ──
  async function fetchGameDetail(gameId) {
    const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=1&isHighlight=false`;
    try {
      const r = await fetch(url, { headers: HEADERS });
      if (!r.ok) return null;
      const data = await r.json();
      return data?.result || null;
    } catch { return null; }
  }

  // ── 라인업 파싱 ──
  function parseLineup(lineupData) {
    if (!lineupData) return null;

    const parseBatter = (batters) => {
      if (!batters?.length) return [];
      // batOrder 기준으로 그룹화 → 현재 출전 중인 선수만 (cin=true 또는 cout 없는 마지막)
      const orderMap = {};
      batters.forEach(p => {
        const order = p.batOrder;
        if (!orderMap[order]) orderMap[order] = [];
        orderMap[order].push(p);
      });
      return Object.entries(orderMap)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([order, players]) => {
          // cin=true인 선수가 현재 출전, 없으면 cout=null인 선수
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
            sub: prev ? prev.name : null, // 교체된 이전 선수
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

    return {
      home: {
        batters: parseBatter(lineupData.homeLineup?.batter),
        pitchers: parsePitcher(lineupData.homeLineup?.pitcher),
      },
      away: {
        batters: parseBatter(lineupData.awayLineup?.batter),
        pitchers: parsePitcher(lineupData.awayLineup?.pitcher),
      },
    };
  }

  // ── 경기 변환 ──
  function convertGame(g, detail) {
    const away = mapTeam(g.awayTeamCode) || g.awayTeamName;
    const home = mapTeam(g.homeTeamCode) || g.homeTeamName;
    const sc = g.statusCode || '';
    const status = sc === 'BEFORE' ? 'SCHEDULED' : sc === 'STARTED' ? 'LIVE' : sc === 'RESULT' ? 'FINAL' : 'SCHEDULED';

    let inning = null;
    if (g.statusInfo) { const m = g.statusInfo.match(/(\d+)회/); if (m) inning = parseInt(m[1]); }

    let time = '';
    if (g.gameDateTime) { const t = g.gameDateTime.split('T')[1] || ''; const [h, mi] = t.split(':'); if (h && mi) time = `${h}:${mi}`; }

    // 이닝별 스코어 (상세 API 또는 목록 API에서)
    const gameData = detail?.game || g;
    const awayInnRaw = gameData.awayTeamScoreByInning || g.awayTeamScoreByInning || [];
    const homeInnRaw = gameData.homeTeamScoreByInning || g.homeTeamScoreByInning || [];

    // reversedHomeAway=true → 네이버에서 home=원정팀, away=홈팀이 반전되어 있음
    // awayTeamCode=HT(KIA)가 실제 원정, homeTeamCode=SK(SSG)가 실제 홈 → 그대로 사용
    const awayInnings = Array(9).fill(-1);
    const homeInnings = Array(9).fill(-1);
    awayInnRaw.forEach((s, i) => { if (i < 9 && s !== '-') awayInnings[i] = Number(s); });
    homeInnRaw.forEach((s, i) => { if (i < 9 && s !== '-') homeInnings[i] = Number(s); });

    // 라인업
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
      lineup,  // { home: { batters, pitchers }, away: { batters, pitchers } }
      gameId: String(g.gameId || ''),
    };
  }

  try {
    const rawGames = await fetchSchedule(todayDash, tmrDash);

    // LIVE/FINAL 경기만 상세 조회 (예정 경기는 라인업 없음)
    const detailMap = {};
    const liveOrFinal = rawGames.filter(g => g.statusCode === 'STARTED' || g.statusCode === 'RESULT');
    await Promise.all(
      liveOrFinal.map(async g => {
        const detail = await fetchGameDetail(g.gameId);
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
      note: allGames.length === 0 ? '오늘 KBO 경기 없음' : undefined,
    });
  } catch (e) {
    return res.status(200).json({ games: [], date: todayStr, error: e.message });
  }
}
