const BaseParser = require('./base');

class SocialParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            // "SubscribeToPlayerSocial: PlayerName" - often appears when a player streams in
            social_subscribe: /<SubscribeToPlayerSocial> Subscribing to player (\d+)/,
            social_unsubscribe: /<UnsubscribeFromPlayerSocial> Unsubscribing from player (\d+)/,
            // Generic Group (Rare in logs, but good to have)
            group_invite: /<Group>.*Invite/i,
            group_join: /<Group>.*Join/i,

            // Channel/VOIP Events (verified in Game.log)
            channel_created: /<Channel Created>/i,
            channel_destroyed: /<Channel Destroyed>/i,
            channel_connected: /<Channel Connection Complete>/i,
            channel_disconnected: /<Channel Disconnected>/i,
        };
        this.rsiHandle = '';
        this.localPlayerId = '';
    }

    setRsiHandle(handle) {
        this.rsiHandle = handle;
        console.log('[SocialParser] RSI handle updated:', this.rsiHandle);
    }

    setRsiId(id) {
        if (id) {
            this.localPlayerId = id.toString();
            console.log('[SocialParser] RSI ID manually configured:', this.localPlayerId);
        }
    }

    parse(line) {
        let handled = false;

        // Auto-discover local player ID from inventory token flow
        const localPlayerMatch = line.match(/Requesting access token for User\[([^,\]]+),\s*(\d+)\]/i);
        if (localPlayerMatch && this.rsiHandle) {
            if (localPlayerMatch[1].toLowerCase() === this.rsiHandle.toLowerCase()) {
                this.localPlayerId = localPlayerMatch[2];
                console.log(`[SocialParser] Auto-discovered local player ID: ${this.localPlayerId} for handle: ${this.rsiHandle}`);
            }
        }

        // 1. Social Proximity (Stream In)
        const subMatch = line.match(this.patterns.social_subscribe);
        if (subMatch) {
            const player = subMatch[1];
            if (player === this.localPlayerId) {
                return true; // Ignore local player
            }
            this.emit('gamestate', {
                type: 'SOCIAL_PROXIMITY',
                value: player,
                action: 'enter',
                message: `Player nearby: ${player}`
            });
            handled = true;
        }

        const unsubMatch = line.match(this.patterns.social_unsubscribe);
        if (unsubMatch) {
            const player = unsubMatch[1];
            if (player === this.localPlayerId) {
                return true; // Ignore local player
            }
            this.emit('gamestate', {
                type: 'SOCIAL_PROXIMITY',
                value: player,
                action: 'leave',
                message: `Player left proximity: ${player}`
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
