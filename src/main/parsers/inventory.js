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
    }

    parse(line) {
        const m = line.match(this.pattern);
        if (!m) return false;

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
}

module.exports = new InventoryParser();
