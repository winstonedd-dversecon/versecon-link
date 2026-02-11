const LogWatcher = require('../src/main/log-watcher');

console.log('=== Log Watcher Verification ===');

// Mock Event Listener
LogWatcher.on('gamestate', (event) => {
    console.log(`[EVENT] ${event.type}:`, event.value, event.details || event.subtype || '');
});

// Test Cases
const testLines = [
    // 1. Navigation
    "<2026-02-11T12:00:00.000Z> Location[OOC_Stanton_2b_Daymar]",
    "<2026-02-11T12:00:01.000Z> <Jump Drive Requesting State Change> from Idle to Traveling",
    // 2. Navigation Hint
    "<2026-02-11T12:00:02.000Z> <StatObjLoad 0x123 Format> '.../objectcontainers/pu/loc/stanton/landingzones/area18/'",

    // 3. Vehicle
    "<2026-02-11T12:05:00.000Z> <Vehicle Control Flow> Requesting seat for 'RSI_Constellation_Andromeda_123' [12345] granted",
    "<2026-02-11T12:05:10.000Z> <Vehicle Control Flow> Seat exit releasing vehicle",

    // 4. Combat
    "<2026-02-11T12:10:00.000Z> <Actor Death> CActor::Kill: 'PlayerOne' killed by 'Pirate' using 'k_ball_gatl_s3'",
    "<2026-02-11T12:10:05.000Z> Player 'PlayerOne' started suffocating",

    // 5. Economy (New)
    "<2026-02-11T12:15:00.000Z> <ShopPurchase> Item 'Water' Cost 5 aUEC",
    "<2026-02-11T12:15:10.000Z> <Fine> Amount 500"
];

console.log(`Feeding ${testLines.length} lines...`);
testLines.forEach(line => LogWatcher.processLine(line));

console.log('=== Verification Complete ===');
