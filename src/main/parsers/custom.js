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
                this.emit('gamestate', {
                    type: 'CUSTOM',
                    level: p.level || 'INFO',
                    message: p.message ? p.message.replace('$1', match[1] || '').replace('$2', match[2] || '') : 'Custom Match',
                    value: match[1] || line,
                    hueColor: p.hueColor
                });
                handled = true;
            }
        }
        return handled;
    }
}

module.exports = new CustomParser();
