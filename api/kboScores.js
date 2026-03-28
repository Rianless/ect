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
    'Origin': 'https://m.sports.naver.com',
  };

  async function fetchSchedule(fromDate, toDate) {
    const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=kbaseball&fromDate=${fromDate}&toDate=${toDate}&size=500`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`schedule ${r.status}`);
    const data = await r.json();
    return (data?.result?.games || []).filter(g => g.categoryId === 'kbo');
  }

  // 라인업 전용 엔드포인트: /schedule/games/{gameId}/lineup
  // 경기 중/종료 모두 동작
  async function fetchLineup(gameId) {
    // 1순위: lineup 전용 엔드포인트
    const urls = [
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/lineup`,
      `https://api-gw.sports.naver.com/game/${gameId}/lineup`,
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=9&isHighlight=false`,
    ];

    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: HEADERS });
        if (!r.ok) continue;
        const data = await r.json();
        const result = data?.result;
        if (!result) continue;

        // homeLineup / awayLineup이 있으면 성공
        if (result.homeLineup || result.awayLineup) return result;

        // textRelayData 안에 homeLineup이 있는 경우 (game-polling 응답)
        if (result.textRelayData?.homeLineup || result.textRelayData?.awayLineup) return result.textRelayData;

        // game 필드 안에 있는 경우
        if (result.game) {
          // relatedGames의 첫 번째 게임에서 lineup 추출 시도
        }
      } catch { continue; }
    }
    return null;
  }

  // 경기 상세 (이닝스코어 + 라인업 모두 포함된 엔드포인트)
  async function fetchGameDetail(gameId, inning) {
    const inn = inning || 1;
    // game-polling은 특정 이닝의 textRelayData를 줌 → inning=1이면 전체 라인업 포함
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

  function buildLineup(detail) {
    if (!detail) return null;

    // game-polling 응답 구조: result.textRelayData.homeLineup / awayLineup
    const td = detail.textRelayData || detail;
    const home = td.homeLineup || detail.homeLineup;
    const away = td.awayLineup || detail.awayLineup;

    if (!home && !away) return null;

    return {
      home: {
        batters: parseBatters(home?.batter),
        pitchers: parsePitchers(home?.pitcher),
      },
      away: {
        batters: parseBatters(away?.batter),
        pitchers: parsePitchers(away?.pitcher),
      },
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
      lineup: buildLineup(detail),
      gameId: String(g.gameId || ''),
    };
  }

  try {
    const rawGames = await fetchSchedule(todayDash, tmrDash);

    // LIVE/FINAL 게임만 상세 조회
    const liveOrFinal = rawGames.filter(g => g.statusCode==='STARTED' || g.statusCode==='RESULT');
    const detailMap = {};

    await Promise.all(
      liveOrFinal.map(async g => {
        // FINAL은 마지막 이닝(9회 혹은 연장), LIVE는 현재 이닝으로 조회
        let inn = 9;
        if (g.statusCode === 'STARTED' && g.statusInfo) {
          const m = g.statusInfo.match(/(\d+)회/);
          if (m) inn = parseInt(m[1]);
        }
        const detail = await fetchGameDetail(g.gameId, inn);
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
