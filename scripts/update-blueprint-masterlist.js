/**
 * update-blueprint-masterlist.js
 *
 * Fetches the complete blueprint list from sc-craft.tools API
 * and saves it to data/blueprint-masterlist-full.json
 *
 * Run manually:  node scripts/update-blueprint-masterlist.js
 * Or via npm:    npm run update-blueprints
 *
 * Updates automatically when a new SC patch drops — just re-run.
 * Source: https://sc-craft.tools (by Norkaan & HTTPS org)
 */

const https   = require('https');
const fs      = require('fs');
const path    = require('path');

const API_BASE   = 'https://sc-craft.tools/api/blueprints';
const VERSION    = 'LIVE-4.8.0-11825000';  // update this when a new patch drops
const PAGE_SIZE  = 100;
const OUT_FILE   = path.join(__dirname, '..', 'data', 'blueprint-masterlist-full.json');

// ── helpers ───────────────────────────────────────────────────────────────────

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'User-Agent': 'VerseCon-Link/1.0' } }, res => {
            if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  () => {
                try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
                catch (e) { reject(e); }
            });
        }).on('error', reject);
    });
}

function simplifyCategory(cat) {
    if (!cat) return 'Unknown';
    if (/flightsuit/i.test(cat))                        return 'Armor/Apparel';
    if (/armour|armor/i.test(cat))                      return 'Armor';
    if (/quantum/i.test(cat))                           return 'Quantum Drive';
    if (/shield/i.test(cat))                            return 'Shield';
    if (/powerplant|power plant/i.test(cat))            return 'Powerplant';
    if (/cooler/i.test(cat))                            return 'Cooler';
    if (/thruster/i.test(cat))                          return 'Thruster';
    if (/cannon|ballistic|laser|shotgun|rifle|pistol|smg|lmg|sniper|weapons/i.test(cat)) return 'Weapon';
    if (/ammo|magazine|battery|rocket$/i.test(cat))     return 'Ammo';
    if (/vehiclegear/i.test(cat))                       return 'Ship Component';
    return cat.split('/')[0].trim();
}

function sourceSummary(missions) {
    if (!missions || !missions.length) return '';
    const contractors = new Set();
    missions.forEach(m => {
        const n = m.name || '';
        if (/foxwell/i.test(n))                              contractors.add('Foxwell Enforcement');
        else if (/headhunter|stomping|wanna be a/i.test(n))  contractors.add('Headhunters');
        else if (/covalex/i.test(n))                         contractors.add('Covalex');
        else if (/\bftl\b/i.test(n))                         contractors.add('FTL Courier');
        else if (/ling/i.test(n))                            contractors.add('Ling Family Hauling');
        else if (/highpoint|valakkar/i.test(n))              contractors.add('Highpoint Wilderness');
        else if (/rayari|rain\b|yormandi|\bolp\b/i.test(n))  contractors.add('Rayari / RAIN');
        else if (/shubin|purchase order|hand mine/i.test(n)) contractors.add('Shubin Interstellar');
        else if (/wikelo|thecollector/i.test(n))             contractors.add('Wikelo Emporium');
        else if (/intersec/i.test(n))                        contractors.add('InterSec Defense');
        else if (/citizens for prosperity|cfp/i.test(n))     contractors.add('Citizens for Prosperity');
        else if (/gilly|gauntlet/i.test(n))                  contractors.add("Gilly's Flight School");
        else if (/hurston/i.test(n))                         contractors.add('Hurston Dynamics');
        else if (/arccorp/i.test(n))                         contractors.add('ArcCorp');
        else if (/microtech/i.test(n))                       contractors.add('microTech');
        else if (/crusader/i.test(n))                        contractors.add('Crusader Industries');
        else if (/tactical strike|strike group/i.test(n))    contractors.add('Mercenary (Tactical Strike)');
        // Generic patterns — don't expose raw template strings
        else if (/kill order|primo target|simple hit|wanted|target takedown|crash some|ghost some|xenotrash/i.test(n))
                                                             contractors.add('Headhunters / Bounty Hunter');
        else if (/defend|guard|protect|secure|stop rival|keep.*safe/i.test(n))
                                                             contractors.add('Mercenary');
        else if (/delivery|courier|deliver/i.test(n))        contractors.add('Courier');
        else if (/haul|cargo/i.test(n))                      contractors.add('Hauling');
        else if (/salvage/i.test(n))                         contractors.add('Salvage');
        else if (/bounty/i.test(n))                          contractors.add('Bounty Hunter');
        // Strip template placeholders before showing raw name
        else {
            const clean = n.replace(/~mission\([^)]+\)/g, '…').slice(0, 50);
            contractors.add(clean);
        }
    });
    return [...contractors].join(' / ');
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main() {
    console.log(`Fetching blueprints from sc-craft.tools (version: ${VERSION})...`);

    // Fetch page 1 to find total pages
    const first = await fetchJson(`${API_BASE}?page=1&limit=${PAGE_SIZE}&version=${VERSION}`);
    const totalItems = first.items?.length ?? 0;

    // Fetch remaining pages (cap at 20 pages = 2,000 blueprints)
    const PAGES = 20;
    console.log(`Fetching ${PAGES} pages...`);
    const pagePromises = [];
    for (let p = 2; p <= PAGES; p++) {
        pagePromises.push(fetchJson(`${API_BASE}?page=${p}&limit=${PAGE_SIZE}&version=${VERSION}`));
    }
    const rest = await Promise.all(pagePromises);

    const allItems = [
        ...(first.items || []),
        ...rest.flatMap(r => r.items || []),
    ].filter(bp => bp.name); // remove blanks

    console.log(`Processing ${allItems.length} blueprints...`);

    const masterList = allItems.map(bp => ({
        name:     bp.name,
        category: simplifyCategory(bp.category),
        source:   sourceSummary(bp.missions),
        ingredients: bp.ingredients ? bp.ingredients.map(ing => ({
            name: ing.name,
            quantity: ing.quantity_scu
        })) : []
    }));

    // Sort alphabetically
    masterList.sort((a, b) => a.name.localeCompare(b.name));

    const output = {
        _generated:  new Date().toISOString(),
        _source:     'sc-craft.tools API',
        _version:    VERSION,
        _count:      masterList.length,
        masterList,
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2), 'utf8');
    console.log(`✅ Saved ${masterList.length} blueprints to ${OUT_FILE}`);
}

main().catch(err => {
    console.error('❌ Failed:', err.message);
    process.exit(1);
});
