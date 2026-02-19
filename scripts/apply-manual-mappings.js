const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');
const MANUAL_PATH = path.join(DATA_DIR, 'manual-mappings.json');

function read(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
const index = read(INDEX_PATH) || {};
const manual = read(MANUAL_PATH) || {};

let applied = 0;

if (manual && typeof manual === 'object') {
  // archetype mappings
  const archMap = manual['# archetype example'] || manual.archetype || {};
  for (const [arch, id] of Object.entries(archMap)) {
    if (!id) continue;
    if (index.itemsById && index.itemsById[id]) {
      index.itemsByArchetype = index.itemsByArchetype || {};
      index.itemsByArchetype[arch] = index.itemsById[id];
      applied++;
    } else if (index.shipsById && index.shipsById[id]) {
      index.shipsByArchetype = index.shipsByArchetype || {};
      index.shipsByArchetype[arch] = index.shipsById[id];
      applied++;
    }
  }

  // numeric mappings
  const numMap = manual['# numericId example'] || manual.numericId || {};
  for (const [num, id] of Object.entries(numMap)) {
    if (!id) continue;
    index.itemsByNumericId = index.itemsByNumericId || {};
    index.shipsByNumericId = index.shipsByNumericId || {};
    if (index.itemsById && index.itemsById[id]) index.itemsByNumericId[String(num)] = index.itemsById[id];
    if (index.shipsById && index.shipsById[id]) index.shipsByNumericId[String(num)] = index.shipsById[id];
    applied++;
  }
}

if (applied > 0) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  console.log('Applied', applied, 'manual mappings');
} else {
  console.log('No manual mappings applied (edit', MANUAL_PATH, 'to add mappings)');
}
