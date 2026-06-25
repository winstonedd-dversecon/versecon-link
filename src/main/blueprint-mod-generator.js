/**
 * blueprint-mod-generator.js
 *
 * SAFE patch of global.ini:
 *  - Scans ALL key=value lines but only modifies a line if its value contains
 *    at least one blueprint bullet that matches a collected name.
 *  - A "blueprint bullet" is the literal two-char sequence \n followed by "- "
 *    then the blueprint name — this is the exact format MrKraken uses in every
 *    contract description, so false positives are essentially impossible.
 *  - Preserves BOM and encoding exactly.
 *  - Never adds headers or comments to the file.
 *  - Backs up original to global.ini.versecon-bak on first run; subsequent runs
 *    always patch from the clean backup so re-running is safe.
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');

const STARSTRINGS_URL =
    'https://raw.githubusercontent.com/MrKraken/StarStrings/master/contracts.ini';

// ── helpers ───────────────────────────────────────────────────────────────────

function fetchUrl(url, maxRedirects = 5) {
    return new Promise((resolve, reject) => {
        const lib = url.startsWith('https') ? https : http;
        lib.get(url, res => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                if (maxRedirects <= 0) return reject(new Error('Too many redirects'));
                return fetchUrl(res.headers.location, maxRedirects - 1).then(resolve).catch(reject);
            }
            if (res.statusCode !== 200)
                return reject(new Error(`HTTP ${res.statusCode}`));
            const chunks = [];
            res.on('data', c => chunks.push(c));
            res.on('end',  () => resolve(Buffer.concat(chunks).toString('utf8')));
            res.on('error', reject);
        }).on('error', reject);
    });
}

/**
 * Build a lookup Set from collected names.
 * Adds both the full name and a version without a trailing (Category) suffix
 * so "VK-00" matches both "VK-00" and "VK-00 (Quantum Drive)" bullets.
 */
function buildCollectedSet(names) {
    const s = new Set();
    for (const n of names) {
        const t = n.trim();
        s.add(t.toLowerCase());
        s.add(t.replace(/\s*\([^)]+\)\s*$/, '').trim().toLowerCase());
    }
    return s;
}

/**
 * Process a single ini value string (everything after the = on one line).
 * Splits on the literal two-character sequence \n (backslash + n) used by SC ini files.
 * Only segments that are blueprint bullets AND match a collected name are changed.
 * Returns the modified value and how many bullets were marked.
 */
function processValue(value, collectedSet) {
    let marked = 0;
    const result = value.split('\\n').map(seg => {
        // Blueprint bullet pattern:  optional whitespace, dash, space, then name
        const m = seg.match(/^(\s*-\s+)(.*?)(\s*)$/);
        if (!m) return seg;

        const prefix   = m[1];
        const rest     = m[2].trim();
        const trailing = m[3];

        // Strip any marker from a previous run before re-checking
        const clean = rest
            .replace(/^\[✓ COLLECTED\] /, '')
            .replace(/ \*\* \[COLLECTED\] \*\*$/, '')
            .replace(/ <EM4>\[COLLECTED\]<\/EM4>$/, '')
            .trim();
        const nameOnly = clean.replace(/\s*\([^)]+\)\s*$/, '').trim();

        if (collectedSet.has(clean.toLowerCase()) || collectedSet.has(nameOnly.toLowerCase())) {
            marked++;
            return `${prefix}${clean} <EM4>[COLLECTED]</EM4>${trailing}`;
        }
        return `${prefix}${clean}${trailing}`;
    });
    return { value: result.join('\\n'), marked };
}

/**
 * Read a file as a raw Buffer, detect encoding, return { text, bom, encoding }.
 */
function readIni(filePath) {
    const buf = fs.readFileSync(filePath);
    if (buf[0] === 0xFF && buf[1] === 0xFE)
        return { text: buf.slice(2).toString('utf16le'), bom: buf.slice(0, 2), encoding: 'utf16le' };
    if (buf[0] === 0xFE && buf[1] === 0xFF) {
        const le = Buffer.from(buf.slice(2)); le.swap16();
        return { text: le.toString('utf16le'), bom: buf.slice(0, 2), encoding: 'utf16be' };
    }
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF)
        return { text: buf.slice(3).toString('utf8'), bom: buf.slice(0, 3), encoding: 'utf8' };
    return { text: buf.toString('utf8'), bom: null, encoding: 'utf8' };
}

function writeIni(filePath, text, bom, encoding) {
    let body;
    if (encoding === 'utf16le') {
        body = Buffer.from(text, 'utf16le');
    } else if (encoding === 'utf16be') {
        const le = Buffer.from(text, 'utf16le'); le.swap16(); body = le;
    } else {
        body = Buffer.from(text, 'utf8');
    }
    fs.writeFileSync(filePath, bom ? Buffer.concat([bom, body]) : body);
}

/**
 * Apply highlighting to the full ini text.
 * A line is only modified if processing its value actually marks ≥1 bullet.
 */
function applyHighlighting(iniText, collectedSet) {
    let totalMarked = 0;
    const lines = iniText.split(/\r?\n/).map(line => {
        const eq = line.indexOf('=');
        if (eq === -1) return line;

        const key   = line.slice(0, eq);
        const value = line.slice(eq + 1);

        // Quick pre-check: does this value even contain a bullet segment?
        if (!value.includes('\\n- ') && !value.startsWith('- ')) return line;

        const { value: newValue, marked } = processValue(value, collectedSet);
        if (marked === 0) return line;   // nothing matched — don't touch the line
        totalMarked += marked;
        return `${key}=${newValue}`;
    });
    return { text: lines.join('\n'), totalMarked };
}

// ── main export ───────────────────────────────────────────────────────────────

async function generateMod(collectedNames, liveFolder, cacheFile) {
    const collected     = buildCollectedSet(collectedNames);
    const globalIniDir  = path.join(liveFolder, 'data', 'Localization', 'english');
    const globalIniPath = path.join(globalIniDir, 'global.ini');
    const bakPath       = globalIniPath + '.versecon-bak';

    // ── Path A: patch existing global.ini ────────────────────────────────────
    if (fs.existsSync(globalIniPath)) {
        const { bom, encoding } = readIni(globalIniPath);

        // Always patch from the clean backup so re-runs are idempotent
        let sourceText;
        if (fs.existsSync(bakPath)) {
            sourceText = readIni(bakPath).text;
        } else {
            // First run — back up now, then use original as source
            fs.copyFileSync(globalIniPath, bakPath);
            sourceText = readIni(bakPath).text;
        }

        const { text: patched, totalMarked } = applyHighlighting(sourceText, collected);
        writeIni(globalIniPath, patched, bom, encoding);

        return { outFile: globalIniPath, source: 'patched', markedCount: totalMarked };
    }

    // ── Path B: no global.ini — fall back to GitHub contracts.ini only ───────
    let raw;
    try {
        raw = await fetchUrl(STARSTRINGS_URL);
        try { fs.writeFileSync(cacheFile, raw, 'utf8'); } catch (_) {}
    } catch (err) {
        if (fs.existsSync(cacheFile)) {
            raw = fs.readFileSync(cacheFile, 'utf8');
        } else {
            throw new Error(
                'global.ini not found in your LIVE folder.\n' +
                'Please install MrKraken\'s StarStrings mod first:\n' +
                'https://github.com/MrKraken/StarStrings/releases'
            );
        }
    }
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);

    const { text: generated, totalMarked } = applyHighlighting(raw, collected);
    fs.mkdirSync(globalIniDir, { recursive: true });
    fs.writeFileSync(globalIniPath, generated, 'utf8');

    return { outFile: globalIniPath, source: 'generated', markedCount: totalMarked };
}

module.exports = { generateMod };
