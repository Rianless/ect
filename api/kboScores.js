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

  async function fetchLineup(gameId, inning) {
    const inn = inning || 1;
    const urls = [
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/preview`,
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/starting-lineup`,
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/lineup`,
      `https://api-gw.sports.naver.com/schedule/games/${gameId}/game-polling?inning=${inn}&isHighlight=false`,
    ];
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: HEADERS });
        if (!r.ok) continue;
        const data = await r.json();
        if (!data?.result) continue;
        const res = data.result;
        // 어떤 URL이 유효한 라인업을 줬는지 로깅
        const hasData = res.lineUpData || res.awayLineup || res.homeLineup || res.game;
        console.log('[lineup url]', url.split('/').slice(-1)[0], '→ keys:', Object.keys(res), 'hasData:', !!hasData);
        if (hasData) {
          console.log('[lineup game keys]', JSON.stringify(Object.keys(res.game||{})).slice(0,300));
          return res;
        }
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

    // currentGameState: detail 직접 → textRelayData → rawRelays 순으로 탐색
    let bestGs = detail?.currentGameState
      || detail?.textRelayData?.currentGameState
      || null;
    if (!bestGs && rawRelays.length) {
      // rawRelays는 시간순이므로 마지막부터 탐색 (가장 최신)
      for (let ri = 0; ri < rawRelays.length; ri++) {
        const relay = rawRelays[ri];
        if (relay.currentGameState) { bestGs = relay.currentGameState; break; }
        const opts = relay.textOptions || [];
        for (let oi = opts.length - 1; oi >= 0; oi--) {
          if (opts[oi]?.currentGameState) { bestGs = opts[oi].currentGameState; break; }
        }
        if (bestGs) break;
      }
    }
    // bestGs 필드 정규화 (네이버 API는 다양한 필드명 사용)
    if (bestGs) {
      bestGs = {
        ...bestGs,
        ball:   bestGs.ball   ?? bestGs.ballCount   ?? bestGs.balls   ?? 0,
        strike: bestGs.strike ?? bestGs.strikeCount ?? bestGs.strikes ?? 0,
        out:    bestGs.out    ?? bestGs.outCount     ?? bestGs.outs    ?? 0,
        base1:  bestGs.base1  ?? bestGs.runner1      ?? 0,
        base2:  bestGs.base2  ?? bestGs.runner2      ?? 0,
        base3:  bestGs.base3  ?? bestGs.runner3      ?? 0,
        // 투수/타자 이름 정규화 (숫자 ID는 pcode맵으로 이름 변환)
        pitcherName: (()=>{
          const m2 = {};
          const lu2 = detail?.textRelayData || detail;
          [...(lu2?.homeLineup?.batter||[]),...(lu2?.homeLineup?.pitcher||[]),...(lu2?.awayLineup?.batter||[]),...(lu2?.awayLineup?.pitcher||[])].forEach(p=>{if(p.pcode)m2[String(p.pcode)]=p.name||p.playerName||'';});
          return [bestGs.pitcherName, bestGs.currentPitcherName].find(v=>v&&!/^\d+$/.test(String(v)))
            || m2[String(bestGs.pitcher||'')] || '';
        })(),
        batterName: (()=>{
          const m3 = {};
          const lu3 = detail?.textRelayData || detail;
          [...(lu3?.homeLineup?.batter||[]),...(lu3?.homeLineup?.pitcher||[]),...(lu3?.awayLineup?.batter||[]),...(lu3?.awayLineup?.pitcher||[])].forEach(p=>{if(p.pcode)m3[String(p.pcode)]=p.name||p.playerName||'';});
          return [bestGs.batterName, bestGs.currentBatterName].find(v=>v&&!/^\d+$/.test(String(v)))
            || m3[String(bestGs.batter||'')] || '';
        })(),
      };
    }

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

    // currentGameState에 inningInfo 주입 (프론트에서 초/말 판별용)
    const enrichedGs = bestGs ? {
      ...bestGs,
      _inningInfo: g.statusInfo || bestGs.inningDisplay || bestGs.inningText || '',
    } : null;

    return {
      gameId: String(g.gameId || ""),
      date: g.gameDate || '',
      away, home,
      status,
      awayScore: g.awayTeamScore!=null ? Number(g.awayTeamScore) : null,
      homeScore: g.homeTeamScore!=null ? Number(g.homeTeamScore) : null,
      awayInnings, homeInnings,
      inningInfo: g.statusInfo || null,
      currentGameState: enrichedGs,
      textRelays: textRelaysData,
      awayStarter,
      homeStarter,
      winPitcher: gameData.winPitcherName || g.winPitcherName || null,
      losePitcher: gameData.losePitcherName || g.losePitcherName || null,
      lineup: detail ? (() => {
        // 다양한 경로 커버: lineUpData, game-polling의 game 객체, 직접 필드
        const gp = detail.game || {};
        const lu = detail.lineUpData || gp.lineUpData || {};
        const awayL = lu.awayLineup || lu.awayTeamLineup
          || gp.awayLineup || gp.awayTeamLineup
          || detail.awayLineup || detail.awayTeamLineup
          || detail.lineup?.away || {};
        const homeL = lu.homeLineup || lu.homeTeamLineup
          || gp.homeLineup || gp.homeTeamLineup
          || detail.homeLineup || detail.homeTeamLineup
          || detail.lineup?.home || {};
        const awayBatters = awayL.batter || awayL.batters || awayL.batterList || awayL.players || [];
        const homeBatters = homeL.batter || homeL.batters || homeL.batterList || homeL.players || [];
        console.log('[lineup parse] awayB:', awayBatters.length, 'homeB:', homeBatters.length, 'gp keys:', Object.keys(gp).slice(0,10));
        if (!awayBatters.length && !homeBatters.length) return null;
        return {
          away: { batters: awayBatters, pitcher: awayL.pitcher || awayL.pitchers || [] },
          home: { batters: homeBatters, pitcher: homeL.pitcher || homeL.pitchers || [] },
        };
      })() : null,
    };
  }

  try {
    const gameId = req.query.gameId;
    const inning = req.query.inning ? parseInt(req.query.inning) : null;
    const action = req.query.action || '';

    // ── 선수 기록 (타자/투수) ──
    if (action === 'playerStats') {
      const tab = req.query.tab || 'hitter';
      const teamCode = req.query.teamCode || 'HT';
      const seasonCode = req.query.seasonCode || '2026';
      const isHitter = tab === 'hitter';

      // ── 소스 1: 네이버 API (JSON) ──
      const extractNaverPlayers = (data) => {
        const r = data?.result || {};
        return r.seasonPlayerStats || r.playerList || r.players || r.list || null;
      };

      const NAVER_URLS = [
        `https://api-gw.sports.naver.com/stats/kbo/player-stats?seasonCode=${seasonCode}&tab=${tab}&teamCode=${teamCode}&page=1&pageSize=50`,
        `https://m.sports.naver.com/api/kbaseball/stats/player?seasonCode=${seasonCode}&tab=${tab}&teamCode=${teamCode}&page=1&pageSize=50`,
      ];
      const NAVER_HEADERS = [
        {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1',
          'Referer': 'https://m.sports.naver.com/kbaseball/record/index',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
          'x-requested-with': 'XMLHttpRequest',
        },
        {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
          'Referer': 'https://sports.naver.com/kbaseball/record/index',
          'Accept': 'application/json, text/plain, */*',
          'Accept-Language': 'ko-KR,ko;q=0.9',
        },
      ];

      let players = null;
      let lastErr = '';

      // 네이버 JSON API 시도
      outer:
      for (const headers of NAVER_HEADERS) {
        for (const url of NAVER_URLS) {
          try {
            const r = await fetch(url, { headers });
            console.log(`[playerStats/naver] ${url.split('?')[0]} → ${r.status}`);
            if (!r.ok) { lastErr = `naver:${r.status}`; continue; }
            const data = await r.json();
            const p = extractNaverPlayers(data);
            if (p && p.length > 0) { players = p; break outer; }
          } catch(e) { lastErr = `naver:${e.message}`; }
        }
      }

      // ── 소스 2: KBO 공식 WebService ASMX (서버사이드 JSON) ──
      if (!players) {
        try {
          // KBO 공식 사이트 내부 ASMX 웹서비스 — JS 렌더링 없이 서버에서 직접 데이터 반환
          const asmxMethod = isHitter ? 'GetHitterBasicRecordList' : 'GetPitcherBasicRecordList';
          const asmxUrl = `https://www.koreabaseball.com/ws/Record.asmx/${asmxMethod}`;
          const asmxBody = new URLSearchParams({
            leagueId: '1',
            srId: '',
            teamCode: teamCode,
            pageNum: '1',
            pageSize: '50',
            sortKey: isHitter ? 'HRA_CN' : 'ERA_CN',
            orderBy: 'DESC',
            searchName: '',
          });
          const ra = await fetch(asmxUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': isHitter
                ? 'https://www.koreabaseball.com/Record/Player/HitterBasic/BasicRecord.aspx'
                : 'https://www.koreabaseball.com/Record/Player/PitcherBasic/BasicRecord.aspx',
              'X-Requested-With': 'XMLHttpRequest',
              'Accept': 'application/json, text/javascript, */*; q=0.01',
              'Accept-Language': 'ko-KR,ko;q=0.9',
              'Origin': 'https://www.koreabaseball.com',
            },
            body: asmxBody.toString(),
          });
          console.log(`[playerStats/asmx] ${asmxMethod} → ${ra.status}`);
          if (ra.ok) {
            const ct = ra.headers.get('content-type') || '';
            const raw = await ra.text();
            // ASMX는 JSON 또는 XML로 응답할 수 있음
            let parsed = null;
            if (ct.includes('json') || raw.trim().startsWith('{') || raw.trim().startsWith('[')) {
              try { parsed = JSON.parse(raw); } catch(e) {}
            }
            // XML 형태면 간단 파싱
            if (!parsed && raw.includes('<string')) {
              const inner = raw.replace(/<\/?string[^>]*>/g, '').trim();
              try { parsed = JSON.parse(inner); } catch(e) {}
            }
            if (parsed) {
              // 응답 구조 탐색
              const arr = Array.isArray(parsed) ? parsed
                : parsed.d ? (Array.isArray(parsed.d) ? parsed.d : null)
                : parsed.list || parsed.data || parsed.result || null;
              if (arr && arr.length > 0) {
                players = isHitter ? arr.map(p => ({
                  playerName: p.PLAYER_NAME || p.playerName || p.name || '',
                  hitterGame:  p.G_CN || p.gameCount || '',
                  hitterHra:   p.HRA || p.BA || p.hitterHra || '',
                  hitterHit:   p.H_CN || p.hits || p.hitterHit || '',
                  hitterHr:    p.HR_CN || p.homeRuns || p.hitterHr || '',
                  hitterRbi:   p.RBI_CN || p.rbi || p.hitterRbi || '',
                  hitterRun:   p.R_CN || p.runs || p.hitterRun || '',
                  hitterObp:   p.OBP || p.onBase || p.hitterObp || '',
                  hitterOps:   p.OPS || p.hitterOps || '',
                })) : arr.map(p => ({
                  playerName:  p.PLAYER_NAME || p.playerName || p.name || '',
                  pitcherGame: p.G_CN || p.gameCount || '',
                  pitcherEra:  p.ERA || p.pitcherEra || '',
                  pitcherWin:  p.W_CN || p.wins || p.pitcherWin || '',
                  pitcherLose: p.L_CN || p.losses || p.pitcherLose || '',
                  pitcherSv:   p.SV_CN || p.saves || p.pitcherSv || '',
                  pitcherHld:  p.HLD_CN || p.holds || p.pitcherHld || '',
                  pitcherIp:   p.IP || p.innings || p.pitcherIp || '',
                  pitcherKk:   p.KK_CN || p.strikeouts || p.pitcherKk || '',
                  pitcherWhip: p.WHIP || p.pitcherWhip || '',
                }));
                players = players.filter(p => p.playerName);
                if (!players.length) { lastErr += ' asmx:empty_map'; players = null; }
                else console.log(`[playerStats/asmx] mapped ${players.length} players`);
              } else {
                lastErr += ' asmx:no_arr';
                console.log('[playerStats/asmx] parsed but no array. keys:', JSON.stringify(Object.keys(parsed||{})));
              }
            } else {
              lastErr += ' asmx:parse_fail';
              console.log('[playerStats/asmx] raw (first 300):', raw.slice(0,300));
            }
          } else {
            lastErr += ` asmx:${ra.status}`;
          }
        } catch(e) {
          lastErr += ` asmx:${e.message}`;
        }
      }

      // ── 소스 3: 스탯티즈 PHP (서버사이드 HTML) ──
      if (!players) {
        try {
          const teMap = { HT:'KIA', KT:'KT', LG:'LG', SK:'SSG', NC:'NC', OB:'두산', LT:'롯데', SS:'삼성', HH:'한화', WO:'키움' };
          const teamKor = teMap[teamCode] || teamCode;
          // 스탯티즈 PHP stat은 서버사이드 렌더링이라 직접 파싱 가능
          const statizUrl = `https://www.statiz.co.kr/stat.php?opt=0&sopt=0&re=0&ys=${seasonCode}&ye=${seasonCode}&se=0&te=${encodeURIComponent(teamKor)}&tm=&ty=0&qu=auto&po=0&as=&ae=&hi=&un=&pl=&da=1&o1=${isHitter?'HRA_CN':'ERA_CN'}&o2=&de=1&lr=0&tr=&cv=&ml=1&sn=50&si=&cn=50`;
          const rs = await fetch(statizUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
              'Referer': 'https://www.statiz.co.kr/stat.php',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
              'Accept-Language': 'ko-KR,ko;q=0.9',
              'Cookie': 'statiz_lang=ko',
            }
          });
          console.log(`[playerStats/statiz] → ${rs.status}`);
          if (rs.ok) {
            const html = await rs.text();
            players = isHitter
              ? parseStatizHitterTable(html)
              : parseStatizPitcherTable(html);
            if (players && players.length > 0) {
              console.log(`[playerStats/statiz] parsed ${players.length} players`);
            } else {
              lastErr += ' statiz:empty';
              console.log('[playerStats/statiz] empty. html length:', html.length, ' has tbody:', html.includes('<tbody'));
              players = null;
            }
          } else {
            lastErr += ` statiz:${rs.status}`;
          }
        } catch(e) {
          lastErr += ` statiz:${e.message}`;
        }
      }

      if (!players) return res.status(502).json({ error: `선수 데이터를 가져오지 못했어요 (${lastErr})` });

      return res.status(200).json({ result: { seasonPlayerStats: players } });
    }

    // ── HTML 파싱 헬퍼 함수들 ──
    function _stripTags(html) { return html.replace(/<[^>]+>/g, '').replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').trim(); }

    function _parseTableRows(html, tableSelector) {
      // tbody 내의 tr 추출
      const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
      if (!tbodyMatch) return [];
      const tbody = tbodyMatch[1];
      const rows = [];
      const trRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
      let trM;
      while ((trM = trRe.exec(tbody)) !== null) {
        const cells = [];
        const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let tdM;
        while ((tdM = tdRe.exec(trM[1])) !== null) {
          cells.push(_stripTags(tdM[1]));
        }
        if (cells.length > 3) rows.push(cells);
      }
      return rows;
    }

    function parseKboHitterTable(html) {
      const rows = _parseTableRows(html);
      return rows.map(c => ({
        playerName: c[1] || c[0] || '',
        hitterGame: c[2] || '',
        hitterHra: c[3] || '',   // 타율
        hitterHit: c[7] || '',   // 안타
        hitterHr:  c[10] || '',  // 홈런
        hitterRbi: c[11] || '',  // 타점
        hitterRun: c[9] || '',   // 득점
        hitterObp: c[13] || '',  // 출루율
        hitterOps: c[15] || '',  // OPS
      })).filter(p => p.playerName && p.playerName !== '선수명');
    }

    function parseKboPitcherTable(html) {
      const rows = _parseTableRows(html);
      return rows.map(c => ({
        playerName:  c[1] || c[0] || '',
        pitcherGame: c[2] || '',
        pitcherEra:  c[3] || '',  // ERA
        pitcherWin:  c[4] || '',  // 승
        pitcherLose: c[5] || '',  // 패
        pitcherSv:   c[6] || '',  // 세이브
        pitcherHld:  c[7] || '',  // 홀드
        pitcherIp:   c[9] || '',  // 이닝
        pitcherKk:   c[14] || '', // 탈삼진
        pitcherWhip: c[17] || '', // WHIP
      })).filter(p => p.playerName && p.playerName !== '선수명');
    }

    function parseStatizHitterTable(html) {
      // 스탯티즈 테이블 파싱 (컬럼: 순위, 선수, 팀, G, PA, AB, H, 2B, 3B, HR, R, RBI, BB, HBP, SO, SB, AVG, OBP, SLG, OPS, ...)
      const rows = _parseTableRows(html);
      return rows.map(c => ({
        playerName: c[1] || '',
        hitterGame: c[3] || '',
        hitterHra:  c[16] || '', // AVG
        hitterHit:  c[6] || '',  // H
        hitterHr:   c[9] || '',  // HR
        hitterRbi:  c[11] || '', // RBI
        hitterRun:  c[10] || '', // R
        hitterObp:  c[17] || '', // OBP
        hitterOps:  c[19] || '', // OPS
      })).filter(p => p.playerName && !/^[0-9]+$/.test(p.playerName) && p.playerName !== '선수');
    }

    function parseStatizPitcherTable(html) {
      // 스탯티즈 투수 테이블 (컬럼: 순위, 선수, 팀, G, W, L, SV, HLD, IP, H, HR, BB, HBP, SO, ERA, WHIP, ...)
      const rows = _parseTableRows(html);
      return rows.map(c => ({
        playerName:  c[1] || '',
        pitcherGame: c[3] || '',
        pitcherWin:  c[4] || '',  // W
        pitcherLose: c[5] || '',  // L
        pitcherSv:   c[6] || '',  // SV
        pitcherHld:  c[7] || '',  // HLD
        pitcherIp:   c[8] || '',  // IP
        pitcherKk:   c[13] || '', // SO
        pitcherEra:  c[14] || '', // ERA
        pitcherWhip: c[15] || '', // WHIP
      })).filter(p => p.playerName && !/^[0-9]+$/.test(p.playerName) && p.playerName !== '선수');
    }

    if (gameId && action === 'lineup') {
      // game-polling으로 textRelayData 포함 전체 응답 가져오기
      const inn = inning || 1;
      const detail = await fetchGameDetail(gameId, inn);
      if (!detail) {
        // fallback: lineup 전용 API
        const lineupRaw = await fetchLineup(gameId, inn);
        if (!lineupRaw) return res.status(404).json({ error: 'Lineup not found' });
        return res.status(200).json(lineupRaw);
      }
      // textRelayData 안의 homeLineup/awayLineup 추출
      const td = detail.textRelayData || detail;
      const homeLineup = td.homeLineup || detail.homeLineup || null;
      const awayLineup = td.awayLineup || detail.awayLineup || null;
      let gs = td.currentGameState || detail.currentGameState || null;

      // pcode → 이름 맵 구성 (lineup 배열에서 pcode 추출)
      const pcodeMap = {};
      const allPlayers = [
        ...(homeLineup?.batter || []), ...(homeLineup?.pitcher || []),
        ...(awayLineup?.batter || []), ...(awayLineup?.pitcher || []),
      ];
      allPlayers.forEach(p => { if (p.pcode) pcodeMap[String(p.pcode)] = p.name || p.playerName || ''; });

      // currentGameState의 pitcher/batter ID를 이름으로 변환
      if (gs) {
        const isNumId = v => v && /^\d+$/.test(String(v));
        const resolveName = (nameField, idField) => {
          // 이름 필드가 이미 문자열이면 그대로 사용
          if (nameField && !isNumId(nameField)) return nameField;
          // ID 필드로 pcodeMap 조회
          if (idField) {
            const mapped = pcodeMap[String(idField)];
            if (mapped) return mapped;
          }
          // 이름 필드가 숫자 ID면 비움
          return '';
        };
        gs = {
          ...gs,
          pitcherName: resolveName(gs.pitcherName, gs.pitcher),
          batterName:  resolveName(gs.batterName,  gs.batter),
        };
      }
      // 응답: 표준화된 구조
      return res.status(200).json({
        homeLineup,
        awayLineup,
        currentGameState: gs,
        pcodeMap,
        _raw_keys: Object.keys(td).slice(0, 20),
      });
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
    // LIVE/RESULT 경기는 game-polling으로 이닝 스코어+currentGameState 확보
    // BEFORE 경기는 lineup으로 선발 정보만 확보
    const detailMap = {};
    await Promise.all(rawGames.map(async g => {
      try {
        if (g.statusCode === 'STARTED' || g.statusCode === 'RESULT') {
          const inn = g.statusCode === 'RESULT' ? 9 : 1;
          const d = await fetchGameDetail(g.gameId, inn);
          if (d) detailMap[g.gameId] = d;
        } else {
          const lu = await fetchLineup(g.gameId, 1);
          if (lu) detailMap[g.gameId] = lu;
        }
      } catch(e) {}
    }));
    const allGames = rawGames.map(g => convertGame(g, detailMap[g.gameId] || null));
    return res.status(200).json({ games: allGames, date: todayStr });
  } catch(e) {
    return res.status(500).json({ error: e.message });
  }
}

