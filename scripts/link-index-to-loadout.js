const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');
const LOADOUT_PATH = path.join(ROOT, 'loadout.json');

function read(p) {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; }
}

const index = read(INDEX_PATH) || {};
const loadout = read(LOADOUT_PATH) || {};

const itemsById = index.itemsById || {};
const shipsById = index.shipsById || {};
const itemsByNumeric = index.itemsByNumericId || {};
const shipsByNumeric = index.shipsByNumericId || {};
const itemsByArchetype = index.itemsByArchetype || {};
const shipsByArchetype = index.shipsByArchetype || {};

function norm(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_');
}

const archetypeToMatches = {};
const numericToMatches = {};

const allItemEntries = Object.assign({}, itemsById, shipsById);

if (!Array.isArray(loadout.attachments)) {
  console.error('No attachments in', LOADOUT_PATH);
  process.exit(1);
}

for (const a of loadout.attachments) {
  const arch = a.archetype || '';
  const num = String(a.numericId || '');

  // exact numeric match
  if (itemsByNumeric[num]) {
    numericToMatches[num] = numericToMatches[num] || [];
    numericToMatches[num].push(itemsByNumeric[num].id || itemsByNumeric[num].id);
  }
  if (shipsByNumeric[num]) {
    numericToMatches[num] = numericToMatches[num] || [];
    numericToMatches[num].push(shipsByNumeric[num].id || shipsByNumeric[num].id);
  }

  // exact archetype match
  if (itemsByArchetype[arch]) {
    archetypeToMatches[arch] = archetypeToMatches[arch] || [];
    archetypeToMatches[arch].push(itemsByArchetype[arch].id || itemsByArchetype[arch].id);
    continue;
  }
  if (shipsByArchetype[arch]) {
    archetypeToMatches[arch] = archetypeToMatches[arch] || [];
    archetypeToMatches[arch].push(shipsByArchetype[arch].id || shipsByArchetype[arch].id);
    continue;
  }

  // heuristic: compare normalized strings against item ids and archetypes
  const narch = norm(arch);
  const candidates = [];
  for (const [id, entry] of Object.entries(allItemEntries)) {
    const nid = norm(id);
    const nar = norm(entry.archetype || '');
    if (nid && (narch.includes(nid) || nid.includes(narch))) candidates.push(id);
    else if (nar && (narch.includes(nar) || nar.includes(narch))) candidates.push(id);
    else {
      // try token overlap
      const tokensArch = new Set(narch.split('_').filter(Boolean));
      const tokensId = new Set(nid.split('_').filter(Boolean));
      let common = 0;
      for (const t of tokensArch) if (tokensId.has(t)) common++;
      if (common >= 2) candidates.push(id);
    }
  }

  if (candidates.length) {
    archetypeToMatches[arch] = archetypeToMatches[arch] || [];
    for (const c of candidates) archetypeToMatches[arch].push(c);
  }
}

// augment index with match maps
index._matches = index._matches || {};
index._matches.archetypeToIds = archetypeToMatches;
index._matches.numericToIds = numericToMatches;

// also annotate matched entries
for (const [arch, ids] of Object.entries(archetypeToMatches)) {
  for (const id of ids) {
    const target = index.itemsById && index.itemsById[id] ? index.itemsById[id]
                 : index.shipsById && index.shipsById[id] ? index.shipsById[id]
                 : null;
    if (!target) continue;
    target.matchedArchetypes = target.matchedArchetypes || [];
    if (!target.matchedArchetypes.includes(arch)) target.matchedArchetypes.push(arch);
  }
}

for (const [num, ids] of Object.entries(numericToMatches)) {
  for (const id of ids) {
    const target = index.itemsById && index.itemsById[id] ? index.itemsById[id]
                 : index.shipsById && index.shipsById[id] ? index.shipsById[id]
                 : null;
    if (!target) continue;
    target.matchedNumericIds = target.matchedNumericIds || [];
    if (!target.matchedNumericIds.includes(num)) target.matchedNumericIds.push(num);
  }
}

// write mapped index (keep original index.json as backup)
try {
  const mappedPath = path.join(DATA_DIR, 'index.mapped.json');
  const backupPath = path.join(DATA_DIR, 'index.json.bak');
  if (!fs.existsSync(backupPath)) fs.copyFileSync(INDEX_PATH, backupPath);
  fs.writeFileSync(mappedPath, JSON.stringify(index, null, 2), 'utf8');
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  console.log('Wrote mapped index to', mappedPath);
} catch (e) {
  console.error('Failed to write mapped index:', e && e.message);
  process.exit(1);
}
