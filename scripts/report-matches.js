const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const INDEX_PATH = path.join(DATA_DIR, 'index.json');
const LOADOUT_PATH = path.join(ROOT, 'loadout.json');
const OUT_PATH = path.join(DATA_DIR, 'match-report.json');

function read(p) { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return null; } }
const index = read(INDEX_PATH) || {};
const loadout = read(LOADOUT_PATH) || {};

const entries = Object.assign({}, index.itemsById || {}, index.shipsById || {});
const entryList = Object.entries(entries).map(([id, e]) => ({ id, name: e.name || id, archetype: e.archetype || '' }));

function tokens(s) { return String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }

function tokenOverlap(a, b) {
  const A = new Set(tokens(a));
  const B = new Set(tokens(b));
  let common = 0; for (const t of A) if (B.has(t)) common++;
  return common;
}

function longestCommonSubstring(a, b) {
  const A = String(a || ''), B = String(b || '');
  const m = Array.from({ length: A.length + 1 }, () => Array(B.length + 1).fill(0));
  let max = 0;
  for (let i = 1; i <= A.length; i++) {
    for (let j = 1; j <= B.length; j++) {
      if (A[i-1] === B[j-1]) {
        m[i][j] = m[i-1][j-1] + 1;
        if (m[i][j] > max) max = m[i][j];
      }
    }
  }
  return max;
}

const report = { generatedAt: new Date().toISOString(), unmatched: {} };

const indexMatches = (index._matches && index._matches.archetypeToIds) || {};

const archetypes = new Set((Array.isArray(loadout.attachments) ? loadout.attachments.map(a => a.archetype) : []).filter(Boolean));

for (const arch of archetypes) {
  const already = indexMatches[arch] && indexMatches[arch].length;
  if (already) continue;

  const candidates = entryList.map(e => {
    const tOverlap = tokenOverlap(arch, e.id) + tokenOverlap(arch, e.archetype) + tokenOverlap(arch, e.name);
    const lcs = Math.max(longestCommonSubstring(arch, e.id), longestCommonSubstring(arch, e.archetype), longestCommonSubstring(arch, e.name));
    const score = tOverlap * 10 + lcs;
    return { id: e.id, name: e.name, archetype: e.archetype, score, tOverlap, lcs };
  }).filter(c => c.score > 0).sort((a,b) => b.score - a.score).slice(0, 12);

  report.unmatched[arch] = { countCandidates: candidates.length, candidates };
}

fs.writeFileSync(OUT_PATH, JSON.stringify(report, null, 2), 'utf8');
console.log('Wrote report to', OUT_PATH);
