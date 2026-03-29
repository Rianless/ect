const fs = require('fs');
const path = require('path');

function replaceBlock(text, startPattern, endPattern, replacement) {
  const regex = new RegExp(`${startPattern}[\\s\\S]*?${endPattern}`, 'm');
  return text.replace(regex, `${replacement}\r\n${endPattern.replace(/\\(.)/g, '$1')}`);
}

const downloadsRoot = 'C:\\Users\\user\\Downloads';
const projectRoot = fs.readdirSync(downloadsRoot, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => path.join(downloadsRoot, entry.name))
  .find(dir =>
    fs.existsSync(path.join(dir, 'index.html')) &&
    fs.existsSync(path.join(dir, 'api', 'kboScores.js'))
  );

if (!projectRoot) {
  throw new Error('Project root not found.');
}

const indexPath = path.join(projectRoot, 'index.html');
const apiPath = path.join(projectRoot, 'api', 'kboScores.js');

let indexText = fs.readFileSync(indexPath, 'utf8');
let apiText = fs.readFileSync(apiPath, 'utf8');

const helperBlock = `function normalizeLineupPlayer(player, index=0) {
  const order = player?.n ?? player?.order ?? index + 1;
  const starterName = player?.starterName || player?.starter?.name || player?.sub || player?.name || '';
  const starterPos = normalizePositionLabel(player?.starterPos ?? player?.starter?.pos ?? player?.originalPos ?? '');
  const currentPos = normalizePositionLabel(player?.p ?? player?.pos ?? player?.posName ?? '');
  const displayPos = ['PR', 'PH', '-'].includes(currentPos) && starterPos && starterPos !== '-' ? starterPos : currentPos;
  return {
    ...player,
    n: order,
    order,
    name: player?.name || '',
    starterName,
    starterPos,
    currentPos,
    p: displayPos,
    pos: displayPos,
    sub: player?.sub || ((starterName && starterName !== (player?.name || '')) ? starterName : null),
  };
}
function buildDisplayLineup(players) {
  return (players || []).map((player, index) => normalizeLineupPlayer(player, index)).sort((a, b) => Number(a.order) - Number(b.order));
}
function getFieldPlayers(players) {
  const seen = new Set();
  return buildDisplayLineup(players)
    .filter(player => !['DH', 'PH', 'PR', '-'].includes(player.p))
    .filter(player => {
      if (seen.has(player.p)) return false;
      seen.add(player.p);
      return true;
    });
}
function getTeamDisplayLines(teamKey) {
  const full = String(T[teamKey]?.name || teamKey || '').trim();
  const parts = full.split(/\\s+/).filter(Boolean);
  if (parts.length <= 1) return { top: full, bottom: '' };
  return { top: parts[0], bottom: parts.slice(1).join(' ') };
}
function formatInningBadge(game) {
  if (!game || game.status !== 'LIVE') return '';
  return game.inningInfo || (game.inning ? \`\${game.inning}회\` : 'LIVE');
}`;

indexText = indexText.replace(
  /function normalizeLineupPlayer\(player, index=0\) \{[\s\S]*?function displayStat\(v\) \{/,
  `${helperBlock}\r\nfunction displayStat(v) {`
);

const browserBattersBlock = `function parseBrowserBatters(batters) {
  if (!batters?.length) return [];
  const orderMap = {};
  batters.forEach(p => {
    const order = p.batOrder;
    if (!orderMap[order]) orderMap[order] = [];
    orderMap[order].push(p);
  });
  return Object.entries(orderMap)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([order, players]) => {
      const starter = players[0] || null;
      const current = players.find(p => p.cin === 'true') || players.find(p => !p.cout) || players[players.length - 1];
      const prev = players.slice().reverse().find(p => p !== current) || starter;
      return {
        n: Number(order),
        order: Number(order),
        name: current?.name || '',
        p: current?.posName || starter?.posName || '',
        pos: current?.posName || starter?.posName || '',
        sub: starter && current && starter.name !== current.name ? starter.name : (prev?.name || null),
        starterName: starter?.name || current?.name || '',
        starterPos: starter?.posName || current?.posName || '',
        hit: current?.hit || 0,
        ab: current?.ab || 0,
        rbi: current?.rbi || 0,
      };
    });
}`;

indexText = indexText.replace(
  /function parseBrowserBatters\(batters\) \{[\s\S]*?function parseBrowserPitchers\(pitchers\) \{/,
  `${browserBattersBlock}\r\nfunction parseBrowserPitchers(pitchers) {`
);

indexText = indexText.replace(
  'const cur=(rawCur||[]).map((player,index)=>normalizeLineupPlayer(player,index));',
  'const cur=buildDisplayLineup(rawCur||[]);'
);

let indexLines = indexText.split(/\r?\n/);
indexLines = indexLines.map(line => {
  if (line.includes('tag-lu') && line.includes('inningInfo')) {
    return '            ${formatInningBadge(g)?`<span class="tag-lu">${formatInningBadge(g)}</span>`:""}';
  }
  if (line.includes('p.sub ?') && line.includes('p.name')) {
    return '                <span style="font-size:12px;font-weight:700;color:${state.dark?\'#fff\':d.text};flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${p.sub ? `${p.name} &larr; ${p.sub}` : p.name}</span>';
  }
  if (line.includes('idx===8 ?') && line.includes('g.awayStarter')) {
    return '                <span style="font-size:10px;color:${d.sub};flex-shrink:0">${idx===8 ? `${p.p} / ${((lt===\'away\' ? (g.awayStarter || g.awayPitcher) : (g.homeStarter || g.homePitcher)) || \'-\')}` : p.p}</span>';
  }
  return line;
});
indexText = indexLines.join('\r\n');

const apiBattersBlock = `  function parseBatters(batters) {
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
        const starter = players[0] || null;
        const current = players.find(player => player.cin === 'true') || players.find(player => !player.cout) || players[players.length - 1];
        const prev = players.slice().reverse().find(player => player !== current) || starter;
        return {
          order: Number(order),
          name: current?.name || '',
          pos: current?.posName || starter?.posName || '',
          hit: current?.hit || 0,
          ab: current?.ab || 0,
          rbi: current?.rbi || 0,
          sub: starter && current && starter.name !== current.name ? starter.name : (prev?.name || null),
          starterName: starter?.name || current?.name || '',
          starterPos: starter?.posName || current?.posName || '',
        };
      });
  }`;

apiText = apiText.replace(
  /  function parseBatters\(batters\) \{[\s\S]*?  function parsePitchers\(pitchers\) \{/,
  `${apiBattersBlock}\r\n  function parsePitchers(pitchers) {`
);

fs.writeFileSync(indexPath, indexText, 'utf8');
fs.writeFileSync(apiPath, apiText, 'utf8');

console.log('Updated:', indexPath);
console.log('Updated:', apiPath);
