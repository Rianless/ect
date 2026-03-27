export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // KST 기준 날짜
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = kst.getUTCFullYear();
  const mm = pad(kst.getUTCMonth() + 1);
  const dd = pad(kst.getUTCDate());
  const dateStr = `${yyyy}${mm}${dd}`;
  const dateStrDash = `${yyyy}-${mm}-${dd}`;

  const TEAM_MAP = {
    'KIA타이거즈':'KIA','KT위즈':'KT','LG트윈스':'LG','SSG랜더스':'SSG','NC다이노스':'NC',
    '두산베어스':'두산','롯데자이언츠':'롯데','삼성라이온즈':'삼성','한화이글스':'한화','키움히어로즈':'키움',
    'KIA Tigers':'KIA','KT Wiz':'KT','LG Twins':'LG','SSG Landers':'SSG','NC Dinos':'NC',
    'Doosan Bears':'두산','Lotte Giants':'롯데','Samsung Lions':'삼성','Hanwha Eagles':'한화','Kiwoom Heroes':'키움',
  };
  const mapTeam = n => {
    if(!n) return n;
    const clean = n.replace(/\s/g,'');
    for(const [k,v] of Object.entries(TEAM_MAP)) {
      if(clean.includes(k.replace(/\s/g,''))) return v;
    }
    return n;
  };

  // 1차: 네이버 스포츠 스크래핑
  try {
    const url = `https://sports.naver.com/kbaseball/schedule/index?date=${dateStr}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9',
        'Referer': 'https://sports.naver.com/',
      }
    });

    const html = await r.text();

    // __NEXT_DATA__ 파싱
    const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
    if(match) {
      const nextData = JSON.parse(match[1]);
      // 여러 경로 탐색
      const pageProps = nextData?.props?.pageProps || {};
      const dehydrated = pageProps?.dehydratedState?.queries || [];

      let rawGames = [];

      // dehydratedState에서 경기 데이터 찾기
      for(const q of dehydrated) {
        const data = q?.state?.data;
        if(!data) continue;
        const games = data?.games || data?.gameList || data?.scheduleList || [];
        if(Array.isArray(games) && games.length > 0) {
          rawGames = games;
          break;
        }
        // 중첩된 경우
        if(data?.result?.games) { rawGames = data.result.games; break; }
        if(data?.data?.games) { rawGames = data.data.games; break; }
      }

      if(rawGames.length > 0) {
        const games = rawGames.map(g => {
          const sc = String(g.statusCode || g.gameStatusCode || g.status || '');
          let status = 'SCHEDULED';
          if(['1','LIVE','playing'].includes(sc)) status = 'LIVE';
          else if(['2','RESULT','done','FINAL'].includes(sc)) status = 'FINAL';

          const ai = g.awayScoreList || g.awayInnings || [];
          const hi = g.homeScoreList || g.homeInnings || [];

          // 선발투수
          const awayStarter = g.awayStarterName || g.awayPitcher?.name || null;
          const homeStarter = g.homeStarterName || g.homePitcher?.name || null;

          return {
            date: dateStrDash,
            time: (g.gameTime || g.startTime || '').substring(0,5),
            away: mapTeam(g.awayTeamName || g.awayTeam || ''),
            home: mapTeam(g.homeTeamName || g.homeTeam || ''),
            stad: g.stadiumName || g.stadium || '',
            status,
            awayScore: g.awayScore ?? null,
            homeScore: g.homeScore ?? null,
            awayInnings: ai.length ? ai.map(Number) : Array(9).fill(-1),
            homeInnings: hi.length ? hi.map(Number) : Array(9).fill(-1),
            inning: g.currentInning || null,
            winPitcher: g.winPitcher || g.decisions?.winner?.name || null,
            losePitcher: g.losePitcher || g.decisions?.loser?.name || null,
            awayStarter,
            homeStarter,
            gameId: g.gameId || g.id || '',
          };
        });
        return res.status(200).json({ games, date: dateStr, total: games.length, src: 'naver' });
      }

      // 경로 디버그
      const keys = Object.keys(pageProps);
      return res.status(200).json({ games:[], date: dateStr, error:'naver 데이터 경로 못찾음', keys, queryCount: dehydrated.length });
    }

    return res.status(200).json({ games:[], date: dateStr, error:'__NEXT_DATA__ 없음', htmlLen: html.length, preview: html.substring(0,200) });

  } catch(e1) {
    // 2차: MLB Stats API fallback
    try {
      const mlbUrl = `https://statsapi.mlb.com/api/v1/schedule?sportId=6&date=${yyyy}-${mm}-${dd}&gameType=R&hydrate=linescore,boxscore,decisions`;
      const r2 = await fetch(mlbUrl, { headers:{ 'User-Agent':'Mozilla/5.0', 'Accept':'application/json' } });
      const data2 = await r2.json();
      const dates = data2?.dates || [];
      const gamesRaw = dates.flatMap(d => d.games || []);

      if(!gamesRaw.length) {
        return res.status(200).json({ games:[], date: dateStr, note:'오늘 KBO 경기 없음', total:0, src:'mlb' });
      }

      const games = gamesRaw.map(g => {
        const away = g.teams?.away;
        const home = g.teams?.home;
        const ls = g.linescore || {};
        let status = 'SCHEDULED';
        const sc = g.status?.detailedState || '';
        if(['In Progress','Live'].includes(sc)) status = 'LIVE';
        else if(['Final','Game Over','Completed Early'].includes(sc)) status = 'FINAL';
        const innings = ls.innings || [];
        const awayInnings = Array(9).fill(-1);
        const homeInnings = Array(9).fill(-1);
        innings.forEach((inn,i) => { if(i<9){ awayInnings[i]=inn.away?.runs??-1; homeInnings[i]=inn.home?.runs??-1; }});
        let time = '';
        if(g.gameDate) {
          const d = new Date(g.gameDate);
          time = d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
        }
        return {
          date: dateStrDash, time,
          away: mapTeam(away?.team?.name||''),
          home: mapTeam(home?.team?.name||''),
          stad: g.venue?.name||'',
          status,
          awayScore: away?.score??null,
          homeScore: home?.score??null,
          awayInnings, homeInnings,
          inning: ls.currentInning||null,
          winPitcher: g.decisions?.winner?.fullName||null,
          losePitcher: g.decisions?.loser?.fullName||null,
          awayStarter: null,
          homeStarter: null,
          gameId: String(g.gamePk||''),
        };
      });

      return res.status(200).json({ games, date: dateStr, total: games.length, src: 'mlb' });

    } catch(e2) {
      return res.status(200).json({ games:[], date: dateStr, error: e2.message });
    }
  }
}
