const BaseParser = require('./base');

class SocialParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // "SubscribeToPlayerSocial: PlayerName" - often appears when a player streams in
            social_subscribe: /SubscribeToPlayerSocial:\s*([^\s]+)/,
            // Generic Group (Rare in logs, but good to have)
            group_invite: /<Group>.*Invite/i,
            group_join: /<Group>.*Join/i
        };
    }

    parse(line) {
        let handled = false;

        // 1. Social Proximity (Stream In)
        const subMatch = line.match(this.patterns.social_subscribe);
        if (subMatch) {
            const player = subMatch[1];
            this.emit('gamestate', {
                type: 'SOCIAL_PROXIMITY',
                value: player,
                message: `Player nearby: ${player}`
            });
            handled = true;
        }

        // 2. Group Events (Placeholder for now)
        if (this.patterns.group_invite.test(line)) {
            this.emit('gamestate', { type: 'SOCIAL_INVITE', value: 'Group Invite' });
            handled = true;
        }

        return handled;
    }
}

module.exports = new SocialParser();
