const fs = require('fs');
const log = fs.readFileSync('C:\\Program Files\\Roberts Space Industries\\StarCitizen\\HOTFIX\\Game.log', 'utf8');
const lines = log.split('\n');

const results = [];
lines.forEach((line, index) => {
    const idx = index + 1;
    if (line.includes('Local Route Guard - Server Rerouted') || line.includes('FinalStop=')) {
        results.push(`[Line ${idx}] ${line.trim()}`);
    }
});

fs.writeFileSync('scratch/route_guard_lines.txt', results.join('\n'));
console.log(`Found ${results.length} lines matching Route Guard`);
