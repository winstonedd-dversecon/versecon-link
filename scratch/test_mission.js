const parser = require('../src/main/parsers/mission');

parser.on('gamestate', (data) => {
    console.log(`[EMIT] type: ${data.type}, value: ${JSON.stringify(data.value)}, id: ${data.id}`);
});

console.log('--- Testing Contract Accepted ---');
const line1 = '<2026-06-25T10:49:30.161Z>    "Contract Accepted:  Interested in Building a Better Future?: " [5]';
console.log('Line:', line1);
parser.parse(line1);

console.log('\n--- Testing New Objective ---');
const line2 = '<2026-06-25T10:49:30.161Z>    "New Objective: Deliver 0/5 Ranta Dung to Rayari Deltana Research Outpost: " [6]';
console.log('Line:', line2);
parser.parse(line2);
