export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

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
  const tmrDash   = `${yyyy2}-${mm2}-${dd2}`;
  const todayStr  = `${yyyy}${mm}${dd}`;

  const TEAM_CODE = {
    'HT':'KIA','KT':'KT','LG':'LG','SK':'SSG','NC':'NC',
    'OB':'두산','LT':'롯데','SS':'삼성','HH':'한화','WO':'키움',
  };
  const mapTeam = code => TEAM_CODE[code] || code;

  async function fetchNaver(fromDate, toDate) {
    const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=kbaseball&fromDate=${fromDate}&toDate=${toDate}&size=500`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://m.sports.naver.com/',
        'Accept': 'application/json',
      }
    });
    if (!r.ok) throw new Error(`Naver API ${r.status}`);
    const data = await r.json();
    const games = data?.result?.games || [];

    return games
      .filter(g => g.categoryId === 'kbo')
      .map(g => {
        const away = mapTeam(g.awayTeamCode) || g.awayTeamName;
        const home = mapTeam(g.homeTeamCode) || g.homeTeamName;

        const sc = g.statusCode || '';
        const status = sc === 'BEFORE'  ? 'SCHEDULED'
                     : sc === 'STARTED' ? 'LIVE'
                     : sc === 'RESULT'  ? 'FINAL'
                     : sc === 'CANCEL'  ? 'CANCEL'
                     : 'SCHEDULED';

        let inning = null;
        if (g.statusInfo) {
          const m = g.statusInfo.match(/(\d+)회/);
          if (m) inning = parseInt(m[1]);
        }

        // gameDateTime은 이미 KST → T 뒤 시간을 그대로 사용
        let time = '';
        if (g.gameDateTime) {
          const timePart = g.gameDateTime.split('T')[1] || '';  // "14:00:00"
          const [h, min] = timePart.split(':');
          if (h && min) time = `${h}:${min}`;  // "14:00"
        }

        return {
          date: g.gameDate || fromDate,
          time,
          away,
          home,
          stad: g.stadium || '',
          status,
          awayScore: g.awayTeamScore != null ? Number(g.awayTeamScore) : null,
          homeScore: g.homeTeamScore != null ? Number(g.homeTeamScore) : null,
          awayInnings: Array(9).fill(-1),
          homeInnings: Array(9).fill(-1),
          inning,
          inningInfo: g.statusInfo || null,
          winPitcher:  g.winPitcherName  || null,
          losePitcher: g.losePitcherName || null,
          awayStarter: g.awayStarterName || null,
          homeStarter: g.homeStarterName || null,
          awayPitcher: g.awayCurrentPitcherName || null,
          homePitcher: g.homeCurrentPitcherName || null,
          broadChannel: g.broadChannel || null,
          gameId: String(g.gameId || ''),
        };
      });
  }

  try {
    const allGames = await fetchNaver(todayDash, tmrDash);
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
