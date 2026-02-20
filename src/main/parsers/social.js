const BaseParser = require('./base');

class SocialParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // "SubscribeToPlayerSocial: PlayerName" - often appears when a player streams in
            social_subscribe: /SubscribeToPlayerSocial:\s*([^\s]+)/,
            // Generic Group (Rare in logs, but good to have)
            group_invite: /<Group>.*Invite/i,
            group_join: /<Group>.*Join/i,

            // Channel/VOIP Events (verified in Game.log)
            channel_created: /<Channel Created>/i,
            channel_destroyed: /<Channel Destroyed>/i,
            channel_connected: /<Channel Connection Complete>/i,
            channel_disconnected: /<Channel Disconnected>/i,
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

        // 2. Group Events
        if (this.patterns.group_invite.test(line)) {
            this.emit('gamestate', { type: 'SOCIAL_INVITE', value: 'Group Invite' });
            handled = true;
        }

        // 3. Channel/VOIP Events
        if (this.patterns.channel_created.test(line)) {
            this.emit('gamestate', {
                type: 'VOIP',
                value: 'Voice Channel Created',
                level: 'INFO'
            });
            handled = true;
        }

        if (this.patterns.channel_destroyed.test(line)) {
            this.emit('gamestate', {
                type: 'VOIP',
                value: 'Voice Channel Destroyed',
                level: 'INFO'
            });
            handled = true;
        }

        if (this.patterns.channel_connected.test(line)) {
            this.emit('gamestate', {
                type: 'VOIP',
                value: 'Voice Channel Connected',
                level: 'INFO'
            });
            handled = true;
        }

        if (this.patterns.channel_disconnected.test(line)) {
            this.emit('gamestate', {
                type: 'VOIP',
                value: 'Voice Channel Disconnected',
                level: 'INFO'
            });
            handled = true;
        }

        return handled;
    }
}

module.exports = new SocialParser();
