const BaseParser = require('./base');
const fs = require('fs');
const path = require('path');

// Resolve data file path lazily so app.getPath('userData') is ready when called
function getDataFile() {
    try {
        return path.join(require('electron').app.getPath('userData'), 'blueprints.json');
    } catch (e) {
        // Fallback for CLI / test context (non-packaged)
        return path.join(__dirname, '..', '..', '..', 'data', 'blueprints.json');
    }
}

class BlueprintParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            blueprint_received: /Added notification "Received Blueprint:\s*([^:"]+):\s*"/i,
        };
        this.collected = new Set();
        this._loadCollected();
    }

    _loadCollected() {
        try {
            const file = getDataFile();
            if (fs.existsSync(file)) {
                const data = JSON.parse(fs.readFileSync(file, 'utf8'));
                (data.collected || []).forEach(name => this.collected.add(name));
            }
        } catch (e) {}
    }

    _saveCollected(name, timestamp) {
        try {
            const file = getDataFile();
            let data = {};
            if (fs.existsSync(file)) {
                data = JSON.parse(fs.readFileSync(file, 'utf8'));
            }
            // Merge disk state with in-memory — never lose scanner results
            const merged = new Set([...(data.collected || []), ...this.collected]);
            this.collected = merged;
            data.collected = Array.from(merged).sort();

            if (!data.collectedAt) data.collectedAt = {};
            if (name && timestamp) {
                data.collectedAt[name] = timestamp;
            }
            for (const item of data.collected) {
                if (!data.collectedAt[item]) {
                    data.collectedAt[item] = new Date().toISOString();
                }
            }

            fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
        } catch (e) {
            console.error('[BlueprintParser] Failed to save:', e.message);
        }
    }

    parse(line) {
        const match = line.match(this.patterns.blueprint_received);
        if (!match) return false;
        const name = match[1].trim();
        const isNew = !this.collected.has(name);
        const tsMatch = line.match(/^<(\d{4}-\d{2}-\d{2}T[\d:.]+Z)>/);
        const timestamp = tsMatch ? tsMatch[1] : new Date().toISOString();
        this.collected.add(name);
        this._saveCollected(name, timestamp);
        this.emit('gamestate', {
            type: 'BLUEPRINT_RECEIVED',
            value: name,
            isNew,
            timestamp,
            totalCollected: this.collected.size,
        });
        return true;
    }

    getCollected() {
        return Array.from(this.collected).sort();
    }
}

module.exports = new BlueprintParser();
