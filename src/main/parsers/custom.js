const BaseParser = require('./base');

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

class CustomParser extends BaseParser {
    constructor() {
        super();
        this.patterns = [];
        this.activeStates = {}; // key: patternId, value: resolvedLabel
        this.timeouts = {}; // key: patternId, value: setTimeout ID
        this.rsiHandle = '';
        this.rawPatterns = [];
    }

    setRsiHandle(handle) {
        this.rsiHandle = handle || '';
        if (this.rawPatterns.length > 0) {
            this.setPatterns(this.rawPatterns);
        }
    }

    setPatterns(patterns) {
        this.rawPatterns = patterns || [];
        const handleVal = this.rsiHandle || 'TypicallyBrit_ish';
        const escapedHandle = escapeRegExp(handleVal);

        this.patterns = this.rawPatterns.map(p => {
            try {
                let regexBody = p.regex || '';
                regexBody = regexBody.replace(/{player}/g, escapedHandle);

                let flags = '';
                if (regexBody.startsWith('/') && regexBody.lastIndexOf('/') > 0) {
                    const lastSlash = regexBody.lastIndexOf('/');
                    flags = regexBody.substring(lastSlash + 1);
                    regexBody = regexBody.substring(1, lastSlash);
                }
                const compiled = new RegExp(regexBody, flags);

                let stopCompiled = null;
                if (p.isStateful && p.stopRegex) {
                    let stopBody = p.stopRegex;
                    stopBody = stopBody.replace(/{player}/g, escapedHandle);

                    let stopFlags = '';
                    if (stopBody.startsWith('/') && stopBody.lastIndexOf('/') > 0) {
                        const lastSlash = stopBody.lastIndexOf('/');
                        stopFlags = stopBody.substring(lastSlash + 1);
                        stopBody = stopBody.substring(1, lastSlash);
                    }
                    stopCompiled = new RegExp(stopBody, stopFlags);
                }

                return { ...p, compiled, stopCompiled };
            } catch (e) {
                console.error('[CustomParser] Invalid regex:', p.regex, e);
                return null;
            }
        }).filter(Boolean);
    }

    parse(line) {
        let handled = false;

        // Clean slate checks: clear active HUD states on death, main menu, or quit
        if (line.includes('CSystem::Quit') || line.includes('CGameClient::OnDisconnect') || line.includes('Disconnecting from server') || line.includes('Exiting to Main Menu') || line.includes('<Actor Death>')) {
            this.clearActiveStates();
        }

        // 1. Check stop patterns for currently active stateful alerts
        for (const p of this.patterns) {
            if (p.isStateful && p.stopCompiled && this.activeStates[p.id]) {
                const stopMatch = line.match(p.stopCompiled);
                if (stopMatch) {
                    delete this.activeStates[p.id];
                    this.emit('gamestate', {
                        type: 'SUB_HUD_STATE',
                        id: p.id,
                        active: false,
                        label: p.subHudLabel || p.name || 'Active State'
                    });
                    handled = true;
                }
            }
        }

        // 2. Check start patterns (normal custom patterns and stateful activations)
        for (const p of this.patterns) {
            // Guard: Bypass weapon alerts on ammo/magazine log lines
            if (line.includes('AttachmentReceived')) {
                const lowerLine = line.toLowerCase();
                const isAmmoLine = lowerLine.includes('port[magazine_') || 
                                   lowerLine.includes('port[ammo_') ||
                                   lowerLine.includes('_mag');
                if (isAmmoLine) {
                    const regexStr = p.regex ? p.regex.toLowerCase() : '';
                    const mentionsAmmo = regexStr.includes('mag') || regexStr.includes('ammo') || regexStr.includes('bullet') || regexStr.includes('magazine');
                    if (!mentionsAmmo) {
                        continue; // Skip weapon match for ammo logs
                    }
                }
            }

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

                // Handle Stateful/Simple Sub-HUD Activation
                if (p.isStateful) {
                    let resolvedLabel = p.subHudLabel || p.name || 'Active State';
                    resolvedLabel = resolvedLabel.replace('$1', match[1] || '').replace('$2', match[2] || '');
                    this.activeStates[p.id] = resolvedLabel;
                    this.emit('gamestate', {
                        type: 'SUB_HUD_STATE',
                        id: p.id,
                        active: true,
                        label: resolvedLabel
                    });
                } else if (p.subHudLabel) {
                    let resolvedLabel = p.subHudLabel;
                    resolvedLabel = resolvedLabel.replace('$1', match[1] || '').replace('$2', match[2] || '');
                    
                    // Trigger alert ON
                    this.emit('gamestate', {
                        type: 'SUB_HUD_STATE',
                        id: p.id,
                        active: true,
                        label: resolvedLabel
                    });

                    // If duration is defined (>0), set timer to clear it
                    if (this.timeouts[p.id]) {
                        clearTimeout(this.timeouts[p.id]);
                        delete this.timeouts[p.id];
                    }

                    if (p.subHudDuration && p.subHudDuration > 0) {
                        this.timeouts[p.id] = setTimeout(() => {
                            delete this.timeouts[p.id];
                            this.emit('gamestate', {
                                type: 'SUB_HUD_STATE',
                                id: p.id,
                                active: false,
                                label: resolvedLabel
                            });
                        }, p.subHudDuration * 1000);
                    }
                }

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

    clearActiveStates() {
        for (const id of Object.keys(this.activeStates)) {
            const p = this.patterns.find(x => x.id === id);
            this.emit('gamestate', {
                type: 'SUB_HUD_STATE',
                id: id,
                active: false,
                label: p ? (p.subHudLabel || p.name) : 'Active State'
            });
        }
        this.activeStates = {};

        for (const id of Object.keys(this.timeouts)) {
            clearTimeout(this.timeouts[id]);
            const p = this.patterns.find(x => x.id === id);
            this.emit('gamestate', {
                type: 'SUB_HUD_STATE',
                id: id,
                active: false,
                label: p ? (p.subHudLabel || p.name) : 'Active State'
            });
        }
        this.timeouts = {};
    }
}

module.exports = new CustomParser();
