const BaseParser = require('./base');

class EconomyParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            transaction: /<Transaction>/,
            shop_purchase: /<ShopPurchase>/,
            insurance_claim: /<InsuranceClaim>/,
            fine: /Fined\s+(\d+)\s+UEC/i,

            // Real wallet insurance claim (verified in Game.log)
            insurance_claim_wallet: /<CWallet::ProcessClaimToNextStep>.*entitlementURN:\s*(\S+).*requestId\s*:\s*(\d+)/i,
            insurance_claim_result: /<CWallet::RmMulticastOnProcessClaimCallback>.*result:\s*(\d+).*requestId:\s*(\d+)/i,

            // Shop terminal interaction (verified in Game.log)
            shop_terminal: /<CEntityComponentShoppingProvider::OnGainedAuthority>.*playerId\[(\d+)\]/i,
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

        // 2. Insurance Claims (legacy tag)
        if (this.patterns.insurance_claim.test(line)) {
            this.emit('gamestate', { type: 'ECONOMY', value: 'insurance_claim' });
            handled = true;
        }

        // 2b. Insurance Claims (real wallet — CWallet)
        const insuranceMatch = line.match(this.patterns.insurance_claim_wallet);
        if (insuranceMatch) {
            this.emit('gamestate', {
                type: 'STATUS',
                value: 'INSURANCE CLAIM FILED',
                level: 'INFO'
            });
            handled = true;
        }

        // 2c. Insurance Claim Result
        const insuranceResultMatch = line.match(this.patterns.insurance_claim_result);
        if (insuranceResultMatch) {
            const resultCode = parseInt(insuranceResultMatch[1], 10);
            this.emit('gamestate', {
                type: 'STATUS',
                value: resultCode === 0 ? 'INSURANCE CLAIM APPROVED' : `INSURANCE CLAIM COMPLETE (code ${resultCode})`,
                level: 'INFO'
            });
            handled = true;
        }

        // 2d. Shop Terminal Access
        if (this.patterns.shop_terminal.test(line)) {
            this.emit('gamestate', {
                type: 'STATUS',
                value: 'SHOP TERMINAL ACCESSED',
                level: 'INFO'
            });
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
