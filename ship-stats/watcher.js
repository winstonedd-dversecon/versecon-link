const fs = require('fs');
const path = require('path');

// Simple tail-follow implementation using file size tracking.
const GAME_LOG = process.env.GAME_LOG || process.argv[2] || '';
if (!GAME_LOG) {
  console.error('Usage: GAME_LOG=/path/to/Game.log node watcher.js');
  process.exit(1);
}

const outFile = path.join(__dirname, 'loadout.json');

let lastSize = 0;
let loadout = {
  ship: null,
  components: {}
};

function writeLoadout() {
  fs.writeFileSync(outFile, JSON.stringify({ loadout, updated: new Date().toISOString() }, null, 2));
}

function parseLine(line) {
  // Generic patterns observed in community logs; permissive capture of names.
  // Examples: "Attached hardpoint: LaserCannon_Medium_02" or "Equip: "OmniHelmet"
  const attachRe = /(?:Attached|attached|Equipped|equip|Equip|attached)[:\s]+(?:hardpoint|weapon|component|item|attachment|)[:\s]*"?([^"\n]+)"?/i;
  const detachRe = /(?:Detached|detached|Unequipped|unequipped|Removed|removed)[:\s]+"?([^"\n]+)"?/i;
  const shipRe = /(?:Spawned|Spawn|Spawn Ship|PlayerShip)[:\s]+"?([^"\n]+)"?/i;

  let m;
  if ((m = line.match(attachRe))) {
    const name = m[1].trim();
    // heuristics: if name contains "ship" or known vehicle keywords, set ship
    if (/ship|mako|constellation|reclaimer|hornet|avenger|m50/i.test(name)) {
      loadout.ship = name;
    } else {
      loadout.components[name] = (loadout.components[name] || 0) + 1;
    }
    writeLoadout();
  } else if ((m = line.match(detachRe))) {
    const name = m[1].trim();
    if (loadout.components[name]) {
      loadout.components[name] = Math.max(0, loadout.components[name] - 1);
      if (loadout.components[name] === 0) delete loadout.components[name];
    }
    writeLoadout();
  } else if ((m = line.match(shipRe))) {
    loadout.ship = m[1].trim();
    writeLoadout();
  }
}

function follow(file) {
  try {
    const stat = fs.statSync(file);
    lastSize = stat.size;
  } catch (e) {
    console.error('Cannot stat Game.log at', file, e.message);
    process.exit(1);
  }

  // Initial write
  writeLoadout();

  fs.watch(file, { persistent: true }, (ev) => {
    if (ev === 'change') {
      try {
        const stat = fs.statSync(file);
        if (stat.size > lastSize) {
          const rs = fs.createReadStream(file, { start: lastSize, end: stat.size });
          let buf = '';
          rs.on('data', (chunk) => { buf += chunk.toString(); });
          rs.on('end', () => {
            const lines = buf.split(/\r?\n/).filter(Boolean);
            lines.forEach(parseLine);
            lastSize = stat.size;
          });
        } else {
          // file truncated or rotated
          lastSize = stat.size;
        }
      } catch (e) {
        console.error('Error reading appended data:', e.message);
      }
    }
  });

  console.log('Watching', file, 'for equip/unequip events.');
}

follow(GAME_LOG);
