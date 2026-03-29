export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = kst.getUTCFullYear();
  const mm = pad(kst.getUTCMonth() + 1);
  const dd = pad(kst.getUTCDate());
  const tmr = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
  const yyyy2 = tmr.getUTCFullYear();
  const mm2 = pad(tmr.getUTCMonth() + 1);
  const dd2 = pad(tmr.getUTCDate());

  const todayDash = `${yyyy}-${mm}-${dd}`;
  const tmrDash = `${yyyy2}-${mm2}-${dd2}`;
  const todayStr = `${yyyy}${mm}${dd}`;
  const requestedDate = typeof req.query?.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : '';
  const fromDate = requestedDate || todayDash;
  const toDate = requestedDate || tmrDash;

  const TEAM_CODE = {
    HT: 'KIA',
    KT: 'KT',
    LG: 'LG',
    SK: 'SSG',
    NC: 'NC',
    OB: '두산',
    LT: '롯데',
    SS: '삼성',
    HH: '한화',
    WO: '키움',
  };

  const HEADERS = {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
    Referer: 'https://m.sports.naver.com/',
    Origin: 'https://m.sports.naver.com',
  };

  const mapTeam = code => TEAM_CODE[code] || code;

  async function fetchJson(url) {
    const response = await fetch(url, { headers: HEADERS });
    if (!response.ok) {
      throw new Error(`${response.status} ${url}`);
    }
    return await response.json();
  }

  async function fetchSchedule(fromDate, toDate) {
    const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=kbaseball&fromDate=${fromDate}&toDate=${toDate}&size=500`;
    const data = await fetchJson(url);
    return (data?.result?.games || []).filter(game => game.categoryId === 'kbo');
  }

  async function fetchGameDetail(gameId, inning) {
    try {
      const inn = Math.max(1, inning || 1);
      const url = `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=${inn}&isHighlight=false`;
      const data = await fetchJson(url);
      return data?.result || null;
    } catch (error) {
      return null;
    }
  }

  function parseBatters(batters) {
    if (!batters?.length) return [];

    const orderMap = {};
    batters.forEach(player => {
      const order = player.batOrder;
      if (!orderMap[order]) orderMap[order] = [];
      orderMap[order].push(player);
    });

    return Object.entries(orderMap)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([order, players]) => {
        const current = players.find(player => player.cin === 'true') || players.find(player => !player.cout) || players[players.length - 1];
        const prev = players.find(player => player.cout === 'true' && player !== current);
        return {
          order: Number(order),
          name: current?.name || '',
          pos: current?.posName || '',
          hit: current?.hit || 0,
          ab: current?.ab || 0,
          rbi: current?.rbi || 0,
          sub: prev?.name || null,
        };
      });
  }

  function parsePitchers(pitchers) {
    if (!pitchers?.length) return [];
    return pitchers.map(player => ({
      seqno: player.seqno,
      name: player.name,
      inn: player.inn || '0',
      er: player.er || 0,
      kk: player.kk || 0,
      bb: player.bb || 0,
    }));
  }

  function buildLineup(detail) {
    if (!detail) return null;

    const relay = detail.textRelayData || detail;
    const home = relay.homeLineup || detail.homeLineup;
    const away = relay.awayLineup || detail.awayLineup;

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

  function parseInning(statusInfo) {
    const match = String(statusInfo || '').match(/(\d+)/);
    return match ? Number(match[1]) : null;
  }

  function pickFirstNumber(...values) {
    for (const value of values) {
      if (value === null || value === undefined || value === '') continue;
      const num = Number(value);
      if (!Number.isNaN(num)) return num;
    }
    return null;
  }

  function convertGame(game, detail) {
    const gameData = detail?.game || game;
    const awayRaw = gameData.awayTeamScoreByInning || game.awayTeamScoreByInning || [];
    const homeRaw = gameData.homeTeamScoreByInning || game.homeTeamScoreByInning || [];
    const awayInnings = Array(9).fill(-1);
    const homeInnings = Array(9).fill(-1);

    awayRaw.forEach((score, index) => {
      if (index < 9 && score !== '-') awayInnings[index] = Number(score);
    });
    homeRaw.forEach((score, index) => {
      if (index < 9 && score !== '-') homeInnings[index] = Number(score);
    });

    const statusCode = game.statusCode || '';
    const status = statusCode === 'BEFORE'
      ? 'SCHEDULED'
      : statusCode === 'STARTED'
        ? 'LIVE'
        : statusCode === 'RESULT'
          ? 'FINAL'
          : 'SCHEDULED';

    return {
      date: game.gameDate || '',
      time: game.gameDateTime?.split('T')[1]?.slice(0, 5) || '',
      away: mapTeam(game.awayTeamCode) || game.awayTeamName,
      home: mapTeam(game.homeTeamCode) || game.homeTeamName,
      stad: game.stadium || gameData.stadium || '',
      status,
      awayScore: game.awayTeamScore != null ? Number(game.awayTeamScore) : null,
      homeScore: game.homeTeamScore != null ? Number(game.homeTeamScore) : null,
      awayInnings,
      homeInnings,
      inning: parseInning(game.statusInfo),
      inningInfo: game.statusInfo || null,
      winPitcher: gameData.winPitcherName || game.winPitcherName || null,
      losePitcher: gameData.losePitcherName || game.losePitcherName || null,
      awayStarter: gameData.awayStarterName || game.awayStarterName || null,
      homeStarter: gameData.homeStarterName || game.homeStarterName || null,
      awayPitcher: gameData.awayCurrentPitcherName || game.awayCurrentPitcherName || null,
      homePitcher: gameData.homeCurrentPitcherName || game.homeCurrentPitcherName || null,
      awayHit: pickFirstNumber(gameData.awayTeamHit, game.awayTeamHit, gameData.awayTeamHits, game.awayTeamHits),
      homeHit: pickFirstNumber(gameData.homeTeamHit, game.homeTeamHit, gameData.homeTeamHits, game.homeTeamHits),
      awayError: pickFirstNumber(gameData.awayTeamError, game.awayTeamError, gameData.awayTeamErrors, game.awayTeamErrors),
      homeError: pickFirstNumber(gameData.homeTeamError, game.homeTeamError, gameData.homeTeamErrors, game.homeTeamErrors),
      awayBaseOnBalls: pickFirstNumber(gameData.awayTeamBaseOnBalls, game.awayTeamBaseOnBalls, gameData.awayTeamWalks, game.awayTeamWalks, gameData.awayTeamBallFour, game.awayTeamBallFour),
      homeBaseOnBalls: pickFirstNumber(gameData.homeTeamBaseOnBalls, game.homeTeamBaseOnBalls, gameData.homeTeamWalks, game.homeTeamWalks, gameData.homeTeamBallFour, game.homeTeamBallFour),
      broadChannel: game.broadChannel || null,
      lineup: buildLineup(detail),
      currentGameState: detail?.textRelayData?.currentGameState || detail?.currentGameState || null,
      gameId: String(game.gameId || ''),
    };
  }

  try {
    const rawGames = await fetchSchedule(fromDate, toDate);
    const detailMap = {};

    await Promise.all(rawGames.map(async game => {
      const shouldFetchDetail = ['BEFORE', 'STARTED', 'RESULT'].includes(game.statusCode);
      if (!shouldFetchDetail) return;

      let inning = 1;
      if (game.statusCode === 'RESULT') inning = 9;
      if (game.statusCode === 'STARTED') inning = parseInning(game.statusInfo) || 1;

      const detail = await fetchGameDetail(game.gameId, inning);
      if (detail) detailMap[game.gameId] = detail;
    }));

    const games = rawGames.map(game => convertGame(game, detailMap[game.gameId] || null));
    const todayGames = games.filter(game => game.date === fromDate);
    const tomorrowGames = games.filter(game => game.date === toDate);

    return res.status(200).json({
      games,
      date: todayStr,
      today: todayGames.length,
      tomorrow: tomorrowGames.length,
      total: games.length,
      note: games.length === 0 ? '오늘 KBO 경기가 없습니다.' : undefined,
    });
  } catch (error) {
    return res.status(200).json({
      games: [],
      date: todayStr,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
