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

  const todayStr  = `${yyyy}${mm}${dd}`;
  const tmrStr    = `${yyyy2}${mm2}${dd2}`;
  const todayDash = `${yyyy}-${mm}-${dd}`;
  const tmrDash   = `${yyyy2}-${mm2}-${dd2}`;

  const TEAM_MAP = {
    'KIA 타이거즈':'KIA','KT 위즈':'KT','LG 트윈스':'LG','SSG 랜더스':'SSG',
    'NC 다이노스':'NC','두산 베어스':'두산','롯데 자이언츠':'롯데',
    '삼성 라이온즈':'삼성','한화 이글스':'한화','키움 히어로즈':'키움',
    'KIA':'KIA','KT':'KT','LG':'LG','SSG':'SSG','NC':'NC',
    '두산':'두산','롯데':'롯데','삼성':'삼성','한화':'한화','키움':'키움',
  };
  const KBO_SHORT = ['KIA','KT','LG','SSG','NC','두산','롯데','삼성','한화','키움'];
  const mapTeam = n => {
    if (!n) return n;
    const t = n.trim();
    if (TEAM_MAP[t]) return TEAM_MAP[t];
    for (const [k, v] of Object.entries(TEAM_MAP)) if (t.includes(k)) return v;
    return t;
  };
  const isKbo = n => KBO_SHORT.includes(mapTeam(n));

  // ── 1순위: 다음 스포츠 ──
  async function fetchDaum(dateStr8, dateDash) {
    const url = `https://sports.daum.net/api/schedule/sports?type=kbo&date=${dateStr8}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://sports.daum.net/',
        'Accept': 'application/json',
      }
    });
    if (!r.ok) throw new Error(`Daum ${r.status}`);
    const data = await r.json();
    const list = data?.scheduleList || data?.data || [];
    if (!list.length) throw new Error('Daum empty');

    return list
      .filter(g => isKbo(g.homeName || g.homeTeam) || isKbo(g.awayName || g.awayTeam))
      .map(g => {
        const away = mapTeam(g.awayName || g.awayTeam || g.visitTeamName || '');
        const home = mapTeam(g.homeName || g.homeTeam || g.homeTeamName || '');
        const sc = g.gameStatusCode || '';
        const status = sc === 'BEFORE_GAME' ? 'SCHEDULED'
          : sc === 'FINAL_GAME' ? 'FINAL'
          : sc === 'IN_GAME' ? 'LIVE'
          : 'SCHEDULED';

        const awayInnings = Array(9).fill(-1);
        const homeInnings = Array(9).fill(-1);
        (g.innings || []).forEach((inn, i) => {
          if (i < 9) {
            awayInnings[i] = inn.awayScore ?? inn.visitScore ?? -1;
            homeInnings[i] = inn.homeScore ?? -1;
          }
        });

        let time = g.gameTime || '';
        if (/^\d{4}$/.test(time)) time = time.slice(0,2) + ':' + time.slice(2);
        else if (/^\d{2}:\d{2}/.test(time)) time = time.slice(0,5);

        return {
          date: dateDash, time, away, home,
          stad: g.stadiumName || g.stadium || '',
          status,
          awayScore: g.awayScore != null ? Number(g.awayScore) : (g.visitScore != null ? Number(g.visitScore) : null),
          homeScore: g.homeScore != null ? Number(g.homeScore) : null,
          awayInnings, homeInnings,
          inning: g.currentInning || null,
          winPitcher: g.winPitcher || null,
          losePitcher: g.losePitcher || null,
          awayStarter: g.awayStarterName || g.visitStarterName || null,
          homeStarter: g.homeStarterName || null,
          gameId: String(g.gameId || g.gameCode || ''),
        };
      });
  }

  // ── 2순위: KBO 공식 AJAX ──
  async function fetchKbo(dateStr8, dateDash) {
    const url = `https://www.koreabaseball.com/ws/Schedule/ScoreBoardList.aspx?leId=1&srId=0&seasonId=${dateStr8.slice(0,4)}&date=${dateStr8}`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        'Referer': 'https://www.koreabaseball.com/',
        'Accept': 'application/json, text/javascript, */*',
        'X-Requested-With': 'XMLHttpRequest',
      }
    });
    if (!r.ok) throw new Error(`KBO ${r.status}`);
    const data = await r.json();
    const list = data?.data || data?.gameList || [];
    if (!list.length) throw new Error('KBO empty');

    return list
      .filter(g => isKbo(g.homeTeam) || isKbo(g.awayTeam) || isKbo(g.visitTeamName))
      .map(g => {
        const away = mapTeam(g.awayTeam || g.visitTeamName || '');
        const home = mapTeam(g.homeTeam || g.homeTeamName || '');
        const sc = String(g.gameStatusCd || '');
        const status = sc === '0' ? 'SCHEDULED' : ['1','2','3'].includes(sc) ? 'LIVE' : sc === '4' ? 'FINAL' : 'SCHEDULED';

        const awayInnings = Array(9).fill(-1);
        const homeInnings = Array(9).fill(-1);
        (g.scores || []).forEach((s, i) => {
          if (i < 9) {
            awayInnings[i] = s.visit ?? s.away ?? -1;
            homeInnings[i] = s.home ?? -1;
          }
        });

        let time = g.gameTime || '';
        if (/^\d{4}$/.test(time)) time = time.slice(0,2) + ':' + time.slice(2);

        return {
          date: dateDash, time, away, home,
          stad: g.grdNm || g.stadiumName || '',
          status,
          awayScore: g.visitScore != null ? Number(g.visitScore) : null,
          homeScore: g.homeScore != null ? Number(g.homeScore) : null,
          awayInnings, homeInnings,
          inning: g.currentInning || null,
          winPitcher: g.winPitcher || null,
          losePitcher: g.losePitcher || null,
          awayStarter: g.visitStartPitcher || null,
          homeStarter: g.homeStartPitcher || null,
          gameId: String(g.gmkey || g.gameId || ''),
        };
      });
  }

  async function fetchDate(dateStr8, dateDash) {
    try { const g = await fetchDaum(dateStr8, dateDash); if (g.length) return g; } catch(e) { console.log('Daum:', e.message); }
    try { const g = await fetchKbo(dateStr8, dateDash);  if (g.length) return g; } catch(e) { console.log('KBO:', e.message); }
    return [];
  }

  try {
    const [todayGames, tmrGames] = await Promise.all([
      fetchDate(todayStr, todayDash),
      fetchDate(tmrStr, tmrDash),
    ]);
    const allGames = [...todayGames, ...tmrGames];
    return res.status(200).json({
      games: allGames,
      date: todayStr,
      today: todayGames.length,
      tomorrow: tmrGames.length,
      total: allGames.length,
      note: allGames.length === 0 ? '오늘 KBO 경기 없음' : undefined,
    });
  } catch(e) {
    return res.status(200).json({ games:[], date:`${yyyy}${mm}${dd}`, error: e.message });
  }
}
