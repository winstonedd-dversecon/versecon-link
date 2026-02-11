const BaseParser = require('./base');

class MiningParser extends BaseParser {
    constructor() {
        super();
        // SPECULATIVE PATTERNS - Needs Verification
        this.patterns = {
            laser_activation: /<MiningLaser::SetLaserActive>/, // Speculative
            fracture_event: /<MiningFracture::OnFracture>/,     // Speculative
            extraction_event: /<MiningExtraction::OnExtraction>/, // Speculative
            material_modifier: /<MaterialModifier>/              // Speculative
        };
    }

    parse(line) {
        let handled = false;

        // 1. laser Activation (Start/Stop)
        if (this.patterns.laser_activation.test(line)) {
            // Example: <MiningLaser::SetLaserActive> Active[1]
            const activeMatch = line.match(/Active\[(\d)\]/);
            const isActive = activeMatch ? activeMatch[1] === '1' : false;

            this.emit('gamestate', {
                type: 'MINING',
                subtype: 'LASER',
                state: isActive ? 'ON' : 'OFF'
            });
            handled = true;
        }

        // 2. Fracture (The "break" event)
        if (this.patterns.fracture_event.test(line)) {
            // Example: <MiningFracture::OnFracture> Success[1] Mass[123.45]
            const successMatch = line.match(/Success\[(\d)\]/);
            const isSuccess = successMatch ? successMatch[1] === '1' : false;

            this.emit('gamestate', {
                type: 'MINING',
                subtype: 'FRACTURE',
                success: isSuccess
            });
            handled = true;
        }

        // 3. Extraction (Sucking up materials)
        if (this.patterns.extraction_event.test(line)) {
            // Example: <MiningExtraction::OnExtraction> Amount[12.5] Material[Gold]
            const matMatch = line.match(/Material\[([^\]]+)\]/);
            const amtMatch = line.match(/Amount\[([\d\.]+)\]/);

            if (matMatch && amtMatch) {
                this.emit('gamestate', {
                    type: 'MINING',
                    subtype: 'EXTRACTION',
                    material: matMatch[1],
                    amount: parseFloat(amtMatch[1])
                });
            }
            handled = true;
        }

        return handled;
    }
}

module.exports = new MiningParser();
