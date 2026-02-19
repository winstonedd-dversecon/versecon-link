const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGET_DIR = path.join(ROOT, 'data');
const SOURCE_DIRS = [
  path.join(ROOT, 'data'),
  path.join(ROOT, 'ship-stats', 'data')
];

function readJsonFile(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

const index = {
  itemsByNumericId: {},
  itemsByArchetype: {},
  itemsById: {},
  shipsByNumericId: {},
  shipsByArchetype: {},
  shipsById: {}
};

for (const dir of SOURCE_DIRS) {
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const p = path.join(dir, f);
      const data = readJsonFile(p);
      if (!Array.isArray(data)) continue;

      for (const entry of data) {
        // items/ships may not be strictly typed here; use heuristics
        const isShip = entry.mass || entry.hardpoints || entry.crew;
        const targetPrefix = isShip ? 'ships' : 'items';

        if (entry.numericId) index[targetPrefix + 'ByNumericId'][String(entry.numericId)] = entry;
        if (entry.archetype) index[targetPrefix + 'ByArchetype'][entry.archetype] = entry;
        if (entry.id) index[targetPrefix + 'ById'][entry.id] = entry;
      }
    }
  } catch (e) {
    // skip missing dirs
  }
}

try {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  const outPath = path.join(TARGET_DIR, 'index.json');
  fs.writeFileSync(outPath, JSON.stringify(index, null, 2), 'utf8');
  console.log('Wrote', outPath);
} catch (e) {
  console.error('Failed to write index:', e && e.message);
  process.exit(1);
}
