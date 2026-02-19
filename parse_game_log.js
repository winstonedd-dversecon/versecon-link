const fs = require('fs');
const path = require('path');

const LOG_PATH = path.resolve(__dirname, 'Game.log');
const OUT_PATH = path.resolve(__dirname, 'loadout.json');

function parseLog(logText) {
  const lines = logText.split(/\r?\n/);
  const attachments = [];
  let playerName = null;

  // Example lines seen in the log:
  // <ts> [Notice] <AttachmentReceived> Player[Name] Attachment[id, archetype, 200000000235] Status[persistent] Port[wep_sidearm] ...
  const attachRe = /Attachment\[(.+?),\s*(.+?),\s*(\d+)\].*?Port\[(.+?)\]/i;
  const playerRe = /Player\[([^\]]+)\]/i;
  const timeRe = /^<([^>]+)>/;

  for (const line of lines) {
    if (!line.includes('AttachmentReceived')) continue;
    const tmatch = line.match(timeRe);
    const ts = tmatch ? tmatch[1] : null;
    const p = line.match(playerRe);
    if (p) playerName = p[1];
    const m = line.match(attachRe);
    if (m) {
      attachments.push({
        timestamp: ts,
        attachmentId: m[1].trim(),
        archetype: m[2].trim(),
        numericId: m[3].trim(),
        port: m[4].trim(),
        raw: line
      });
    }
  }

  return { player: playerName, attachments };
}

function main() {
  if (!fs.existsSync(LOG_PATH)) {
    console.error('Game.log not found at', LOG_PATH);
    process.exit(2);
  }

  const text = fs.readFileSync(LOG_PATH, 'utf8');
  const parsed = parseLog(text);
  fs.writeFileSync(OUT_PATH, JSON.stringify(parsed, null, 2));
  console.log('Wrote', OUT_PATH, 'with', parsed.attachments.length, 'attachments');
}

if (require.main === module) main();
