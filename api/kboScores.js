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
  const yest = new Date(kst.getTime() - 24 * 60 * 60 * 1000);
  const yyyy0 = yest.getUTCFullYear(), mm0 = pad(yest.getUTCMonth() + 1), dd0 = pad(yest.getUTCDate());

  const todayDash = `${yyyy}-${mm}-${dd}`;
  const tmrDash   = `${yyyy2}-${mm2}-${dd2}`;
  const yesterDash= `${yyyy0}-${mm0}-${dd0}`;
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

  // 라인업: game-polling API (inning=1부터 시작)
  async function fetchLineup(gameId, inning) {
    const inn = inning || 1;
    const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=${inn}&isHighlight=false`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) return { error: `${r.status}`, url };
    const data = await r.json();
    const result = data?.result;
    if (!result) return { error: 'no result', url };
    return { data: result, url };
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
        const prev = players.find(p => p.cout==='true' && p !== current);
        return {
          order: Number(order),
          name: current.name,
          pos: current.posName || '',
          hit: current.hit || 0,
          ab: current.ab || 0,
          rbi: current.rbi || 0,
          sub: prev?.name || null,
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

  function convertGame(g, lineupResult) {
    const away = mapTeam(g.awayTeamCode) || g.awayTeamName;
    const home = mapTeam(g.homeTeamCode) || g.homeTeamName;
    const sc = g.statusCode || '';
    const status = sc==='BEFORE'?'SCHEDULED': sc==='STARTED'?'LIVE': sc==='RESULT'?'FINAL':'SCHEDULED';

    let inning = null;
    if (g.statusInfo) { const m = g.statusInfo.match(/(\d+)회/); if(m) inning=parseInt(m[1]); }

    let time = '';
    if (g.gameDateTime) { const t=g.gameDateTime.split('T')[1]||''; const [h,mi]=t.split(':'); if(h&&mi) time=`${h}:${mi}`; }

    const gameData = lineupResult?.data?.game || g;
    const awayInnRaw = gameData.awayTeamScoreByInning || g.awayTeamScoreByInning || [];
    const homeInnRaw = gameData.homeTeamScoreByInning || g.homeTeamScoreByInning || [];

    const awayInnings = Array(9).fill(-1);
    const homeInnings = Array(9).fill(-1);
    awayInnRaw.forEach((s,i)=>{ if(i<9&&s!=='-') awayInnings[i]=Number(s); });
    homeInnRaw.forEach((s,i)=>{ if(i<9&&s!=='-') homeInnings[i]=Number(s); });

    let lineup = null;
    if (lineupResult?.data) {
      const d = lineupResult.data;
      if (d.homeLineup || d.awayLineup) {
        lineup = {
          home: {
            batters: parseBatters(d.homeLineup?.batter),
            pitchers: parsePitchers(d.homeLineup?.pitcher),
          },
          away: {
            batters: parseBatters(d.awayLineup?.batter),
            pitchers: parsePitchers(d.awayLineup?.pitcher),
          },
        };
      }
    }

    return {
      date: g.gameDate || '',
      time,
      away,
      home,
      stad: g.stadium || gameData.stadium || '',
      status,
      awayScore: g.awayTeamScore!=null ? Number(g.awayTeamScore) : null,
      homeScore: g.homeTeamScore!=null ? Number(g.homeTeamScore) : null,
      awayInnings,
      homeInnings,
      inning,
      inningInfo: g.statusInfo || null,
      winPitcher:  gameData.winPitcherName  || g.winPitcherName  || null,
      losePitcher: gameData.losePitcherName || g.losePitcherName || null,
      awayStarter: gameData.awayStarterName || g.awayStarterName || null,
      homeStarter: gameData.homeStarterName || g.homeStarterName || null,
      awayPitcher: gameData.awayCurrentPitcherName || g.awayCurrentPitcherName || null,
      homePitcher: gameData.homeCurrentPitcherName || g.homeCurrentPitcherName || null,
      broadChannel: g.broadChannel || null,
      lineup,
      lineupError: lineupResult?.error || null, // 디버그용
      gameId: String(g.gameId || ''),
    };
  }

  try {
    // 어제 경기가 오늘 날짜로 잡히는 경우 있어서 어제~내일 범위로 조회
    const kstHour = kst.getUTCHours();
    const fromDate = kstHour < 6 ? yesterDash : todayDash; // 새벽 6시 전이면 어제 포함
    const rawGames = await fetchSchedule(fromDate, tmrDash);

    // LIVE/FINAL 게임만 라인업 조회
    const liveOrFinal = rawGames.filter(g => g.statusCode==='STARTED' || g.statusCode==='RESULT');
    const lineupMap = {};
    await Promise.all(
      liveOrFinal.map(async g => {
        const inn = (() => {
          if (!g.statusInfo) return 1;
          const m = g.statusInfo.match(/(\d+)회/);
          return m ? parseInt(m[1]) : 1;
        })();
        lineupMap[g.gameId] = await fetchLineup(g.gameId, inn);
      })
    );

    const allGames = rawGames.map(g => convertGame(g, lineupMap[g.gameId] || null));

    // 날짜별 분류
    const todayGames     = allGames.filter(g => g.date === todayDash);
    const tmrGames       = allGames.filter(g => g.date === tmrDash);
    const yesterdayGames = allGames.filter(g => g.date === yesterDash);

    return res.status(200).json({
      games: allGames,
      date: todayStr,
      yesterday: yesterdayGames.length,
      today: todayGames.length,
      tomorrow: tmrGames.length,
      total: allGames.length,
      note: allGames.length===0 ? '오늘 KBO 경기 없음' : undefined,
    });
  } catch(e) {
    return res.status(200).json({ games:[], date:todayStr, error: e.message });
  }
}
