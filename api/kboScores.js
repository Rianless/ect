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

  // 팀코드 → 짧은 이름
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

    // KBO 리그만 필터 (categoryId === 'kbo')
    return games
      .filter(g => g.categoryId === 'kbo')
      .map(g => {
        // reversedHomeAway=true → homeTeam이 실제론 원정, awayTeam이 실제론 홈
        // 네이버 데이터에서 away=원정(왼쪽), home=홈(오른쪽) 기준으로 맞춤
        const away = mapTeam(g.awayTeamCode) || g.awayTeamName;
        const home = mapTeam(g.homeTeamCode) || g.homeTeamName;

        const sc = g.statusCode || '';
        const status = sc === 'BEFORE'   ? 'SCHEDULED'
                     : sc === 'STARTED'  ? 'LIVE'
                     : sc === 'RESULT'   ? 'FINAL'
                     : sc === 'CANCEL'   ? 'CANCEL'
                     : 'SCHEDULED';

        // 이닝 정보 (statusInfo: "8회초" 같은 형태)
        let inning = null;
        if (g.statusInfo) {
          const m = g.statusInfo.match(/(\d+)회/);
          if (m) inning = parseInt(m[1]);
        }

        // 시작 시간 KST
        let time = '';
        if (g.gameDateTime) {
          const d = new Date(g.gameDateTime);
          time = d.toLocaleTimeString('ko-KR', {hour:'2-digit', minute:'2-digit', timeZone:'Asia/Seoul'});
        }

        const gameDate = (g.gameDate || fromDate);

        return {
          date: gameDate,
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
          inningInfo: g.statusInfo || null,  // "8회초" 등 그대로 보존
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
    // 오늘 + 내일 한 번에 요청 (fromDate ~ toDate)
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
    return res.status(200).json({
      games: [], date: todayStr, error: e.message,
    });
  }
}
