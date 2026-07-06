const fs = require('fs');
const path = require('path');

let rtRun = [];

function saveRunState() {
    console.log('[STATE] saved:', JSON.stringify(rtRun, null, 2));
}

function handleGatherObjective(objText) {
    if (!objText) return;
    const match = objText.match(/(?:Deliver|Collect|Gather|Bring|Retrieve|Pick\s+up|Take|Find|Search)\s+(?:(\d+)\/(\d+)\s+)?(.+?)(?:\s+(?:to|at|from|into)\s+(.+))?$/i);
    if (!match) return;

    const current = match[1] ? parseInt(match[1]) : 0;
    const needed = match[2] ? parseInt(match[2]) : 1;
    let itemName = match[3].replace(/:+$/, '').trim();
    itemName = itemName.replace(/^(?:the|a|an)\s+/i, '');
    const destination = match[4] ? match[4].replace(/:+$/, '').trim() : '';

    let existing = rtRun.find(r => r.name.toLowerCase() === itemName.toLowerCase());
    if (existing) {
        let changed = false;
        if (existing.needed !== needed) {
            existing.needed = needed;
            changed = true;
        }
        if (existing.collected !== current) {
            existing.collected = current;
            changed = true;
        }
        if (changed) {
            saveRunState();
        }
    } else {
        const archGuess = itemName
            .toLowerCase()
            .replace(/['"()]/g, '')
            .replace(/\s+/g, '_')
            .replace(/-/g, '_')
            .substring(0, 30);

        rtRun.push({
            name: itemName,
            source: destination ? `Mission (to ${destination})` : 'Mission Gather Item',
            category: 'Wikelo',
            archKeyword: archGuess,
            needed: needed,
            collected: current
        });
        saveRunState();
    }
}

console.log('--- Testing quantity-less and cleaned determiners ---');
handleGatherObjective("Take the food to Wikelo");
handleGatherObjective("Find a Ranta Dung");
