const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());

const PORT = process.env.LOADOUT_API_PORT || 4401;
const ROOT = path.resolve(__dirname, '..', '..');
const LOADOUT_PATH = path.join(ROOT, 'loadout.json');
const ITEMS_PATH = path.join(ROOT, 'data', 'items.json');
const SHIPS_PATH = path.join(ROOT, 'data', 'ships.json');
const INDEX_PATH = path.join(ROOT, 'data', 'index.json');

function safeReadJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (e) {
    return null;
  }
}

app.get('/api/loadout', (req, res) => {
  const j = safeReadJSON(LOADOUT_PATH);
  if (!j) return res.status(404).json({ error: 'loadout.json not found' });
  res.json(j);
});

app.get('/api/loadout/enriched', (req, res) => {
  const loadout = safeReadJSON(LOADOUT_PATH);
  if (!loadout) return res.status(404).json({ error: 'loadout.json not found' });

  const items = safeReadJSON(ITEMS_PATH) || [];
  const ships = safeReadJSON(SHIPS_PATH) || [];
  // prefer prebuilt index.json if present
  const indexJson = safeReadJSON(INDEX_PATH);
  const byNumeric = new Map();
  const byArchetype = new Map();

  if (indexJson) {
    const ibn = indexJson.itemsByNumericId || {};
    const sbn = indexJson.shipsByNumericId || {};
    const iba = indexJson.itemsByArchetype || {};
    const sba = indexJson.shipsByArchetype || {};
    const matches = indexJson._matches || {};
    const matchArche = matches.archetypeToIds || {};
    const matchNumeric = matches.numericToIds || {};

    for (const k of Object.keys(ibn)) byNumeric.set(String(k), ibn[k]);
    for (const k of Object.keys(sbn)) byNumeric.set(String(k), sbn[k]);
    for (const k of Object.keys(iba)) byArchetype.set(k, iba[k]);
    for (const k of Object.keys(sba)) byArchetype.set(k, sba[k]);
    // incorporate mapping matches: prefer explicit index._matches links
    for (const [arch, ids] of Object.entries(matchArche)) {
      if (!ids || !ids.length) continue;
      const id = ids[0];
      const entry = (indexJson.itemsById && indexJson.itemsById[id]) || (indexJson.shipsById && indexJson.shipsById[id]) || null;
      if (entry) byArchetype.set(arch, entry);
    }
    for (const [num, ids] of Object.entries(matchNumeric)) {
      if (!ids || !ids.length) continue;
      const id = ids[0];
      const entry = (indexJson.itemsById && indexJson.itemsById[id]) || (indexJson.shipsById && indexJson.shipsById[id]) || null;
      if (entry) byNumeric.set(String(num), entry);
    }
  } else {
    function index(list) {
      if (!Array.isArray(list)) return;
      for (const it of list) {
        if (it.numericId) byNumeric.set(String(it.numericId), it);
        if (it.archetype) byArchetype.set(it.archetype, it);
      }
    }

    index(items);
    index(ships);
  }

  const enriched = loadout.attachments.map(a => {
    const stat = byNumeric.get(String(a.numericId)) || byArchetype.get(a.archetype) || null;
    return Object.assign({}, a, { stats: stat });
  });

  res.json({ player: loadout.player, attachments: enriched });
});

// ===== Server-Sent Events (SSE) for live loadout updates =====
const sseClients = new Set();

function sendSseEvent(res, ev) {
  try {
    res.write('data: ' + JSON.stringify(ev).replace(/\n/g, '\\n') + "\n\n");
  } catch (e) {
    // ignore
  }
}

function broadcast(ev) {
  for (const res of sseClients) sendSseEvent(res, ev);
}

app.get('/api/loadout/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();

  // send initial comment to establish connection
  res.write(': connected\n\n');

  // send current loadout immediately
  const cur = safeReadJSON(LOADOUT_PATH);
  sendSseEvent(res, { type: 'init', loadout: cur });

  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
    try { res.end(); } catch (e) {}
  });
});

// watch loadout.json and broadcast updates
try {
  fs.watchFile(LOADOUT_PATH, { interval: 1000 }, (curr, prev) => {
    if (curr.mtime > prev.mtime) {
      const j = safeReadJSON(LOADOUT_PATH);
      broadcast({ type: 'update', loadout: j });
    }
  });
} catch (e) {
  // ignore if file not present yet
}

app.listen(PORT, '127.0.0.1', () => {
  console.log('[loadout-api] Listening on http://127.0.0.1:' + PORT);
});

module.exports = app;
