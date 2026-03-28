export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // KST 기준 오늘/내일 날짜
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

  const todayStr = `${yyyy}${mm}${dd}`;
  const tmrStr   = `${yyyy2}${mm2}${dd2}`;
  const todayDash = `${yyyy}-${mm}-${dd}`;
  const tmrDash   = `${yyyy2}-${mm2}-${dd2}`;

  const TEAM_MAP = {
    'KIA':'KIA','KT':'KT','LG':'LG','SSG':'SSG','NC':'NC',
    '두산':'두산','롯데':'롯데','삼성':'삼성','한화':'한화','키움':'키움',
    'KIA 타이거즈':'KIA','KT 위즈':'KT','LG 트윈스':'LG','SSG 랜더스':'SSG','NC 다이노스':'NC',
    '두산 베어스':'두산','롯데 자이언츠':'롯데','삼성 라이온즈':'삼성','한화 이글스':'한화','키움 히어로즈':'키움',
  };
  const mapTeam = n => TEAM_MAP[n] || n;

  const STATUS_MAP = {
    '경기전':'SCHEDULED', '경기중':'LIVE', '종료':'FINAL',
    'BEFORE_GAME':'SCHEDULED', 'CANCEL':'CANCEL',
  };

  async function fetchNaver(dateStr8, dateDash) {
    // 네이버 스포츠 KBO 일정 API
    const url = `https://sports.news.naver.com/kbaseball/schedule/index.nhn?date=${dateStr8}`;
    const apiUrl = `https://api-gw.sports.naver.com/schedule/games?category=kbo&fields=basic,stadium&gameDate=${dateStr8}&roundCode=&size=10`;

    const r = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://sports.news.naver.com/',
        'Accept': 'application/json',
      }
    });

    if (!r.ok) return [];

    const data = await r.json();
    const gameList = data?.result?.games || data?.games || [];

    return gameList.map(g => {
      const away = mapTeam(g.awayTeamName || g.awayTeam || '');
      const home = mapTeam(g.homeTeamName || g.homeTeam || '');

      let status = 'SCHEDULED';
      const rawStatus = g.gameStatus || g.status || '';
      status = STATUS_MAP[rawStatus] || (rawStatus.includes('종료') ? 'FINAL' : rawStatus.includes('경기중') ? 'LIVE' : 'SCHEDULED');

      // 이닝 스코어 파싱
      const awayInnings = Array(9).fill(-1);
      const homeInnings = Array(9).fill(-1);
      if (g.innings) {
        g.innings.forEach((inn, i) => {
          if (i < 9) {
            awayInnings[i] = inn.awayScore ?? inn.away ?? -1;
            homeInnings[i] = inn.homeScore ?? inn.home ?? -1;
          }
        });
      }

      // 시작 시간
      let time = g.gameTime || g.startTime || '';
      if (time && time.length === 4) time = time.slice(0,2) + ':' + time.slice(2);

      return {
        date: dateDash,
        time,
        away,
        home,
        stad: g.stadium || g.stadiumName || '',
        status,
        awayScore: g.awayScore != null ? Number(g.awayScore) : null,
        homeScore: g.homeScore != null ? Number(g.homeScore) : null,
        awayInnings,
        homeInnings,
        inning: g.currentInning || g.inning || null,
        winPitcher: g.winPitcher || null,
        losePitcher: g.losePitcher || null,
        awayStarter: g.awayStartPitcher || g.awayPitcher || null,
        homeStarter: g.homeStartPitcher || g.homePitcher || null,
        gameId: String(g.gameId || g.id || ''),
      };
    });
  }

  try {
    const [todayGames, tmrGames] = await Promise.all([
      fetchNaver(todayStr, todayDash),
      fetchNaver(tmrStr, tmrDash),
    ]);

    const allGames = [...todayGames, ...tmrGames];

    if (!allGames.length) {
      return res.status(200).json({
        games: [],
        date: todayStr,
        note: '오늘 KBO 경기 없음',
        total: 0,
      });
    }

    return res.status(200).json({
      games: allGames,
      date: todayStr,
      today: todayGames.length,
      tomorrow: tmrGames.length,
      total: allGames.length,
    });

  } catch (e) {
    return res.status(200).json({
      games: [],
      date: `${yyyy}${mm}${dd}`,
      error: e.message,
    });
  }
}
