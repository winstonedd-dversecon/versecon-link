#!/usr/bin/env node
/**
 * blueprint-scan.js
 * -----------------
 * Scans one or more Star Citizen Game.log files for received blueprints
 * and merges results into data/blueprints.json.
 *
 * Usage:
 *   node scripts/blueprint-scan.js                          # auto-detect live Game.log
 *   node scripts/blueprint-scan.js "C:\path\to\Game.log"   # single file
 *   node scripts/blueprint-scan.js logs\*.log               # glob (use quotes on Windows)
 *   node scripts/blueprint-scan.js log1.log log2.log        # multiple files
 *
 * Options:
 *   --dry-run   Print results without writing to blueprints.json
 *   --watch     After scanning, watch the live Game.log for new blueprints in real-time
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');

// ── Config ────────────────────────────────────────────────────────────────────

const DATA_FILE = path.join(__dirname, '..', 'data', 'blueprints.json');
const BLUEPRINT_RE = /Added notification "Received Blueprint:\s*([^:"]+):\s*"/i;
const TIMESTAMP_RE = /^<(\d{4}-\d{2}-\d{2}T[\d:.]+Z)>/;

const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const shouldWatch = args.includes('--watch');
const filePaths = args.filter(a => !a.startsWith('--'));

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadData() {
    try {
        if (fs.existsSync(DATA_FILE)) {
            return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
        }
    } catch (e) { /* ignore */ }
    return { collected: [], masterList: [] };
}

function saveData(data) {
    if (isDryRun) return;
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, DATA_FILE);
}

function findLiveLog() {
    const candidates = [];
    ['C:', 'D:', 'E:', 'F:'].forEach(drive => {
        candidates.push(path.join(drive, 'Program Files/Roberts Space Industries/StarCitizen/LIVE/Game.log'));
        candidates.push(path.join(drive, 'Program Files/Roberts Space Industries/StarCitizen/PTU/Game.log'));
    });
    const home = process.env.HOME || process.env.USERPROFILE || '';
    if (home) {
        candidates.push(path.join(home, 'Games/StarCitizen/LIVE/Game.log'));
    }
    candidates.push(path.join(__dirname, '..', 'Game.log'));
    return candidates.find(p => fs.existsSync(p)) || null;
}

function parseLine(line) {
    const m = line.match(BLUEPRINT_RE);
    if (!m) return null;
    const ts = line.match(TIMESTAMP_RE);
    return {
        name: m[1].trim(),
        timestamp: ts ? ts[1] : null,
    };
}

// ── Scan a file ───────────────────────────────────────────────────────────────

async function scanFile(filePath) {
    const found = []; // { name, timestamp, file }
    return new Promise((resolve, reject) => {
        const stream = fs.createReadStream(filePath, { encoding: 'utf8' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
        rl.on('line', line => {
            const result = parseLine(line);
            if (result) found.push({ ...result, file: path.basename(filePath) });
        });
        rl.on('close', () => resolve(found));
        rl.on('error', reject);
        stream.on('error', reject);
    });
}

// ── Report ────────────────────────────────────────────────────────────────────

function printReport(data) {
    const collected = new Set(data.collected);
    const masterNames = new Set(data.masterList.map(b => b.name));

    console.log('\n═══════════════════════════════════════');
    console.log('  Star Citizen Blueprint Tracker');
    console.log('═══════════════════════════════════════');
    console.log(`\n  Collected: ${collected.size} / ${masterNames.size || '?'} known\n`);

    if (masterNames.size > 0) {
        const have = [...masterNames].filter(n => collected.has(n)).sort();
        const missing = [...masterNames].filter(n => !collected.has(n)).sort();

        console.log('  ✅ Have:');
        have.forEach(n => console.log(`     • ${n}`));

        if (missing.length > 0) {
            console.log('\n  ❌ Missing:');
            missing.forEach(n => console.log(`     • ${n}`));
        } else {
            console.log('\n  🎉 You have all known blueprints!');
        }

        // Any collected blueprints not yet in masterList
        const unknown = [...collected].filter(n => !masterNames.has(n)).sort();
        if (unknown.length > 0) {
            console.log('\n  ⚠️  Collected but not in masterList (add them!):');
            unknown.forEach(n => console.log(`     • ${n}`));
        }
    } else {
        console.log('  Collected:');
        [...collected].sort().forEach(n => console.log(`     • ${n}`));
        console.log('\n  (Add blueprints to masterList in blueprints.json to track what\'s missing)');
    }

    console.log('\n═══════════════════════════════════════\n');
}

// ── Live watcher ──────────────────────────────────────────────────────────────

function watchLog(filePath) {
    console.log(`\n👁  Watching: ${filePath}`);
    console.log('   (waiting for new blueprints...)\n');

    let lastSize = fs.statSync(filePath).size;

    fs.watchFile(filePath, { interval: 500 }, (curr) => {
        if (curr.size <= lastSize) { lastSize = curr.size; return; }

        const stream = fs.createReadStream(filePath, {
            start: lastSize,
            end: curr.size - 1,
            encoding: 'utf8',
        });

        let buf = '';
        stream.on('data', chunk => { buf += chunk; });
        stream.on('end', () => {
            lastSize = curr.size;
            buf.split('\n').forEach(line => {
                const result = parseLine(line);
                if (!result) return;

                const data = loadData();
                const collected = new Set(data.collected);
                const isNew = !collected.has(result.name);

                collected.add(result.name);
                data.collected = [...collected].sort();
                saveData(data);

                const tag = isNew ? '🆕 NEW' : '🔁 DUP';
                console.log(`  ${tag} Blueprint received: ${result.name}  (${result.timestamp || 'now'})`);
                if (!isDryRun) console.log(`       Saved to blueprints.json`);

                printReport(data);
            });
        });
    });
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
    let targetFiles = filePaths.length > 0 ? filePaths : [];

    if (targetFiles.length === 0) {
        const live = findLiveLog();
        if (live) {
            targetFiles = [live];
            console.log(`Auto-detected: ${live}`);
        } else {
            console.error('No log file found. Pass a path or set GAME_LOG_PATH.');
            process.exit(1);
        }
    }

    // Validate all files exist
    const missing = targetFiles.filter(f => !fs.existsSync(f));
    if (missing.length > 0) {
        console.error('File(s) not found:\n' + missing.map(f => '  ' + f).join('\n'));
        process.exit(1);
    }

    console.log(`\nScanning ${targetFiles.length} file(s)...`);

    // Scan all files
    const allFound = [];
    for (const f of targetFiles) {
        process.stdout.write(`  ${path.basename(f)} ... `);
        const results = await scanFile(f);
        process.stdout.write(`${results.length} blueprint event(s)\n`);
        allFound.push(...results);
    }

    // Merge into data file
    const data = loadData();
    const collected = new Set(data.collected);
    let newCount = 0;

    allFound.forEach(({ name }) => {
        if (!collected.has(name)) {
            collected.add(name);
            newCount++;
        }
    });

    data.collected = [...collected].sort();

    if (!isDryRun) {
        saveData(data);
    }

    console.log(`\nNew blueprints found this scan: ${newCount}`);
    if (isDryRun) console.log('(dry-run: blueprints.json not updated)');

    printReport(data);

    if (shouldWatch) {
        const liveLog = findLiveLog() || targetFiles[targetFiles.length - 1];
        watchLog(liveLog);
        // Keep process alive
    }
})();
