export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  const pad = n => String(n).padStart(2, '0');
  const requestedDate = String(req?.query?.date || '').trim();
  const isRequestedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate);
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const yyyy = kst.getUTCFullYear();
  const mm = pad(kst.getUTCMonth() + 1);
  const dd = pad(kst.getUTCDate());

  const todayDash = isRequestedDate ? requestedDate : `${yyyy}-${mm}-${dd}`;
  const todayStr  = todayDash.replace(/-/g, '');

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

  // textRelays 배열 재귀 탐색
  function findTextRelaysRecursive(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (Array.isArray(obj)) {
      if (obj.length > 0 && (obj[0].title || obj[0].text || obj[0].type != null)) return obj;
      return null;
    }
    if (obj.textRelays) return obj.textRelays;
    if (obj.relays) return obj.relays;
    if (obj.list) return obj.list;
    for (const key in obj) {
      const found = findTextRelaysRecursive(obj[key]);
      if (found) return found;
    }
    return null;
  }

  // textOptions 마지막 항목에서 결과 텍스트 추출
  function extractResult(item) {
    const opts = item.textOptions || [];
    if (!opts.length) return null;
    const last = opts[opts.length - 1];
    return last?.text || last?.title || null;
  }

  async function fetchSchedule(date) {
    const url = `https://api-gw.sports.naver.com/schedule/games?fields=basic%2Cschedule%2Cbaseball%2CmanualRelayUrl&upperCategoryId=kbaseball&fromDate=${date}&toDate=${date}&size=500`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) throw new Error(`schedule ${r.status}`);
    const data = await r.json();
    return (data?.result?.games || []).filter(g => g.categoryId === 'kbo');
  }

  async function fetchGameDetail(gameId, inning) {
    const inn = inning || 1;
    const url1 = `https://api-gw.sports.naver.com/schedule/games/${gameId}/text-relay?inning=${inn}&isHighlight=false`;
    const url2 = `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=${inn}&isHighlight=false`;
    try {
      const r1 = await fetch(url1, { headers: HEADERS });
      if (r1.ok) {
        const d1 = await r1.json();
        if (d1?.result) return d1.result;
      }
      const r2 = await fetch(url2, { headers: HEADERS });
      if (r2.ok) {
        const d2 = await r2.json();
        return d2?.result || null;
      }
      return null;
    } catch(e) { return null; }
  }

  // lineup 관련 필드를 재귀적으로 찾기
  function findLineupFields(obj, depth) {
    if (!obj || typeof obj !== 'object' || depth > 4) return null;
    if (obj.homeLineup || obj.awayLineup || obj.homeTeamLineup || obj.awayTeamLineup) return obj;
    if (obj.home?.batter || obj.away?.batter) return obj;
    for (const key of Object.keys(obj)) {
      const found = findLineupFields(obj[key], depth + 1);
      if (found) return found;
    }
    return null;
  }

  function normalizeLineup(raw) {
    if (!raw) return null;
    // 다양한 키 구조 정규화
    const homeL = raw.homeLineup || raw.homeTeamLineup || raw.home || null;
    const awayL = raw.awayLineup || raw.awayTeamLineup || raw.away || null;
    if (!homeL && !awayL) return null;
    return { ...raw, homeLineup: homeL, awayLineup: awayL };
  }

  async function fetchLineup(gameId, inning) {
    const inn = inning || 1;
    const urls = [
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/lineup`,
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=${inn}&isHighlight=false`,
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=1&isHighlight=false`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: HEADERS });
        if (!r.ok) continue;
        const data = await r.json();
        const result = data?.result;
        if (!result) continue;
        // 직접 찾기
        if (result.homeLineup || result.awayLineup) return normalizeLineup(result) || result;
        // textRelayData 안
        if (result.textRelayData) {
          const td = result.textRelayData;
          if (td.homeLineup || td.awayLineup) return normalizeLineup(td) || td;
        }
        // 재귀 탐색
        const found = findLineupFields(result, 0);
        if (found) return normalizeLineup(found) || found;
        // 어떤 형태든 result 반환
        return result;
      } catch(e) {}
    }
    return null;
  }

  function convertGame(g, detail) {
    const away = mapTeam(g.awayTeamCode) || g.awayTeamName;
    const home = mapTeam(g.homeTeamCode) || g.homeTeamName;
    const sc = g.statusCode || '';
    const status = sc==='BEFORE'?'SCHEDULED': sc==='STARTED'?'LIVE': sc==='RESULT'?'FINAL':'SCHEDULED';

    const gameData = detail?.game || g;
    const awayInnRaw = gameData.awayTeamScoreByInning || g.awayTeamScoreByInning || [];
    const homeInnRaw = gameData.homeTeamScoreByInning || g.homeTeamScoreByInning || [];

    const awayInnings = Array(9).fill(-1);
    const homeInnings = Array(9).fill(-1);
    awayInnRaw.forEach((s,i)=>{ if(i<9 && s!=='-') awayInnings[i]=Number(s); });
    homeInnRaw.forEach((s,i)=>{ if(i<9 && s!=='-') homeInnings[i]=Number(s); });

    const rawRelays = findTextRelaysRecursive(detail) || [];
    // 각 relay item에 resultText 추가 (textOptions 마지막 항목)
    const textRelaysData = rawRelays.map(item => ({
      ...item,
      resultText: extractResult(item),
    }));

    // 선발투수: 네이버 lineup API 응답의 다양한 경로 커버
    function extractStarterFromDetail(side) {
      if (!detail) return null;

      // 구조 1: detail.{side}Summary.pitcherName
      const summary = detail[`${side}Summary`];
      if (summary?.pitcherName) return summary.pitcherName;
      if (summary?.name) return summary.name;

      // 구조 2: detail.pitchers 배열에서 starter
      const pitchers = detail.pitchers;
      if (Array.isArray(pitchers)) {
        const p = pitchers.find(p =>
          (p.side === side || p.teamSide === side) &&
          (p.type === 'starter' || p.orderNum === 1 || p.startYn === 'Y')
        );
        if (p?.name) return p.name;
        if (p?.pitcherName) return p.pitcherName;
      }

      // 구조 3: detail.{side}Starters 배열
      const starters = detail[`${side}Starters`];
      if (Array.isArray(starters) && starters.length) {
        return starters[0]?.name || starters[0]?.pitcherName || null;
      }

      // 구조 4: detail.{side}Lineup.pitcher 배열 첫 번째
      const lineup = detail[`${side}Lineup`] || detail[`${side}TeamLineup`];
      if (lineup?.pitcher) {
        const arr = Array.isArray(lineup.pitcher) ? lineup.pitcher : [lineup.pitcher];
        const sp = arr.find(p => p.startYn === 'Y' || p.orderNum === 1 || p.type === 'starter');
        if (sp?.name) return sp.name;
        if (arr[0]?.name) return arr[0].name;
      }

      // 구조 5: game-polling 스타일
      const gd = detail.game || {};
      if (side === 'away') {
        return gd.awayStarterName || gd.awayStarter ||
               g.awayStarterName || g.awayStarter || g.awayStarterPitcherName || null;
      } else {
        return gd.homeStarterName || gd.homeStarter ||
               g.homeStarterName || g.homeStarter || g.homeStarterPitcherName || null;
      }
    }

    const awayStarter = extractStarterFromDetail('away');
    const homeStarter = extractStarterFromDetail('home');

    // lineup 데이터 구조 정규화 (homeLineup/awayLineup 또는 home/away)
    let lineupData = null;
    if (detail) {
      const hl = detail.homeLineup || detail.homeTeamLineup || (detail.home?.batter ? detail.home : null);
      const al = detail.awayLineup || detail.awayTeamLineup || (detail.away?.batter ? detail.away : null);
      // textRelayData 안에도 있을 수 있음
      const td2 = detail.textRelayData;
      const hl2 = td2?.homeLineup || td2?.homeTeamLineup;
      const al2 = td2?.awayLineup || td2?.awayTeamLineup;
      const finalHL = hl || hl2;
      const finalAL = al || al2;
      if (finalHL || finalAL) {
        lineupData = { homeLineup: finalHL, awayLineup: finalAL };
      }
    }

    return {
      gameId: String(g.gameId || ""),
      date: g.gameDate || '',
      away, home,
      status,
      awayScore: g.awayTeamScore!=null ? Number(g.awayTeamScore) : null,
      homeScore: g.homeTeamScore!=null ? Number(g.homeTeamScore) : null,
      awayInnings, homeInnings,
      inningInfo: g.statusInfo || null,
      currentGameState: detail?.currentGameState || detail?.textRelayData?.currentGameState || null,
      textRelays: textRelaysData,
      awayStarter,
      homeStarter,
      winPitcher: gameData.winPitcherName || g.winPitcherName || null,
      losePitcher: gameData.losePitcherName || g.losePitcherName || null,
      lineup: lineupData,
    };
  }

  try {
    const gameId = req.query.gameId;
    const inning = req.query.inning ? parseInt(req.query.inning) : null;
    const action = req.query.action || '';

    if (gameId && action === 'lineup') {
      const result = await fetchLineup(gameId, inning);
      if (!result) return res.status(404).json({ error: 'Lineup not found' });
      return res.status(200).json(result);
    }

    if (gameId) {
      const m = String(gameId).match(/^(\d{4})(\d{2})(\d{2})/);
      const gameDateDash = m ? `${m[1]}-${m[2]}-${m[3]}` : todayDash;
      const rawGames = await fetchSchedule(gameDateDash);
      const g = rawGames.find(x => String(x.gameId) === String(gameId));
      if (!g) return res.status(404).json({ error: 'Game not found' });
      const detail = await fetchGameDetail(gameId, inning || (g.statusCode==='RESULT' ? 9 : 1));
      return res.status(200).json(convertGame(g, detail));
    }

    const rawGames = await fetchSchedule(todayDash);
    // 선발 정보를 위해 lineup API 병렬 호출 (BEFORE/STARTED/RESULT 모두)
    const detailMap = {};
    await Promise.all(rawGames.map(async g => {
      try {
        const lineupResult = await fetchLineup(g.gameId, 1);
        if (lineupResult) {
          detailMap[g.gameId] = lineupResult;
          // 디버그: 첫 번째 경기 lineup 응답 키 로깅
          if (rawGames.indexOf(g) === 0) {
            console.log('[DEBUG lineup keys]', Object.keys(lineupResult));
            console.log('[DEBUG lineup sample]', JSON.stringify(lineupResult).slice(0, 500));
          }
        }
      } catch(e) {}
    }));
    const allGames = rawGames.map(g => convertGame(g, detailMap[g.gameId] || null));
    return res.status(200).json({ games: allGames, date: todayStr });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}
