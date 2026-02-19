const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');
const REPORT_PATH = path.join(DATA_DIR, 'match-report.json');

function read(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
const index = read(INDEX_PATH) || {};
const report = read(REPORT_PATH) || {};

const archetypeMatches = (report.unmatched) ? report.unmatched : {};

// threshold: score >= 8 (heuristic)
const SCORE_THRESHOLD = process.env.MATCH_SCORE_THRESHOLD ? Number(process.env.MATCH_SCORE_THRESHOLD) : 8;

let applied = 0;

for (const [arch, info] of Object.entries(archetypeMatches)) {
  if (!Array.isArray(info.candidates) || info.candidates.length === 0) continue;
  const top = info.candidates[0];
  if (top.score >= SCORE_THRESHOLD) {
    // find the entry in itemsById or shipsById
    const id = top.id;
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
}

if (applied > 0) {
  const out = INDEX_PATH + '.auto';
  fs.writeFileSync(out, JSON.stringify(index, null, 2), 'utf8');
  // overwrite live index
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), 'utf8');
  console.log('Applied', applied, 'matches and wrote', out);
} else {
  console.log('No confident matches to apply (threshold', SCORE_THRESHOLD + ')');
}
