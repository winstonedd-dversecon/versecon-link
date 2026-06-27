const BaseParser = require('./base');

/**
 * InventoryParser
 *
 * Parses AttachmentReceived lines and emits a structured gamestate event
 * with type 'ATTACHMENT_RECEIVED'.
 */
class InventoryParser extends BaseParser {
    constructor() {
        super();
        this.pattern = /<([^>]+)>\s+\[[^\]]+\]\s+<AttachmentReceived>\s+Player\[([^\]]+)\]\s+Attachment\[([^,\]]+),\s*([^,\]]+),\s*([^\]]+)\](?:[^\n]*?Port\[([^\]]+)\])?/i;

        // Inventory Management tracking (verified in Game.log)
        this.inventoryPattern = /<InventoryManagement>\s+Request\[(\d+)\]\s+for\s+'([^']+)'\s+\[\d+\]\s+Result\[(\w+)\]/i;
        this.locationInventoryPattern = /<RequestLocationInventory>\s+Player\[([^\]]+)\]\s+requested\s+inventory\s+for\s+Location\[([^\]]+)\]/i;
        this.recoveryPattern = /<Adding non kept item.*?>\s+Item\s+'[^']+'\s+-\s+Class\(([^)]+)\)/i;
        this.itemMovePattern = /<InventoryManagement>\s+New\s+request\[\d+\]\s+Player\[([^\]]+)\]\s+Type\[Move\]\s+SourceInventory\[([^\]]+)\]\s+TargetInventory\[([^\]]+)\]\s+ItemClass\[([^\]]+)\]/i;
        this.rsiHandle = '';
        this.playerAttachmentTimes = new Map();
        this.lastAlertTimes = new Map();
    }

    setRsiHandle(handle) {
        this.rsiHandle = handle;
    }

    parse(line) {
        // 1. Check AttachmentReceived
        const m = line.match(this.pattern);
        if (m) {
            const timestamp = m[1];
            const player = m[2];
            const attachmentId = m[3];
            const archetype = m[4];
            const numericId = m[5];
            const port = m[6];

            this.emit('gamestate', {
                type: 'ATTACHMENT_RECEIVED',
                value: {
                    timestamp,
                    player,
                    attachmentId,
                    archetype,
                    numericId,
                    port,
                    raw: line
                }
            });

            // Check for burst of attachments (likely death/respawn or streaming in)
            const normalizeName = (name) => (name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (normalizeName(player) !== normalizeName(this.rsiHandle)) {
                const now = Date.now();
                if (!this.playerAttachmentTimes.has(player)) {
                    this.playerAttachmentTimes.set(player, []);
                }
                const times = this.playerAttachmentTimes.get(player);
                times.push(now);
                
                // Keep only times in the last 6 seconds
                const windowStart = now - 6000;
                const activeTimes = times.filter(t => t > windowStart);
                this.playerAttachmentTimes.set(player, activeTimes);
                
                // If they receive 6+ attachments in 6 seconds, trigger alert (throttled to once per 30 seconds per player)
                if (activeTimes.length >= 6) {
                    const lastAlert = this.lastAlertTimes.get(player) || 0;
                    if (now - lastAlert > 30000) { // 30s cooldown per player
                        this.lastAlertTimes.set(player, now);
                        this.emit('gamestate', {
                            type: 'PROXIMITY_DEATH',
                            value: player,
                            details: {
                                attachmentsCount: activeTimes.length,
                                timestamp: new Date().toISOString()
                            }
                        });
                    }
                }
            }

            return true;
        }

        // 2. Check InventoryManagement requests
        const invMatch = line.match(this.inventoryPattern);
        if (invMatch) {
            const player = invMatch[2];
            const result = invMatch[3]; // 'Succeed' or 'Fail'

            if (result.toLowerCase() === 'succeed') {
                this.emit('gamestate', {
                    type: 'INVENTORY',
                    value: 'Inventory Updated',
                    player: player,
                    level: 'INFO'
                });
            } else {
                this.emit('gamestate', {
                    type: 'INVENTORY',
                    value: 'Inventory Action Failed',
                    player: player,
                    level: 'WARNING'
                });
            }
            return true;
        }

        const locInvMatch = line.match(this.locationInventoryPattern);
        if (locInvMatch) {
            const player = locInvMatch[1];
            const location = locInvMatch[2];
            this.emit('gamestate', {
                type: 'PLAYER_SPAWNED',
                value: { player, location }
            });
            return true;
        }

        const recMatch = line.match(this.recoveryPattern);
        if (recMatch) {
            const archetype = recMatch[1];
            this.emit('gamestate', {
                type: 'ITEM_RECOVERY',
                value: { archetype }
            });
            return true;
        }

        const moveMatch = line.match(this.itemMovePattern);
        if (moveMatch) {
            const player = moveMatch[1];
            const source = moveMatch[2];
            const target = moveMatch[3];
            const itemClass = moveMatch[4];

            let direction = 'move';
            if (source.includes(':Location:') && !target.includes(':Location:')) {
                direction = 'withdraw';
            } else if (!source.includes(':Location:') && target.includes(':Location:')) {
                direction = 'deposit';
            }

            this.emit('gamestate', {
                type: 'ITEM_TRANSFER',
                value: {
                    player,
                    direction,
                    itemClass,
                    source,
                    target
                }
            });
            return true;
        }

        return false;
    }
}

module.exports = new InventoryParser();
