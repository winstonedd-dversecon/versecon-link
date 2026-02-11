const BaseParser = require('./base');

class SalvageParser extends BaseParser {
    constructor() {
        super();
        this.patterns = {
            beam_activation: /<SalvageBeam::SetBeamActive>/,    // Speculative
            material_scrape: /<SalvageMaterial::OnScrape>/,     // Speculative
            rmc_collection: /<Salvage::OnRMCCollected>/         // Speculative
        };
    }

    parse(line) {
        let handled = false;

        // 1. Beam Activation
        // Example: <SalvageBeam::SetBeamActive> Active[1]
        if (this.patterns.beam_activation.test(line)) {
            const activeMatch = line.match(/Active\[(\d)\]/);
            const isActive = activeMatch ? activeMatch[1] === '1' : false;

            this.emit('gamestate', {
                type: 'SALVAGE',
                subtype: 'BEAM',
                state: isActive ? 'ON' : 'OFF'
            });
            handled = true;
        }

        // 2. Material Scraped
        // Example: <SalvageMaterial::OnScrape> Amount[0.5] Type[RMC]
        if (this.patterns.material_scrape.test(line)) {
            const amtMatch = line.match(/Amount\[([\d\.]+)\]/);
            const typeMatch = line.match(/Type\[([^\]]+)\]/);

            if (amtMatch) {
                this.emit('gamestate', {
                    type: 'SALVAGE',
                    subtype: 'SCRAPE',
                    amount: parseFloat(amtMatch[1]),
                    material: typeMatch ? typeMatch[1] : 'Unknown'
                });
            }
            handled = true;
        }

        return handled;
    }
}

module.exports = new SalvageParser();
