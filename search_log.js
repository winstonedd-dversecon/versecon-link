const fs = require('fs');
const log = fs.readFileSync('C:\\Program Files\\Roberts Space Industries\\StarCitizen\\HOTFIX\\Game.log', 'utf8');
const lines = log.split('\n');

const results = [];
lines.forEach((line, index) => {
    const idx = index + 1;
    const lower = line.toLowerCase();
    
    // Filter out cargo elevator spam
    if (lower.includes('cargo') || lower.includes('elevator') || lower.includes('platform')) {
        return;
    }
    
    if (lower.includes('checkmate') || lower.includes('pyro') || lower.includes('crusader') || lower.includes('location') || lower.includes('zone')) {
        results.push(`[Line ${idx}] ${line.trim()}`);
    }
});

fs.writeFileSync('search_results.txt', results.join('\n'));
console.log("SUCCESSfully wrote search_results.txt");
