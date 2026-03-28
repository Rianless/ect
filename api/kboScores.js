export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  // KST 기준 날짜
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const pad = n => String(n).padStart(2, '0');
  const yyyy = kst.getUTCFullYear();
  const mm = pad(kst.getUTCMonth() + 1);
  const dd = pad(kst.getUTCDate());

  // 내일 날짜
  const tmr = new Date(kst.getTime() + 24 * 60 * 60 * 1000);
  const yyyy2 = tmr.getUTCFullYear();
  const mm2 = pad(tmr.getUTCMonth() + 1);
  const dd2 = pad(tmr.getUTCDate());

  const todayDash = "2026-03-28";
  const tmrDash = `${yyyy2}-${mm2}-${dd2}`;

  const TEAM_MAP = {
    'KIA Tigers':'KIA','KT Wiz':'KT','LG Twins':'LG','SSG Landers':'SSG','NC Dinos':'NC',
    'Doosan Bears':'두산','Lotte Giants':'롯데','Samsung Lions':'삼성','Hanwha Eagles':'한화','Kiwoom Heroes':'키움',
  };
  const mapTeam = n => {
    if(!n) return n;
    for(const [k,v] of Object.entries(TEAM_MAP)) if(n.includes(k)) return v;
    return n;
  };

  const parseGames = (gamesRaw, dateStr) => gamesRaw.map(g => {
    const away = g.teams?.away;
    const home = g.teams?.home;
    const ls = g.linescore || {};
    const bs = g.boxscore || {};

    let status = 'SCHEDULED';
    const sc = g.status?.detailedState || '';
    if(['In Progress','Live','Manager Challenge'].includes(sc)) status = 'LIVE';
    else if(['Final','Game Over','Completed Early'].includes(sc)) status = 'FINAL';

    // 이닝 스코어
    const innings = ls.innings || [];
    const awayInnings = Array(9).fill(-1);
    const homeInnings = Array(9).fill(-1);
    innings.forEach((inn,i) => {
      if(i<9){ awayInnings[i]=inn.away?.runs??-1; homeInnings[i]=inn.home?.runs??-1; }
    });

    // 시간 KST 변환
    let time = '';
    if(g.gameDate) {
      const d = new Date(g.gameDate);
      time = d.toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Seoul'});
    }

    // 선발투수 (probablePitchers)
    const awayStarter = g.teams?.away?.probablePitcher?.fullName || null;
    const homeStarter = g.teams?.home?.probablePitcher?.fullName || null;

    return {
      date: dateStr,
      time,
      away: mapTeam(away?.team?.name||''),
      home: mapTeam(home?.team?.name||''),
      stad: g.venue?.name||'',
      status,
      awayScore: away?.score??null,
      homeScore: home?.score??null,
      awayInnings,
      homeInnings,
      inning: ls.currentInning||null,
      winPitcher: g.decisions?.winner?.fullName||null,
      losePitcher: g.decisions?.loser?.fullName||null,
      awayStarter,
      homeStarter,
      gameId: String(g.gamePk||''),
    };
  });

  try {
    // 오늘 + 내일 동시 조회
    const [r1, r2] = await Promise.all([
      fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=6&date=${todayDash}&gameType=R&hydrate=linescore,decisions,probablePitchers`, {
        headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}
      }),
      fetch(`https://statsapi.mlb.com/api/v1/schedule?sportId=6&date=${tmrDash}&gameType=R&hydrate=linescore,decisions,probablePitchers`, {
        headers:{'User-Agent':'Mozilla/5.0','Accept':'application/json'}
      }),
    ]);

    const [d1, d2] = await Promise.all([r1.json(), r2.json()]);

    const todayGames = parseGames((d1?.dates||[]).flatMap(d=>d.games||[]), todayDash);
    const tmrGames = parseGames((d2?.dates||[]).flatMap(d=>d.games||[]), tmrDash);

    const allGames = [...todayGames, ...tmrGames];

    if(!allGames.length) {
      return res.status(200).json({ games:[], date:`${yyyy}${mm}${dd}`, note:'오늘 KBO 경기 없음', total:0 });
    }

    return res.status(200).json({
      games: allGames,
      date: `${yyyy}${mm}${dd}`,
      today: todayGames.length,
      tomorrow: tmrGames.length,
      total: allGames.length,
    });

  } catch(e) {
    res.status(200).json({ games:[], date:`${yyyy}${mm}${dd}`, error: e.message });
  }
}
