const fs = require('fs');
const path = require('path');

const LOG_LINE = '<2026-02-20T16:08:54.527Z> [Notice] <CEntityComponentShipListProvider::FetchShipData> Fetching ship list for local client [Team_GameServices][ASOP]';

console.log('Testing line:', LOG_LINE);

// 1. Check Hardcoded Parsers
const parserDir = '/home/damien/versecon-link/src/main/parsers';
const parserFiles = fs.readdirSync(parserDir).filter(f => f.endsWith('.js') && f !== 'index.js' && f !== 'base.js');

console.log('\n--- Hardcoded Parsers ---');
for (const file of parserFiles) {
    try {
        const parser = require(path.join(parserDir, file));
        if (parser.patterns) {
            for (const [key, regex] of Object.entries(parser.patterns)) {
                if (regex instanceof RegExp && regex.test(LOG_LINE)) {
                    console.log(`MATCH [${file}]: ${key} -> ${regex}`);
                }
            }
        }
        if (parser.pattern && parser.pattern instanceof RegExp && parser.pattern.test(LOG_LINE)) {
            console.log(`MATCH [${file}]: (main pattern) -> ${parser.pattern}`);
        }
        if (parser.inventoryPattern && parser.inventoryPattern instanceof RegExp && parser.inventoryPattern.test(LOG_LINE)) {
            console.log(`MATCH [${file}]: (inventoryPattern) -> ${parser.inventoryPattern}`);
        }
    } catch (e) { }
}

// 2. Check known-patterns.json
console.log('\n--- known-patterns.json ---');
const kpPath = '/home/damien/versecon-link/known-patterns.json';
if (fs.existsSync(kpPath)) {
    const kp = JSON.parse(fs.readFileSync(kpPath, 'utf8'));
    for (const p of kp.patterns) {
        try {
            const re = new RegExp(p.regex, 'i');
            if (re.test(LOG_LINE)) {
                console.log(`MATCH [known-patterns]: ${p.id} (${p.name}) -> ${p.regex}`);
            }
        } catch (e) { }
    }
}
