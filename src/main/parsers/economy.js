const BaseParser = require('./base');

class EconomyParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            transaction: /<Transaction>/,
            shop_purchase: /<ShopPurchase>/,
            insurance_claim: /<InsuranceClaim>/,
            fine: /Fined\s+(\d+)\s+UEC/i
        };
    }

    parse(line) {
        let handled = false;

        // 1. Shop Purchases
        if (this.patterns.shop_purchase.test(line)) {
            // Extract item cost if possible
            // Regex: <ShopPurchase> Item 'Water' Cost 5 aUEC
            const match = line.match(/Item\s+'([^']+)'\s+Cost\s+(\d+)/i);
            if (match) {
                this.emit('gamestate', {
                    type: 'ECONOMY',
                    subtype: 'PURCHASE',
                    item: match[1],
                    cost: parseInt(match[2], 10)
                });
            } else {
                this.emit('gamestate', { type: 'ECONOMY', value: 'purchase' });
            }
            handled = true;
        }

        // 2. Insurance Claims
        if (this.patterns.insurance_claim.test(line)) {
            this.emit('gamestate', { type: 'ECONOMY', value: 'insurance_claim' });
            handled = true;
        }

        // 3. Fines (e.g. Fined 40000 UEC)
        const fineMatch = line.match(this.patterns.fine);
        if (fineMatch) {
            const amount = parseInt(fineMatch[1], 10);
            this.emit('gamestate', {
                type: 'STATUS',
                value: `FINED ${amount} UEC`,
                level: 'WARNING'
            });
            handled = true;
        }

        return handled;
    }
}

module.exports = new EconomyParser();
