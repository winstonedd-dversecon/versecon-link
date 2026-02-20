const BaseParser = require('./base');

class CustomParser extends BaseParser {
    constructor() {
        super();
        this.patterns = [];
    }

    setPatterns(patterns) {
        this.patterns = (patterns || []).map(p => {
            try {
                let regexBody = p.regex;
                let flags = '';
                if (regexBody.startsWith('/') && regexBody.lastIndexOf('/') > 0) {
                    const lastSlash = regexBody.lastIndexOf('/');
                    flags = regexBody.substring(lastSlash + 1);
                    regexBody = regexBody.substring(1, lastSlash);
                }
                return { ...p, compiled: new RegExp(regexBody, flags) };
            } catch (e) {
                console.error('[CustomParser] Invalid regex:', p.regex, e);
                return null;
            }
        }).filter(Boolean);
    }

    parse(line) {
        let handled = false;
        for (const p of this.patterns) {
            const match = line.match(p.compiled);
            if (match) {
                // Determine message: message > name > "Custom Match"
                let message = p.message;
                if (!message && p.name) message = p.name;
                if (!message) message = 'Custom Match';

                // Skip if message is explicitly "none" or "NONE" OR if event is explicitly "NONE"
                if (message.toUpperCase() === 'NONE' || (p.event && p.event.toUpperCase() === 'NONE')) {
                    handled = true;
                    continue;
                }

                // Substitution
                message = message.replace('$1', match[1] || '').replace('$2', match[2] || '');

                this.emit('gamestate', {
                    type: 'CUSTOM',
                    id: p.id,
                    level: p.level || 'INFO',
                    message: message,
                    value: match[1] || line,
                    hueColor: p.hueColor,
                    source: p.source || 'user'
                });
                handled = true;
            }
        }
        return handled;
    }
}

module.exports = new CustomParser();
