const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const dataDir = path.join(__dirname, 'data');
const loadoutFile = path.join(__dirname, 'loadout.json');

app.get('/api/ships', (req, res) => {
  const p = path.join(dataDir, 'ships.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'ships.json not found' });
  res.sendFile(p);
});

app.get('/api/items', (req, res) => {
  const p = path.join(dataDir, 'items.json');
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'items.json not found' });
  res.sendFile(p);
});

app.get('/api/loadout', (req, res) => {
  if (!fs.existsSync(loadoutFile)) return res.json({ loadout: null });
  try {
    const raw = fs.readFileSync(loadoutFile, 'utf8');
    return res.type('json').send(raw);
  } catch (e) {
    return res.status(500).json({ error: 'failed to read loadout' });
  }
});

function loadJSONSafe(p) {
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

// Enriched overlay: merges current loadout with stats from ships/items JSON
app.get('/api/overlay', (req, res) => {
  const loadoutData = loadJSONSafe(loadoutFile);
  if (!loadoutData || !loadoutData.loadout) return res.json({ overlay: null });

  const ships = loadJSONSafe(path.join(dataDir, 'ships.json')) || [];
  const items = loadJSONSafe(path.join(dataDir, 'items.json')) || [];

  const loadout = loadoutData.loadout;

  // Find ship info by exact or substring match
  let shipInfo = null;
  if (loadout.ship) {
    const sname = loadout.ship.toLowerCase();
    shipInfo = ships.find(s => (s.name && s.name.toLowerCase() === sname) || (s.id && s.id.toLowerCase() === sname));
    if (!shipInfo) shipInfo = ships.find(s => s.name && s.name.toLowerCase().includes(sname));
  }

  // Enrich components: try to match by id or name substring (case-insensitive)
  const enrichedComponents = Object.entries(loadout.components || {}).map(([compName, count]) => {
    const key = compName.toLowerCase();
    let item = items.find(it => (it.id && it.id.toLowerCase() === key) || (it.name && it.name.toLowerCase() === key));
    if (!item) item = items.find(it => it.name && it.name.toLowerCase().includes(key));
    return { name: compName, count, item: item || null };
  });

  return res.json({ overlay: { ship: shipInfo, components: enrichedComponents, raw: loadout } });
});

app.get('/', (req, res) => res.send('versecon-link ship-stats server'));

app.listen(PORT, () => {
  console.log(`ship-stats server listening on http://localhost:${PORT}`);
});
