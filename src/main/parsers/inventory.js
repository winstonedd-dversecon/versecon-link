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
        this.pattern = /<([^>]+)>\s+\[[^\]]+\]\s+<AttachmentReceived>\s+Player\[([^\]]+)\]\s+Attachment\[([^,\]]+),\s*([^,\]]+),\s*([^\]]+)\][^\n]*?Port\[([^\]]+)\]/i;

        // Inventory Management tracking (verified in Game.log)
        this.inventoryPattern = /<InventoryManagement>\s+Request\[(\d+)\]\s+for\s+'([^']+)'\s+\[\d+\]\s+Result\[(\w+)\]/i;
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

        return false;
    }
}

module.exports = new InventoryParser();
